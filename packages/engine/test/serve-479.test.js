// #479 (SEC-14), scripts/serve.js: `--host 0.0.0.0` (plain HTTP to the whole network) refuses to start
// unless `--insecure-http` is given, naming the flag and the safer ways (Tailscale / a VPN, or a TLS
// reverse proxy); the start banner says the token is full control of this machine (a shell, gate
// approval, paid runs) and to clear it from the shell history. Spawned on a scratch workspace,
// simulation only, no account (the pattern of test/engine-connection-serve.test.js); a server that
// starts is killed after the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-479-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY: the OS cleans it */ } });
  return dir;
}

// npm run serve with these args → { child, out(), exited }
function serve(t, dir, args) {
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_AUTH: 'off', MULTIAGENT_SERVER_TOKEN: 'serve-479-test-0123456789',
    MULTIAGENT_USER_DATA: path.join(home, 'user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.MULTIAGENT_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'multiagent-engine.js'), '--port', '0', '--workspace', path.join(dir, 'workspace'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '';
  child.stdout.on('data', (c) => { text += c; });
  child.stderr.on('data', (c) => { text += c; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return { child, out: () => text, exited };
}

// waits until the server exits or prints its Open: line (60 s at most)
async function settle(s) {
  for (let i = 0; i < 600 && s.child.exitCode === null && !/Open: http/.test(s.out()); i++) await new Promise((r) => setTimeout(r, 100));
  return s.child.exitCode;
}

// 192.0.2.10 (TEST-NET-1, never a real machine's address) rather than 0.0.0.0: a check must never bind
// every interface (a firewall prompt, the LAN); 0.0.0.0 itself is covered by
// test/engine-connection-479.test.js (resolveListenHost, the rule serve.js applies)
test('#479 npm run serve --host <a LAN address> without --insecure-http exits 1 naming --insecure-http and never listens', async (t) => {
  const s = serve(t, scratch(t), ['--host', '192.0.2.10']);
  const code = await settle(s);
  assert.doesNotMatch(s.out(), /Open: http/, 'it must not start listening');
  assert.equal(code, 1, s.out());
  assert.match(s.out(), /--insecure-http/);
  assert.match(s.out(), /Tailscale|VPN/i, 'names the safer way: Tailscale or a VPN');
  assert.match(s.out(), /TLS/, 'or a reverse proxy with TLS');
});

// 127.0.0.2: an address outside the loopback names serve.js knows (so --insecure-http is needed) that
// still never leaves this machine
test('#479 npm run serve --host <another address> --insecure-http starts and warns about plain HTTP (VPN or TLS proxy only)', { skip: process.platform === 'darwin' && 'no 127.0.0.2 on macOS' }, async (t) => {
  const s = serve(t, scratch(t), ['--host', '127.0.0.2', '--insecure-http']);
  await settle(s);
  assert.match(s.out(), /Open: http/, s.out());
  for (let i = 0; i < 50 && !/plain HTTP/.test(s.out()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(s.out(), /plain HTTP/, s.out());
  assert.match(s.out(), /VPN/);
  assert.match(s.out(), /TLS/);
});

test('#479 npm run serve on 127.0.0.1: the banner says the token is full control of this machine and to clear the shell history', async (t) => {
  const s = serve(t, scratch(t), ['--host', '127.0.0.1']);
  await settle(s);
  assert.match(s.out(), /Open: http/, s.out());
  assert.match(s.out(), /full control of this machine/i);
  assert.match(s.out(), /shell/i);
  assert.match(s.out(), /gate/i);
  assert.match(s.out(), /paid runs/i);
  assert.match(s.out(), /shell history/i);
});
