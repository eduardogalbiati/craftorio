// Sign-in off (`enabled: false` in domains/account/auth-config.js): the engine server, started without
// MULTIAGENT_AUTH=off, has nothing to sign in to, so the UI shows no sign-in screen (ui-kit/account.js
// shows it only when `required`). Spawned on a scratch workspace, simulation only. When sign-in comes back,
// this test goes with the switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const authConfig = require('../../domains/account/auth-config');

const TOKEN = 'sign-in-off-test-0123456789';

test('sign-in off: a server without MULTIAGENT_AUTH=off requires no account and says so', async (t) => {
  assert.equal(authConfig.enabled, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-in-off-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY: the OS cleans it */ } });
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_SERVER_TOKEN: TOKEN,
    MULTIAGENT_USER_DATA: path.join(home, 'user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.MULTIAGENT_AUTH;
  delete env.MULTIAGENT_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const bin = path.join(__dirname, '..', '..', 'bin', 'craftorio-engine.js');
  const child = spawn(process.execPath, [bin, '--port', '0', '--workspace', path.join(dir, 'workspace')], { env });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });

  for (let i = 0; i < 600 && child.exitCode === null && !/Sign-in is off/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(out, /Sign-in is off/);
  const base = out.match(/Open: (http:\/\/[^/\s]+)/)[1];
  const res = await fetch(`${base}/api/${encodeURIComponent('auth:state')}`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.required, false);
  assert.equal(result.configured, false);
  assert.equal(result.user, null);
});
