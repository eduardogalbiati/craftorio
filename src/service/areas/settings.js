// Service area: the Settings screen's environment details: path, version and authentication of
// each CLI the workflows call (claude, codex, grok, gh, glab, git).

const { resolveCommand } = require('../../engine/providers');
const { runTool } = require('../common');

const TOOLS = [
  { id: 'claude', name: 'Claude Code', args: ['--version'] },
  { id: 'codex', name: 'Codex CLI', args: ['--version'], auth: ['login', 'status'] },
  // `grok models` fails when not logged in and prints "You are logged in with ..." otherwise
  { id: 'grok', name: 'Grok Build', args: ['--version'], auth: ['models'] },
  { id: 'gh', name: 'GitHub CLI', args: ['--version'], auth: ['auth', 'status'] },
  { id: 'glab', name: 'GitLab CLI', args: ['--version'], auth: ['auth', 'status'] },
  { id: 'git', name: 'Git', args: ['--version'] },
];

module.exports = () => {
  function envDetails() {
    return Promise.all(TOOLS.map(async (t) => {
      const r = resolveCommand(t.id);
      if (!r) return { id: t.id, name: t.name, path: null, connected: false };
      const v = await runTool(r.file, t.args, r.shell);
      const out = { id: t.id, name: t.name, path: r.file, version: v.ok ? v.out.split(/\r?\n/)[0] : null, connected: v.ok, auth: !!t.auth };
      if (t.auth) {
        const a = await runTool(r.file, t.auth, r.shell);
        out.connected = a.ok;
        out.account = (a.out.match(/account (\S+)/) || a.out.match(/as (\S+)/) || [])[1] || null;
      }
      return out;
    }));
  }

  return {
    envDetails,
  };
};
