// #479/#481 (SEC-16, SEC-25), src/control/index.js: the control channel shares the engine server's
// loopback Host check (isLoopbackHost with its port): [::1]:<port> is accepted like 127.0.0.1:<port>,
// another port or no port is refused with 403; endpoint.json (its token) is mode 0600 on POSIX, also
// when the file was already there with wider permissions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeService } = require('./service/helpers');
const { createControlChannel } = require('../src/control');

async function openChannel(t, service) {
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  await control.update();
  const file = path.join(service.workspace().root, 'control', 'endpoint.json');
  return { control, file, endpoint: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// POST <endpoint>/api/settings:get with exactly this Host header
function call(endpoint, host) {
  const url = new URL(`${endpoint.url}/api/settings:get`);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.token}`, host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end('{}');
  });
}

test('#481 control channel: Host [::1]:<port> and localhost:<port> are accepted; no port, another port or another name are refused', async (t) => {
  const { service } = makeService(t);
  const { endpoint } = await openChannel(t, service);
  const port = new URL(endpoint.url).port;
  assert.equal(await call(endpoint, `[::1]:${port}`), 200);
  assert.equal(await call(endpoint, `localhost:${port}`), 200);
  assert.equal(await call(endpoint, 'localhost'), 403);
  assert.equal(await call(endpoint, `localhost:${Number(port) + 1}`), 403);
  assert.equal(await call(endpoint, `attacker.example:${port}`), 403);
});

test('#481 control channel: endpoint.json is mode 0600, also when it was there before as 0644', { skip: process.platform === 'win32' && 'POSIX file modes' }, async (t) => {
  const { service } = makeService(t);
  const file = path.join(service.workspace().root, 'control', 'endpoint.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  await openChannel(t, service);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
});
