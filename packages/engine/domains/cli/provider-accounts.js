// Adding a provider account (#312, Settings › Agents & CLIs › Accounts): an account is a CLI config
// folder given to the CLI through its adapter's configDirEnv (CLAUDE_CONFIG_DIR, CODEX_HOME).
// accountLoginCommand: the command that logs that folder in (the CLI's sign-in command,
// signInCommands(), started with the folder's variable, the folder single-quoted), null for a CLI
// without a variable (Grok).
// accountStatus: whether the folder is signed in, read from that folder only (never the app's own
// environment, an API key in it would count for every account) and never returning a credential:
// Claude through claudeSignedIn / claudeAccount (packages/engine/domains/cli/claude-auth.js, its .credentials.json; the
// macOS Keychain is not per folder, so it is not asked); Codex through the caller's `probe` (the
// Settings probe, `codex login status`, run with the folder's variable), its auth.json present
// (not read) when the CLI cannot be probed.

const fs = require('fs');
const path = require('path');
const registry = require('@multiagent/shared/providers');
const { claudeAccount, claudeSignedIn } = require('./claude-auth');
const { signInCommands } = require('../machine/install-commands');
const { psQuote, shQuote } = require('../machine/shell');

const quoted = (dir, platform) => (platform === 'win32' ? psQuote(dir) : shQuote(dir));

function accountLoginCommand(provider, dir, platform = process.platform) {
  const adapter = registry.resolve(provider);
  const name = adapter?.configDirEnv;
  const signIn = adapter && signInCommands()[adapter.id];
  if (!name || !signIn || !dir) return null;
  // the app's command terminals: PowerShell on Windows, a POSIX shell elsewhere
  return platform === 'win32' ? `$env:${name}=${quoted(dir, platform)}; ${signIn}` : `${name}=${quoted(dir, platform)} ${signIn}`;
}

async function accountStatus({ provider, dir, probe = null } = {}) {
  const adapter = registry.resolve(provider);
  const name = adapter?.configDirEnv;
  if (!name || !dir || !fs.existsSync(String(dir))) return { signedIn: false };
  const env = { [name]: String(dir) };
  if (adapter.id === 'claude') {
    const signedIn = claudeSignedIn({ env, platform: 'none', readKeychain: null });
    const email = signedIn ? claudeAccount({ env }) : null;
    return { signedIn, ...(email ? { account: email } : {}) };
  }
  if (!fs.existsSync(path.join(String(dir), 'auth.json'))) return { signedIn: false };
  const probed = probe ? await probe(adapter.id, env) : null;
  return { signedIn: probed ?? true };
}

module.exports = {
  accountLoginCommand,
  accountStatus,
};
