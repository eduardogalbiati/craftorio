// #319 (acceptance tests, written before the code): whether Claude Code is signed in, read from
// its files, never by spawning anything.
//
// Contract (packages/engine/domains/cli/claude-auth.js, new): claudeSignedIn({ env, home, platform, readKeychain }) ->
// boolean. configDir = env.CLAUDE_CONFIG_DIR or <home>/.claude (the convention of
// packages/engine/domains/cli/cli-config-dirs.js). True when <configDir>/.credentials.json parses with a `claudeAiOauth`
// object that has an accessToken; false when the file is missing, empty or invalid JSON. On
// 'darwin' with no file (Claude Code keeps the token in the Keychain there) it returns
// readKeychain() (injected); on win32/linux readKeychain is not needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/cli/claude-auth');

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-auth-319-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeCreds(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'), content);
}

const VALID = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test', refreshToken: 'r', expiresAt: 0 } });

test('signed in: <home>/.claude/.credentials.json with a claudeAiOauth accessToken', (t) => {
  const home = tmpHome(t);
  writeCreds(path.join(home, '.claude'), VALID);
  for (const platform of ['win32', 'linux']) {
    assert.equal(load().claudeSignedIn({ env: {}, home, platform, readKeychain: undefined }), true, platform);
  }
});

test('CLAUDE_CONFIG_DIR is read instead of <home>/.claude', (t) => {
  const home = tmpHome(t);
  const cfg = path.join(home, 'custom-claude');
  writeCreds(cfg, VALID);
  assert.equal(load().claudeSignedIn({ env: { CLAUDE_CONFIG_DIR: cfg }, home, platform: 'win32' }), true);
  // the default folder alone does not count when CLAUDE_CONFIG_DIR points elsewhere
  const home2 = tmpHome(t);
  writeCreds(path.join(home2, '.claude'), VALID);
  assert.equal(load().claudeSignedIn({ env: { CLAUDE_CONFIG_DIR: path.join(home2, 'empty') }, home: home2, platform: 'linux' }), false);
});

test('not signed in: no file, an empty file, invalid JSON, or no claudeAiOauth accessToken', (t) => {
  const { claudeSignedIn } = load();
  const none = tmpHome(t);
  assert.equal(claudeSignedIn({ env: {}, home: none, platform: 'win32' }), false);
  for (const content of ['', '{not json', JSON.stringify({}), JSON.stringify({ claudeAiOauth: {} }), JSON.stringify({ claudeAiOauth: 'x' })]) {
    const home = tmpHome(t);
    writeCreds(path.join(home, '.claude'), content);
    assert.equal(claudeSignedIn({ env: {}, home, platform: 'linux' }), false, `content ${JSON.stringify(content)}`);
  }
});

test('macOS without the file: the Keychain answers (injected readKeychain)', (t) => {
  const { claudeSignedIn } = load();
  const home = tmpHome(t);
  assert.equal(claudeSignedIn({ env: {}, home, platform: 'darwin', readKeychain: () => true }), true);
  assert.equal(claudeSignedIn({ env: {}, home, platform: 'darwin', readKeychain: () => false }), false);
});

test('macOS with a valid credentials file: signed in', (t) => {
  const home = tmpHome(t);
  writeCreds(path.join(home, '.claude'), VALID);
  assert.equal(load().claudeSignedIn({ env: {}, home, platform: 'darwin', readKeychain: () => false }), true);
});
