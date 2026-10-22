// The environment of every child process the app starts (#470, SEC-5): agent turns
// (providers.runCli), transition actions (machine-actions), probes, the suite step and the
// terminals (service/common cliEnv). Built from an allowlist, never the app's whole environment: a
// prompt-injected agent or a repository's test script could otherwise read cloud keys, API keys or
// the SSH agent. Passed: the system and toolchain variables below (names compared case-insensitively,
// Windows' `Path` keeps its own spelling), GH_* / GITHUB_TOKEN only with platforms ['gh'], GITLAB_*
// only with ['glab'], and the exact names of `passthrough` (a workflow's `env: { passthrough: [...] }`).
// The engine's own variables (AGENT_ENV, the account, git config) are set on top by each caller.
// docs/agents/capabilities.md "Child environment" lists what is passed.

'use strict';

// Exact names: the paths and folders a CLI, git, node and npm need; Windows' system variables
const ALLOWED_NAMES = [
  'APPDATA',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'COLORTERM',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'COMPUTERNAME',
  'COMSPEC',
  'DISPLAY',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LANGUAGE',
  'LOCALAPPDATA',
  'LOGNAME',
  'NODE_OPTIONS',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PUBLIC',
  'SHELL',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'WINDIR',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
];
// Prefixes: locales and git's own variables (GIT_CONFIG_*, GIT_SSH_COMMAND, ...)
const ALLOWED_PREFIXES = [
  'GIT_',
  'LC_',
];
// A platform's tokens, only for the processes that run its CLI
const PLATFORM_PREFIXES = {
  gh: ['GH_', 'GITHUB_TOKEN'],
  glab: ['GITLAB_'],
};

/**
 * `parent` (process.env by default) reduced to the allowlist, plus the tokens of `platforms`
 * ('gh', 'glab') and the exact names in `passthrough`.
 */
function childEnv(parent = process.env, { platforms = [], passthrough = [] } = {}) {
  const prefixes = [...ALLOWED_PREFIXES, ...platforms.flatMap((p) => PLATFORM_PREFIXES[p] || [])];
  const names = new Set([...ALLOWED_NAMES, ...passthrough.map((n) => String(n).toUpperCase())]);
  const out = {};
  for (const [k, v] of Object.entries(parent || {})) {
    if (v == null) continue;
    const key = k.toUpperCase();
    if (names.has(key) || prefixes.some((p) => key.startsWith(p))) out[k] = v;
  }
  return out;
}

module.exports = {
  ALLOWED_NAMES,
  childEnv,
};
