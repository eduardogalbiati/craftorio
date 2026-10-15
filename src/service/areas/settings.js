// Service area: the Settings screen's environment details: path, version and authentication of
// each CLI the workflows call (claude, codex, grok, gh, glab, git), and how to install a missing one
// (src/install-commands.js) or sign in (#319). Claude Code's sign-in is read from its credentials
// (src/claude-auth.js), never by running it; a failed probe returns its last output lines (`output`).

const { resolveCommandAsync } = require('../../engine/providers');
const {
  claudeAccount,
  claudeSignedIn,
} = require('../../claude-auth');
const {
  installCommand,
  installHint,
  signInCommands,
} = require('../../install-commands');
const { runTool } = require('../common');

const lastLines = (text, n = 4) => String(text || '').split(/\r?\n/).filter((l) => l.trim()).slice(-n).join('\n') || null;

const TOOLS = [
  { id: 'claude', name: 'Claude Code', args: ['--version'], signedIn: claudeSignedIn, account: claudeAccount },
  { id: 'codex', name: 'Codex CLI', args: ['--version'], auth: ['login', 'status'] },
  // `grok models` fails when not logged in and prints "You are logged in with ..." otherwise
  { id: 'grok', name: 'Grok Build', args: ['--version'], auth: ['models'] },
  { id: 'gh', name: 'GitHub CLI', args: ['--version'], auth: ['auth', 'status'] },
  { id: 'glab', name: 'GitLab CLI', args: ['--version'], auth: ['auth', 'status'] },
  { id: 'git', name: 'Git', args: ['--version'] },
];

module.exports = () => {
  async function envDetails() {
    // #398: the brew commands only with Homebrew (looked up on macOS only)
    const opts = { brew: process.platform === 'darwin' && !!(await resolveCommandAsync('brew')) };
    return Promise.all(TOOLS.map(async (t) => {
      const r = await resolveCommandAsync(t.id); // #389: never blocks the main process
      const signInCommand = signInCommands()[t.id] || null;
      if (!r) return { id: t.id, name: t.name, path: null, connected: false, installCommand: installCommand(t.id, process.platform, opts), installHint: installHint(t.id, process.platform, opts), signInCommand };
      const v = await runTool(r.file, t.args);
      const out = { id: t.id, name: t.name, path: r.file, version: v.ok ? v.out.split(/\r?\n/)[0] : null, connected: v.ok, auth: !!(t.auth || (t.signedIn && v.ok)), signInCommand };
      if (!v.ok) out.output = lastLines(v.out);
      if (t.auth) {
        const a = await runTool(r.file, t.auth);
        out.connected = a.ok;
        out.account = (a.out.match(/account (\S+)/) || a.out.match(/as (\S+)/) || [])[1] || null;
        if (!a.ok) out.output = lastLines(a.out);
      } else if (t.signedIn && v.ok) {
        out.connected = t.signedIn();
        out.account = out.connected ? t.account() : null;
      }
      return out;
    }));
  }

  return {
    envDetails,
  };
};
