// Service area: the Settings screen's environment details: path, version and authentication of
// each CLI the workflows call (claude, codex, grok, gh, glab, git), and how to install a missing one
// (packages/engine/domains/machine/install-commands.js) or sign in (#319). Claude Code's sign-in is read from its credentials
// (packages/engine/domains/cli/claude-auth.js), never by running it; a failed probe returns its last output lines (`output`).
// accountStatus (#312): a provider account's folder, signed in or not, with its login command.

const { resolveCommandAsync } = require('../../engine/providers');
const {
  claudeAccount,
  claudeSignedIn,
} = require('../../domains/cli/claude-auth');
const {
  installCommand,
  installHint,
  signInCommands,
} = require('../../domains/machine/install-commands');
const providerAccounts = require('../../domains/cli/provider-accounts');
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

// a CLI of TOOLS on this machine: installed, and signed in by its own probe (`gh auth status`); env: the
// probe's variables (#312: a provider account's folder). Also the onboarding's gh / glab check (#640).
async function toolSignIn(id, env) {
  const tool = TOOLS.find((t) => t.id === id);
  const r = await resolveCommandAsync(id);
  if (!r) return { installed: false, signedIn: false };
  return { installed: true, signedIn: !!tool?.auth && (await runTool(r.file, tool.auth, env)).ok };
}

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

  // #312: the CLI's own sign-in probe (`codex login status`) run with the account's variable only:
  // true/false, or null when the CLI has no probe or is not installed. Its output is not returned.
  async function probeAccount(id, env) {
    if (!TOOLS.find((t) => t.id === id)?.auth) return null;
    const s = await toolSignIn(id, env);
    return s.installed ? s.signedIn : null;
  }

  // #312: a provider account's folder: signed in or not, and its login command (packages/engine/domains/cli/provider-accounts.js)
  async function accountStatus({ provider, dir } = {}) {
    const status = await providerAccounts.accountStatus({ provider, dir, probe: probeAccount });
    return { ...status, loginCommand: providerAccounts.accountLoginCommand(provider, dir) };
  }

  return {
    accountStatus,
    envDetails,
  };
};

module.exports.toolSignIn = toolSignIn;
