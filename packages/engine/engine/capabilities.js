// What an agent may use, declared in the workflow and turned into each CLI's own flags.
//
//   agents:
//     developer:
//       capabilities:
//         tools: [read, edit, write, bash:git, bash:npm]   # bash = any command
//         web: false                                        # WebSearch / WebFetch
//         mcp: []                                           # names from the workflow's mcp_servers
//         subagents: false                                  # the CLI's own sub-agents (Claude's Agent/Task)
//         screenshots: false                                # not told where screenshots go (default true; #223's healer)
//
// A step can override them (`steps[].capabilities`, merged key by key over the agent's).
// Isolation (on unless `isolation: false` on the agent or in `defaults`) keeps the user's personal
// CLI configuration out of unattended agents: MCP servers, plugins, user settings, the CLI's skill
// listing and auto-memory. What each CLI can and can't isolate is documented in
// docs/agents/capabilities.md; the gaps are logged once per agent in the run.

const path = require('path');
const { PLATFORM_CLIS } = require('./child-env');
const { workerEnv } = require('../domains/machine/machine-profile');
const { machineSlotDir } = require('./machine-slot');
const registry = require('@craftorio/shared/providers');

const TOOL_RE =/^(read|edit|write|bash(:.+)?)$/;
const KEYS = ['tools', 'web', 'mcp', 'subagents', 'screenshots'];

// Codex features turned off in isolation, and Claude Code's sub-agent tool names: their adapters'.
const CODEX_FEATURES_OFF = registry.byId('codex').featuresOff;
const CLAUDE_SUBAGENT_TOOLS = registry.byId('claude').subagentTools;

// Shell utilities an agent with a command allowlist (bash:<command>) also runs without asking, so a
// pipe or a `;` chain of allowed commands (`npm test; echo "exit=$?"`, `... | tail -3`) is not
// refused headless, where nobody can approve it. Read-only: any agent with commands gets them.
// `[` is `test` in its bracket form (`[ -f file ] && ...`). `awk` (#299): a filter in a pipe; its
// programs with braces are refused by the CLI's parser anyway. `sed` stays out: `sed -i` writes.
// #470 (SEC-5): no printenv, env or set (piped to gh, they would publish the environment).
const READ_UTILITIES = [
  '[',
  'awk',
  'basename',
  'cat',
  'cut',
  'dirname',
  'echo',
  'grep',
  'head',
  'ls',
  'pwd',
  'tail',
  'test',
  'tr',
  'wc',
];
// Only for agents that write files (these can: sort -o, uniq <in> <out>): Claude Code keeps their
// writes (mkdir, redirects) inside the working folder and the --add-dir folders (RUN_DIRS).
const WRITE_UTILITIES = [
  'mkdir',
  'mktemp',
  'sort',
  'uniq',
];
// The engine sets these in every agent's environment (providers.runCli), so no command needs a
// `VAR=value` prefix; a prefix that still appears is allowed in front of an allowed command.
const AGENT_ENV = { CRAFTORIO_SIMULATION_ONLY: '1' };
// Folders of the run every agent with commands may write to (created by the engine, given to
// Claude Code with --add-dir): evidence screenshots (evidence/<step>/round-<n>, #146, packages/engine/domains/evidence/evidence.js),
// logs of long commands, the run's scratch workspace (#120), the run's temp folder (#414).
const RUN_DIRS = [
  'evidence',
  'logs',
  'scratch',
  'tmp',
];

// Commands refused when the worktree's node_modules links the shared dependency cache (#198): a
// clean install or a delete would empty the cache entry through the link, for every run using it.
// Claude refuses them (deny rules win over allow rules); Codex and Grok cannot: the engine checks
// the entry after each turn (an emptied entry is never given to a new worktree).
const DEPS_DENIED_COMMANDS = [
  'npm ci',
  'npm clean-install',
  'npm install-clean',
  'rm -fr node_modules',
  'rm -r node_modules',
  'rm -rf node_modules',
];

// The environment of an agent of a run: AGENT_ENV, plus the run's scratch workspace (#120) when it
// has one ({ workspace, userData }, see WorkflowRun.scratchWorkspace), so `npm run run`, `npm run
// screenshot` and the app started from the worktree never open the owner's workspace or user data.
// scratch.tmp (#414): the run's temp folder (<run>/tmp), as TMP, TEMP and TMPDIR, so the tests a
// turn runs write their temp files inside the run (removed when it ends), not in the user's %TEMP%.
// With it, CRAFTORIO_LOCKS_DIR keeps the machine-wide slots' folder (#455, machineSlotDir, computed
// here before TMP moves): an agent's whole `npm test` and its captures wait for other runs'.
// workers: { testWorkers } of the machine profile (#367): the test workers per run, passed to the
// test runners as CRAFTORIO_TEST_WORKERS / CRAFTORIO_E2E_WORKERS (packages/engine/domains/machine/machine-profile.js workerEnv).
function agentEnv(scratch = null, workers = null) {
  const env = { ...AGENT_ENV, ...(workers?.testWorkers ? workerEnv(workers) : {}) };
  if (!scratch) return env;
  const tmp = scratch.tmp ? { TMP: scratch.tmp, TEMP: scratch.tmp, TMPDIR: scratch.tmp, CRAFTORIO_LOCKS_DIR: machineSlotDir() } : {};
  return { ...env, CRAFTORIO_USER_DATA: scratch.userData, CRAFTORIO_WORKSPACE: scratch.workspace, ...tmp };
}

// Flags that take no value: never passed twice (clap-based CLIs refuse a repeated flag).
const BARE_FLAGS = new Set(['--no-subagents', '--disable-web-search', '--always-approve', '--strict-mcp-config', '--no-chrome', '--disable-slash-commands']);

// tools may nest lists (YAML anchors: `tools: [read, *toolchains]`).
function normalize(caps) {
  if (!caps) return null;
  const tools = [caps.tools || []].flat(Infinity).map((t) => String(t).trim()).filter(Boolean);
  return {
    tools: [...new Set(tools)],
    web: !!caps.web,
    mcp: [caps.mcp || []].flat(Infinity).map(String),
    subagents: !!caps.subagents,
    ...(caps.screenshots === false ? { screenshots: false } : {}),
  };
}

// Agent capabilities with the step's on top (key by key). null when neither declares any.
function merge(agentCaps, stepCaps) {
  if (!agentCaps && !stepCaps) return null;
  return normalize({ ...(agentCaps || {}), ...(stepCaps || {}) });
}

// loadWorkflow: throws on anything the engine could not translate.
function validate(caps, where, mcpServers = {}) {
  if (caps == null) return;
  if (typeof caps !== 'object' || Array.isArray(caps)) throw new Error(`${where}: capabilities must be a map (tools, web, mcp, subagents).`);
  for (const k of Object.keys(caps)) if (!KEYS.includes(k)) throw new Error(`${where}: unknown capability "${k}" (use ${KEYS.join(', ')}).`);
  if (caps.tools !== undefined && !Array.isArray(caps.tools)) throw new Error(`${where}: capabilities.tools must be a list.`);
  for (const t of [caps.tools || []].flat(Infinity)) {
    if (!TOOL_RE.test(String(t).trim())) throw new Error(`${where}: unknown tool "${t}" (use read, edit, write, bash or bash:<command>).`);
  }
  for (const k of ['web', 'subagents', 'screenshots']) if (caps[k] !== undefined && typeof caps[k] !== 'boolean') throw new Error(`${where}: capabilities.${k} must be true or false.`);
  if (caps.mcp !== undefined && !Array.isArray(caps.mcp)) throw new Error(`${where}: capabilities.mcp must be a list of server names.`);
  for (const name of caps.mcp || []) {
    if (!mcpServers[name]) throw new Error(`${where}: MCP server "${name}" is not defined in the workflow's mcp_servers.`);
  }
}

const has = (caps, t) => caps.tools.includes(t);
const bashRules = (caps) => caps.tools.filter((t) => t === 'bash' || t.startsWith('bash:'));
const writes = (caps) => has(caps, 'edit') || has(caps, 'write');
const readOnly = (caps) => !writes(caps) && !bashRules(caps).length;
// #470 (SEC-5): the platforms whose tokens reach the agent's environment (packages/engine/engine/child-env.js):
// gh with bash:gh, glab with bash:glab, both with a bare bash or no capabilities (any command).
function platformsOf(caps) {
  const bash = caps ? bashRules(caps) : [];
  const any = !caps || bash.includes('bash');
  return PLATFORM_CLIS.filter((p) => any || bash.includes(`bash:${p}`));
}

// Claude Code allow rules for the agent's commands: each bash:<command>, the same with a prefix of
// the agent's environment (env: agentEnv), and the utilities above (the write ones only for agents
// that write files). A bare `bash` already allows everything.
function claudeBashRules(caps, env = AGENT_ENV) {
  const bash = bashRules(caps);
  if (!bash.length) return [];
  if (bash.includes('bash')) return ['Bash'];
  const cmds = bash.map((t) => t.slice(5).trim());
  const prefixes = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const utilities = [...READ_UTILITIES, ...(writes(caps) ? WRITE_UTILITIES : [])].filter((u) => !cmds.includes(u));
  return [...cmds, ...prefixes.flatMap((p) => cmds.map((c) => `${p} ${c}`)), ...utilities].map((c) => `Bash(${c}:*)`);
}

// The run folders (absolute) an agent with commands may write to, for --add-dir; [] otherwise.
const runDirs = (caps, runDir) => (caps && runDir && bashRules(caps).length ? RUN_DIRS.map((d) => path.join(runDir, d)) : []);

// Told to every agent with commands on its first turn (any CLI): unattended, a command the CLI
// would ask about is refused, so this says how to run commands that are never asked about.
// agentVars: the agent's environment (agentEnv); shotsDir: the folder of this step's round
// (<run_dir>/evidence/<step>/round-<n>), else the evidence folder.
/** @param {string | null} [shotsDir] */
function commandGuide(caps, runDir, agentVars = AGENT_ENV, shotsDir = null) {
  if (!caps || !bashRules(caps).length) return '';
  const dirs = runDirs(caps, runDir);
  const [logs, evidence] = ['logs', 'evidence'].map((d) => dirs[RUN_DIRS.indexOf(d)]);
  const shots = shotsDir || evidence;
  const env = Object.entries(agentVars).map(([k, v]) => `${k}=${v}`).join(', ');
  return [
    'How to run commands in this unattended run (nobody can approve a command the CLI would ask about: it is refused):',
    '- Your current folder already is your working folder: run commands directly, never `cd <folder> && ...`. For another folder use the tool\'s own path option (`git -C <dir>`, `npm --prefix <dir>`).',
    `- ${env} ${Object.keys(agentVars).length > 1 ? 'are' : 'is'} already set in your environment: never prefix a command with \`VAR=value\`.`,
    ...(agentVars.CRAFTORIO_WORKSPACE ? [`- Simulated runs, screenshots and app checks you start go to this run's scratch workspace \`${agentVars.CRAFTORIO_WORKSPACE}\`: never pass a path under the owner's workspace (its runs/ folder).`] : []),
    '- Avoid shell expansions the CLI cannot check (`$VAR`, `$(...)`, `$?`): write the value out; the tool already reports each command\'s exit code.',
    // screenshots: false (an agent that should not take any): only the logs' folder
    ...(logs ? [`- Write command logs to \`${logs}${path.sep}<name>.log\`${caps.screenshots === false ? '' : ` and screenshots to \`${shots}\` (as \`<issue>-<screen>-<state>.original.png\` / \`.modified.png\`)`}, never to /tmp, $TEMP or AppData (a gitignored folder of the working folder is fine too).`] : []),
    '- Pipes and `;` chains are fine when every part is an allowed command or a simple utility (tail, head, grep, awk, ls, cat, echo, wc; mkdir -p, mktemp and sort when you may write files). When unsure, run one command per call; after a refusal, rephrase it once into an allowed form instead of retrying variants.',
    // #299: refused by the CLI's own parser whatever the allow list says
    '- The CLI\'s parser also refuses a `#` after a newline or a `$` inside a quoted argument, a heredoc (`cat > file <<\'EOF\'`, `node - <<\'EOF\'`) and an inline script with braces and quotes (`node -e "...{...}..."`, `awk \'{...}\'`): write the script to a file with your file tool, then run `node <file>`.',
  ].join('\n');
}

// TOML inline value (codex -c): JSON strings, numbers, booleans and arrays are valid TOML.
function toml(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return `{${Object.entries(v).map(([k, x]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)}=${toml(x)}`).join(',')}}`;
  }
  if (Array.isArray(v)) return `[${v.map(toml).join(',')}]`;
  return JSON.stringify(v);
}

const pick = (servers, names) => Object.fromEntries(names.map((n) => [n, servers[n]]));

// A tests_paths glob as a Claude Code permission path: gitignore-style, relative to the working
// folder; a bare name ("*.test.*") matches at any depth.
const claudePath = (p) => {
  const s = String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return s.includes('/') ? s : `**/${s}`;
};

// What an adapter's isolationArgs reads the capabilities with (the adapters require nothing of the engine).
const ADAPTER_LIB = {
  bashRules,
  claudeBashRules,
  claudePath,
  has,
  readOnly,
  runDirs,
  toml,
  writes,
};

/**
 * Flags for one turn. caps: normalized capabilities or null (the agent's cli_args only).
 * isolated: keep the user's CLI configuration out. mcpServers: the workflow's mcp_servers.
 * denyEdits: globs of files the agent may not edit (`edits_tests: false` → tests_paths); only
 * Claude's edit tools can refuse them, the engine checks every CLI's turn afterwards anyway.
 * runDir: the run's folder; its RUN_DIRS go to Claude with --add-dir when the agent has commands.
 * env: the agent's environment (agentEnv), accepted as a command prefix by Claude's allow rules.
 * denyCommands: command prefixes the agent may not run (DEPS_DENIED_COMMANDS); only Claude refuses them.
 * instructionsFile: the repository's instructions the engine composed (#45), for an adapter with
 * `instructionsFlags`; null for the internal agents (Oracle, supervisor chat, Product Owner).
 * Returns { args, notes }: notes say what this CLI could not enforce (logged once per agent).
 * @param {string} type
 * @param {{ caps?: object | null, isolated?: boolean, mcpServers?: object, denyEdits?: string[], denyCommands?: string[], runDir?: string | null, env?: object, instructionsFile?: string | null }} [options]
 */
function providerArgs(type, { caps = null, isolated = true, mcpServers = {}, denyEdits = [], denyCommands = [], runDir = null, env = AGENT_ENV, instructionsFile = null } = {}) {
  const mcp = caps ? pick(mcpServers, caps.mcp) : {};
  const adapter = registry.byType(type);
  // each CLI's own flags: its adapter's isolationArgs (packages/shared/providers/<id>.js)
  const { args, notes } = adapter?.isolationArgs
    ? adapter.isolationArgs({ caps, isolated, mcp, denyEdits, denyCommands, runDir, env, instructionsFile }, ADAPTER_LIB)
    : { args: [], notes: [] };
  const enforced = !!adapter?.enforcesDenyRules;
  if (denyEdits.length && !enforced && (!caps || !readOnly(caps))) notes.push('test paths (edits_tests: false) are not refused by the tools: the engine checks the turn\'s changes');
  if (denyCommands.length && !enforced && (!caps || bashRules(caps).length)) notes.push('`npm ci` on the shared node_modules is not refused by this CLI: the engine checks the cache entry after the turn');
  return { args, notes };
}

// Extra arguments without a bare flag given twice (capabilities, cli_args) or already in
// `already` (the provider's own args).
function dedupeFlags(args, already = []) {
  const seen = new Set(already.filter((a) => BARE_FLAGS.has(a)));
  return args.filter((a) => {
    if (!BARE_FLAGS.has(a)) return true;
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
}

// One line for the Workflows screen and the run log. With the provider type (the run log), it
// also says which tool offers the sub-agents, so a log shows whether the agent could start one.
function describe(caps, type) {
  if (!caps) return 'cli_args only';
  const c = normalize(caps);
  const bash = bashRules(c).map((t) => (t === 'bash' ? '*' : t.slice(5)));
  const tools = [...c.tools.filter((t) => !t.startsWith('bash')), ...(bash.length ? [`bash: ${bash.join(' ')}`] : [])];
  const subagents = registry.byType(type)?.subagentsNote || 'subagents';
  return [`tools: ${tools.join(', ') || 'none'}`, `web: ${c.web ? 'on' : 'off'}`, `mcp: ${c.mcp.join(', ') || 'none'}`, ...(c.subagents ? [subagents] : [])].join(' · ');
}

module.exports = {
  AGENT_ENV,
  agentEnv,
  CLAUDE_SUBAGENT_TOOLS,
  CODEX_FEATURES_OFF,
  commandGuide,
  dedupeFlags,
  DEPS_DENIED_COMMANDS,
  describe,
  merge,
  normalize,
  platformsOf,
  providerArgs,
  READ_UTILITIES,
  RUN_DIRS,
  runDirs,
  validate,
  WRITE_UTILITIES,
};
