// The desktop app's handshake with a real `npm run serve` (scripts/serve.js, started by the contract
// suite's harness on a scratch workspace, simulation only, no account): the connection test with
// the token (and a refused one), then what the remote window's first load does: `/?token=` sets the
// cookie, the app's page and its manifest follow with it, in the contract the test reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const conn = require('../src/engine-connection');
const { startEngine } = require('./contract/harness');
const PKG = require('../package.json');

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
  assert.equal(root.headers.get('location'), '/src/renderer/index.html');
  const page = await fetch(`${engine.url}/src/renderer/index.html`, { headers: { cookie } });
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
