// Adding a provider account (#312, Settings › Agents & CLIs › Accounts): an account is a CLI config
// folder given to the CLI through its adapter's configDirEnv (CLAUDE_CONFIG_DIR, CODEX_HOME).
// accountLoginCommand: the command that logs that folder in (the CLI's sign-in command,
// signInCommands(), started with the folder's variable), null for a CLI without a variable (Grok).
// accountStatus: whether the folder is signed in, read from that folder only (never the app's own
// environment, an API key in it would count for every account) and never returning a credential:
// Claude through claudeSignedIn / claudeAccount (src/claude-auth.js, its .credentials.json; the
// macOS Keychain is not per folder, so it is not asked), Codex from the presence of its auth.json
// (not read, no `codex` started).

const fs = require('fs');
const path = require('path');
const registry = require('./shared/providers');
const { claudeAccount, claudeSignedIn } = require('./claude-auth');
const { signInCommands } = require('./install-commands');

function accountLoginCommand(provider, dir, platform = process.platform) {
  const adapter = registry.resolve(provider);
  const name = adapter?.configDirEnv;
  const signIn = adapter && signInCommands()[adapter.id];
  if (!name || !signIn || !dir) return null;
  // the app's command terminals: PowerShell on Windows, a POSIX shell elsewhere
  return platform === 'win32' ? `$env:${name}="${dir}"; ${signIn}` : `${name}="${dir}" ${signIn}`;
}

async function accountStatus({ provider, dir } = {}) {
  const adapter = registry.resolve(provider);
  const name = adapter?.configDirEnv;
  if (!name || !dir || !fs.existsSync(String(dir))) return { signedIn: false };
  if (adapter.id === 'claude') {
    const env = { [name]: String(dir) };
    const signedIn = claudeSignedIn({ env, platform: 'none', readKeychain: null });
    const email = signedIn ? claudeAccount({ env }) : null;
    return { signedIn, ...(email ? { account: email } : {}) };
  }
  return { signedIn: fs.existsSync(path.join(String(dir), 'auth.json')) };
}

module.exports = {
  accountLoginCommand,
  accountStatus,
};
