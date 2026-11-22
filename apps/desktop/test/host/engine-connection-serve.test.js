// The desktop app's handshake with a real `npm run serve` (scripts/serve.js, started by the contract
// suite's harness on a scratch workspace, simulation only, no account): the connection test with
// the token (and a refused one), then what the remote window's first load does: `/?token=` sets the
// cookie, the app's page and its manifest follow with it, in the contract the test reported. And
// one engine per workspace: the server holds the workspace lock (#112) as the desktop app does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const conn = require('../../host/engine-connection');
const { startEngine } = require('@craftorio/engine/test/contract/harness');
const PKG = require('../../../../package.json');

test('the connection test and the remote window\'s first load against npm run serve', async (t) => {
  const engine = await startEngine();
  t.after(() => engine.stop());

  const ok = await conn.testConnection({ address: engine.url, token: engine.token });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.app, PKG.version);
  assert.match(ok.contract, /^[0-9a-f]{6,16}$/);
  assert.equal(ok.url, engine.url);

  const refused = await conn.testConnection({ address: engine.url, token: `${engine.token}-wrong` });
  assert.deepEqual([refused.ok, refused.reason, refused.status], [false, 'token', 401]);

  // the remote window loads startUrl: the server keeps the token in a cookie and drops it from the address
  const first = await fetch(conn.startUrl(engine.url, engine.token), { redirect: 'manual' });
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('location'), '/');
  const cookie = String(first.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^multiagent_token=/);

  const root = await fetch(`${engine.url}/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/apps/web/renderer/index.html');
  const page = await fetch(`${engine.url}/apps/web/renderer/index.html`, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /api-http\.js/);
  assert.match(html, /views\/settings\/settings-engine\.js/);

  const manifest = await (await fetch(`${engine.url}/api/manifest`, { headers: { cookie } })).json();
  assert.equal(manifest.contract, ok.contract, 'the page is built for the contract the test reported');
  assert.ok(manifest.result.some((e) => e.channel === 'engine:openConnection' && e.desktop), 'Change… is declared for the page');

  // the connection path is the desktop window's, never served
  const caught = await fetch(`${engine.url}${conn.CONNECTION_PATH}`, { headers: { cookie } });
  assert.equal(caught.status, 404);
});

// npm run serve on a scratch workspace → { child, out(), exited }; simulation only, no account
function serve(t, workspace) {
  const home = path.join(path.dirname(workspace), 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_AUTH: 'off', MULTIAGENT_SERVER_TOKEN: 'serve-lock-test-0123456789',
    MULTIAGENT_USER_DATA: path.join(home, 'user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.MULTIAGENT_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', 'bin', 'craftorio-engine.js'), '--port', '0', '--workspace', workspace], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '';
  child.stdout.on('data', (c) => { text += c; });
  child.stderr.on('data', (c) => { text += c; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return { child, out: () => text, exited };
}

test('one engine per workspace: npm run serve holds the workspace lock, a second one on it refuses to start', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-lock-'));
  t.after(() => { try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY: the OS cleans it */ } });
  const workspace = path.join(scratch, 'workspace');
  const first = serve(t, workspace);
  for (let i = 0; i < 600 && !/Open: http/.test(first.out()); i++) {
    if (first.child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(first.out(), /Open: http/, first.out());
  assert.ok(fs.existsSync(path.join(workspace, '.lock')), 'the server holds the workspace lock');

  const second = serve(t, workspace);
  const code = await second.exited;
  assert.equal(code, 1, second.out());
  assert.match(second.out(), /This workspace is already open in process \d+/);
  assert.match(second.out(), /Close the desktop app \(or the other server\) on this computer first, or pass --workspace/);
});
