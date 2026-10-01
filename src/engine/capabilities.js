// What an agent may use, declared in the workflow and turned into each CLI's own flags.
//
//   agents:
//     developer:
//       capabilities:
//         tools: [read, edit, write, bash:git, bash:npm]   # bash = any command
//         web: false                                        # WebSearch / WebFetch
//         mcp: []                                           # names from the workflow's mcp_servers
//         subagents: false                                  # the CLI's own sub-agents (Claude's Agent/Task)
//
// A step can override them (`steps[].capabilities`, merged key by key over the agent's).
// Isolation (on unless `isolation: false` on the agent or in `defaults`) keeps the user's personal
// CLI configuration out of unattended agents: MCP servers, plugins, user settings, the CLI's skill
// listing and auto-memory. What each CLI can and can't isolate is documented in
// docs/agents/capabilities.md; the gaps are logged once per agent in the run.

const path = require('path');

const TOOL_RE =/^(read|edit|write|bash(:.+)?)$/;
const KEYS = ['tools', 'web', 'mcp', 'subagents'];

// Codex features that reach outside the repository (desktop apps, browsers, plugins, memory).
// `codex features list` keeps removed names as "removed", so these stay valid flags.
const CODEX_FEATURES_OFF = ['plugins', 'apps', 'browser_use', 'computer_use', 'in_app_browser', 'image_generation', 'memories'];

// Claude Code's sub-agent tool: named `Agent` by current versions, `Task` by older ones. --tools
// keeps only the names it knows, so offering just `Task` could leave a newer CLI with no sub-agents.
const CLAUDE_SUBAGENT_TOOLS = ['Agent', 'Task'];

// Shell utilities an agent with a command allowlist (bash:<command>) also runs without asking, so a
// pipe or a `;` chain of allowed commands (`npm test; echo "exit=$?"`, `... | tail -3`) is not
// refused headless, where nobody can approve it. Read-only: any agent with commands gets them.
// `[` is `test` in its bracket form (`[ -f file ] && ...`).
const READ_UTILITIES = [
  '[',
  'basename',
  'cat',
  'cut',
  'dirname',
  'echo',
  'grep',
  'head',
  'ls',
  'printenv',
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
const AGENT_ENV = { MULTIAGENT_SIMULATION_ONLY: '1' };
// Folders of the run every agent with commands may write to (created by the engine, given to
// Claude Code with --add-dir): logs of long commands, the run's scratch workspace (#120), evidence screenshots.
const RUN_DIRS = [
  'logs',
  'scratch',
  'screenshots',
];

// The environment of an agent of a run: AGENT_ENV, plus the run's scratch workspace (#120) when it
// has one ({ workspace, userData }, see WorkflowRun.scratchWorkspace), so `npm run run`, `npm run
// screenshot` and the app started from the worktree never open the owner's workspace or user data.
function agentEnv(scratch = null) {
  if (!scratch) return { ...AGENT_ENV };
  return { ...AGENT_ENV, MULTIAGENT_USER_DATA: scratch.userData, MULTIAGENT_WORKSPACE: scratch.workspace };
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
  for (const k of ['web', 'subagents']) if (caps[k] !== undefined && typeof caps[k] !== 'boolean') throw new Error(`${where}: capabilities.${k} must be true or false.`);
  if (caps.mcp !== undefined && !Array.isArray(caps.mcp)) throw new Error(`${where}: capabilities.mcp must be a list of server names.`);
  for (const name of caps.mcp || []) {
    if (!mcpServers[name]) throw new Error(`${where}: MCP server "${name}" is not defined in the workflow's mcp_servers.`);
  }
}

const has = (caps, t) => caps.tools.includes(t);
const bashRules = (caps) => caps.tools.filter((t) => t === 'bash' || t.startsWith('bash:'));
const writes = (caps) => has(caps, 'edit') || has(caps, 'write');
const readOnly = (caps) => !writes(caps) && !bashRules(caps).length;

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
// agentVars: the agent's environment (agentEnv).
function commandGuide(caps, runDir, agentVars = AGENT_ENV) {
  if (!caps || !bashRules(caps).length) return '';
  const dirs = runDirs(caps, runDir);
  const [logs, shots] = ['logs', 'screenshots'].map((d) => dirs[RUN_DIRS.indexOf(d)]);
  const env = Object.entries(agentVars).map(([k, v]) => `${k}=${v}`).join(', ');
  return [
    'How to run commands in this unattended run (nobody can approve a command the CLI would ask about: it is refused):',
    '- Your current folder already is your working folder: run commands directly, never `cd <folder> && ...`. For another folder use the tool\'s own path option (`git -C <dir>`, `npm --prefix <dir>`).',
    `- ${env} ${Object.keys(agentVars).length > 1 ? 'are' : 'is'} already set in your environment: never prefix a command with \`VAR=value\`.`,
    ...(agentVars.MULTIAGENT_WORKSPACE ? [`- Simulated runs, screenshots and app checks you start go to this run's scratch workspace \`${agentVars.MULTIAGENT_WORKSPACE}\`: never pass a path under the owner's workspace (its runs/ folder).`] : []),
    '- Avoid shell expansions the CLI cannot check (`$VAR`, `$(...)`, `$?`): write the value out; the tool already reports each command\'s exit code.',
    ...(logs ? [`- Write command logs to \`${logs}${path.sep}<name>.log\` and screenshots to \`${shots}\`, never to /tmp, $TEMP or AppData (a gitignored folder of the working folder is fine too).`] : []),
    '- Pipes and `;` chains are fine when every part is an allowed command or a simple utility (tail, head, grep, ls, cat, echo, wc, printenv; mkdir -p, mktemp and sort when you may write files). When unsure, run one command per call; after a refusal, rephrase it once into an allowed form instead of retrying variants.',
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

/**
 * Flags for one turn. caps: normalized capabilities or null (the agent's cli_args only).
 * isolated: keep the user's CLI configuration out. mcpServers: the workflow's mcp_servers.
 * denyEdits: globs of files the agent may not edit (`edits_tests: false` → tests_paths); only
 * Claude's edit tools can refuse them, the engine checks every CLI's turn afterwards anyway.
 * runDir: the run's folder; its RUN_DIRS go to Claude with --add-dir when the agent has commands.
 * env: the agent's environment (agentEnv), accepted as a command prefix by Claude's allow rules.
 * Returns { args, notes }: notes say what this CLI could not enforce (logged once per agent).
 */
function providerArgs(type, { caps = null, isolated = true, mcpServers = {}, denyEdits = [], runDir = null, env = AGENT_ENV } = {}) {
  const args = [];
  const notes = [];
  const mcp = caps ? pick(mcpServers, caps.mcp) : {};
  switch (type) {
    case 'claude-code': {
      if (isolated) {
        // no user settings (plugins, hooks, permission rules), no MCP servers but the declared ones,
        // no Chrome integration, no skill listing (the engine injects the workflow's skills), no auto-memory
        args.push('--strict-mcp-config', '--no-chrome', '--setting-sources', 'project,local', '--disable-slash-commands',
          '--settings', JSON.stringify({ autoMemoryEnabled: false }));
      }
      if (caps && Object.keys(mcp).length) args.push('--mcp-config', JSON.stringify({ mcpServers: mcp }));
      if (!caps) break;
      // --tools: the only built-in tools offered (fewer definitions in context);
      // --allowedTools: the ones that run without asking (nobody can answer in headless mode)
      const offered = ['Read', 'Glob', 'Grep'];
      const allowed = ['Read', 'Glob', 'Grep'];
      if (has(caps, 'edit')) { offered.push('Edit', 'NotebookEdit'); allowed.push('Edit', 'NotebookEdit'); }
      if (has(caps, 'write')) { offered.push('Write'); allowed.push('Write'); }
      const bash = claudeBashRules(caps, env);
      if (bash.length) { offered.push('Bash'); allowed.push(...bash); }
      if (caps.web) { offered.push('WebSearch', 'WebFetch'); allowed.push('WebSearch', 'WebFetch'); }
      if (caps.subagents) { offered.push(...CLAUDE_SUBAGENT_TOOLS); allowed.push(...CLAUDE_SUBAGENT_TOOLS); }
      allowed.push(...Object.keys(mcp).map((n) => `mcp__${n}`));
      args.push('--tools', offered.join(','), '--allowedTools', allowed.join(' '));
      // deny rules win over allow rules; Edit(...) covers every built-in tool that edits files
      if (writes(caps) && denyEdits.length) args.push('--disallowedTools', denyEdits.map((p) => `Edit(${claudePath(p)})`).join(' '));
      // file edits (and mkdir/redirects) are refused headless without acceptEdits
      if (writes(caps)) args.push('--permission-mode', 'acceptEdits');
      for (const dir of runDirs(caps, runDir)) args.push('--add-dir', dir);
      break;
    }
    case 'codex-cli': {
      // one -c for every server: the workflow's declared ones replace the user's config.toml table
      if (isolated || Object.keys(mcp).length) args.push('-c', `mcp_servers=${toml(mcp)}`);
      if (isolated) for (const f of CODEX_FEATURES_OFF) args.push('--disable', f);
      if (!caps) break;
      args.push('-s', writes(caps) ? 'workspace-write' : 'read-only');
      if (!caps.web) args.push('-c', 'web_search="disabled"');
      if (bashRules(caps).some((t) => t !== 'bash')) notes.push('command allowlist (bash:<command>) not enforceable: the sandbox limits writes, not which commands run');
      if (writes(caps) && bashRules(caps).length) notes.push('workspace-write sandbox: no network access for commands');
      break;
    }
    case 'grok-cli': {
      if (isolated) notes.push('grok has no flags to skip the user\'s MCP servers, skills or memory: only its tools are restricted');
      if (caps && Object.keys(mcp).length) notes.push('workflow MCP servers are not passed to grok');
      if (!caps) break;
      if (readOnly(caps)) args.push('--tools', ['read_file', 'list_dir', 'grep', ...(caps.web ? ['web_search', 'web_fetch'] : [])].join(','));
      else notes.push('only read-only tool sets are enforced for grok (edit/write/bash run with --always-approve)');
      if (!caps.web) args.push('--disable-web-search');
      if (!caps.subagents) args.push('--no-subagents');
      // headless: nobody can answer its approval prompts
      args.push('--always-approve');
      break;
    }
    default:
      break;
  }
  if (denyEdits.length && type !== 'claude-code' && (!caps || !readOnly(caps))) notes.push('test paths (edits_tests: false) are not refused by the tools: the engine checks the turn\'s changes');
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
  const subagents = type === 'claude-code' ? `subagents: ${CLAUDE_SUBAGENT_TOOLS.join('/')} tool offered`
    : type === 'codex-cli' ? 'subagents: not offered by Codex' : 'subagents';
  return [`tools: ${tools.join(', ') || 'none'}`, `web: ${c.web ? 'on' : 'off'}`, `mcp: ${c.mcp.join(', ') || 'none'}`, ...(c.subagents ? [subagents] : [])].join(' · ');
}

module.exports = {
  AGENT_ENV,
  agentEnv,
  CLAUDE_SUBAGENT_TOOLS,
  CODEX_FEATURES_OFF,
  commandGuide,
  dedupeFlags,
  describe,
  merge,
  normalize,
  providerArgs,
  READ_UTILITIES,
  RUN_DIRS,
  runDirs,
  validate,
  WRITE_UTILITIES,
};
