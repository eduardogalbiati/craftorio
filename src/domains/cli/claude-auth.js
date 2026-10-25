// Whether Claude Code is signed in (#319), for Settings › Agents & CLIs and the first-run Setup.
// Read from Claude Code's own files, never by running `claude`: any `claude` call that reaches the
// model costs tokens, and `claude -p` without credentials waits on a login prompt.
// Why the files are reliable: `/login` (and `claude setup-token`) store the OAuth token in
// <config dir>/.credentials.json as { claudeAiOauth: { accessToken, refreshToken, expiresAt } }
// on Windows and Linux, and `/logout` deletes it; on macOS Claude Code keeps the same JSON in the
// login Keychain under the service "Claude Code-credentials" instead, so there the Keychain is asked
// (`security find-generic-password` without -w: it reads the item's attributes, not the secret,
// so it never shows an access prompt). The config dir is CLAUDE_CONFIG_DIR or ~/.claude, as in
// src/domains/cli/cli-config-dirs.js. An ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the environment also
// counts: Claude Code uses it without a login. An expired access token still counts: Claude Code
// refreshes it by itself with the refresh token.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function credentialsFileSignedIn(configDir) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8')); } catch { return false; }
  const oauth = data && data.claudeAiOauth;
  return !!(oauth && typeof oauth === 'object' && typeof oauth.accessToken === 'string' && oauth.accessToken);
}

/** macOS: whether the Keychain has Claude Code's credentials item (exit 0 = found). */
function macKeychainHasClaude() {
  try {
    execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch { return false; }
}

/** True when Claude Code has credentials; never spawns `claude` (see the header). */
function claudeSignedIn({ env = process.env, home = os.homedir(), platform = process.platform, readKeychain = macKeychainHasClaude } = {}) {
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  if (credentialsFileSignedIn(configDir)) return true;
  if (platform === 'darwin' && typeof readKeychain === 'function') return !!readKeychain();
  return false;
}

/** The signed-in account's e-mail from Claude Code's config file (oauthAccount), or null. */
function claudeAccount({ env = process.env, home = os.homedir() } = {}) {
  const file = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.oauthAccount?.emailAddress || null; } catch { return null; }
}

module.exports = {
  claudeAccount,
  claudeSignedIn,
};
