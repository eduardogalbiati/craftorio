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

const TOOL_RE = /^(read|edit|write|bash(:.+)?)$/;
const KEYS = ['tools', 'web', 'mcp', 'subagents'];

// Codex features that reach outside the repository (desktop apps, browsers, plugins, memory).
// `codex features list` keeps removed names as "removed", so these stay valid flags.
const CODEX_FEATURES_OFF = ['plugins', 'apps', 'browser_use', 'computer_use', 'in_app_browser', 'image_generation', 'memories'];

// Claude Code's sub-agent tool: named `Agent` by current versions, `Task` by older ones. --tools
// keeps only the names it knows, so offering just `Task` could leave a newer CLI with no sub-agents.
const CLAUDE_SUBAGENT_TOOLS = ['Agent', 'Task'];

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
 * Returns { args, notes }: notes say what this CLI could not enforce (logged once per agent).
 */
function providerArgs(type, { caps = null, isolated = true, mcpServers = {}, denyEdits = [] } = {}) {
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
      const bash = bashRules(caps);
      if (bash.length) {
        offered.push('Bash');
        allowed.push(...bash.map((t) => (t === 'bash' ? 'Bash' : `Bash(${t.slice(5).trim()}:*)`)));
      }
      if (caps.web) { offered.push('WebSearch', 'WebFetch'); allowed.push('WebSearch', 'WebFetch'); }
      if (caps.subagents) { offered.push(...CLAUDE_SUBAGENT_TOOLS); allowed.push(...CLAUDE_SUBAGENT_TOOLS); }
      allowed.push(...Object.keys(mcp).map((n) => `mcp__${n}`));
      args.push('--tools', offered.join(','), '--allowedTools', allowed.join(' '));
      // deny rules win over allow rules; Edit(...) covers every built-in tool that edits files
      if (writes(caps) && denyEdits.length) args.push('--disallowedTools', denyEdits.map((p) => `Edit(${claudePath(p)})`).join(' '));
      // file edits (and mkdir/redirects) are refused headless without acceptEdits
      if (writes(caps)) args.push('--permission-mode', 'acceptEdits');
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
  CLAUDE_SUBAGENT_TOOLS,
  CODEX_FEATURES_OFF,
  dedupeFlags,
  describe,
  merge,
  normalize,
  providerArgs,
  validate,
};
