// The provider CLIs' config folders (#316), for the session list (src/cli-sessions.js), the usage
// reader (src/local-usage.js) and folder trust (src/cli-trust.js). Claude Code uses
// CLAUDE_CONFIG_DIR and Codex uses CODEX_HOME when they are set (on every OS), else ~/.claude and
// ~/.codex; Claude's own config file is then <CLAUDE_CONFIG_DIR>/.claude.json instead of
// ~/.claude.json. A caller that passes a home folder (the tests) gets that home's folders and the
// variables are ignored. cliSessionDirs: the folder each CLI records its conversations in (its
// adapter's sessionsDir under its config folder, src/shared/providers/), by CLI id.

const os = require('os');
const path = require('path');
const registry = require('./shared/providers');

function cliConfigDirs(home) {
  const env = home ? {} : process.env;
  const base = home || os.homedir();
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(base, '.claude'),
    claudeJson: env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(base, '.claude.json'),
    codex: env.CODEX_HOME || path.join(base, '.codex'),
    grok: path.join(base, '.grok'),
  };
}

const cliSessionDirs = (cfg) => Object.fromEntries(registry.clis().map((a) => [a.id, path.join(cfg[a.id], a.sessionsDir)]));

module.exports = {
  cliConfigDirs,
  cliSessionDirs,
};
