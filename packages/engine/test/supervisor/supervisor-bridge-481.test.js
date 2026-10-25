// #481 (SEC-21), packages/engine/domains/supervisor/supervisor-bridge.js: the bearer token is compared in constant time (the
// server's tokenCheck). Behaviour, whatever the comparison: a wrong token of the same length and one
// of another length are both refused (403), the right one is accepted. Green before the change too
// (the behaviour does not change; only the timing does).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createBridge } = require('../../domains/supervisor/supervisor-bridge');

function list(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}/tools/list`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

test('#481 bridge token: same-length wrong, other-length wrong are refused (403), the right one answers 200', async (t) => {
  const bridge = createBridge({ tools: () => [] });
  t.after(() => bridge.close());
  const { url, token } = await bridge.start();
  const sameLength = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal(sameLength.length, token.length);
  assert.equal(await list(url, sameLength), 403);
  assert.equal(await list(url, token.slice(0, 10)), 403);
  assert.equal(await list(url, token), 200);
});
