// The supervisor's loopback bridge (#28, src/supervisor-bridge.js): the MCP server
// (src/supervisor-mcp.js, a child of `claude`) reaches the app's tools (src/supervisor-tools.js)
// through it, over 127.0.0.1 with a bearer token only that turn's MCP config knows.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createBridge } = require('../src/supervisor-bridge');

function post(url, route, { body, token, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(`${url}${route}`, {
      method,
      headers: { ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('start() resolves a 127.0.0.1 url and token, and a second call resolves the same promise', async (t) => {
  const bridge = createBridge({ tools: () => [] });
  t.after(() => bridge.close());
  const a = await bridge.start();
  const b = await bridge.start();
  assert.equal(a, b);
  assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(a.token, /^[0-9a-f]{48}$/);
});

test('POST /tools/list and /tools/call answer with a valid bearer token', async (t) => {
  const tool = { name: 'echo', description: 'echoes its arg', inputSchema: { type: 'object' }, run: ({ x }) => `got ${x}` };
  const bridge = createBridge({ tools: () => [tool] });
  t.after(() => bridge.close());
  const { url, token } = await bridge.start();

  const list = await post(url, '/tools/list', { token, body: {} });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.tools, [{ name: 'echo', description: 'echoes its arg', inputSchema: { type: 'object' } }]);

  const call = await post(url, '/tools/call', { token, body: { name: 'echo', arguments: { x: 1 } } });
  assert.equal(call.status, 200);
  assert.deepEqual(call.json, { text: 'got 1', isError: false });
});

test('a missing or wrong bearer token gives 403', async (t) => {
  const bridge = createBridge({ tools: () => [] });
  t.after(() => bridge.close());
  const { url, token } = await bridge.start();
  assert.equal((await post(url, '/tools/list', { body: {} })).status, 403);
  assert.equal((await post(url, '/tools/list', { token: `${token}x`, body: {} })).status, 403);
});

test('GET gives 403, an unknown route gives 404, invalid JSON gives 400', async (t) => {
  const bridge = createBridge({ tools: () => [] });
  t.after(() => bridge.close());
  const { url, token } = await bridge.start();
  assert.equal((await post(url, '/tools/list', { token, method: 'GET' })).status, 403);
  assert.equal((await post(url, '/nope', { token, body: {} })).status, 404);
  const bad = await new Promise((resolve, reject) => {
    const req = http.request(`${url}/tools/list`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end('{not json');
  });
  assert.equal(bad.status, 400);
});

test('close() stops the server: a request after close is refused', async (t) => {
  const bridge = createBridge({ tools: () => [] });
  t.after(() => { try { bridge.close(); } catch { /* already closed */ } });
  const { url, token } = await bridge.start();
  bridge.close();
  await assert.rejects(() => post(url, '/tools/list', { token, body: {} }));
});
