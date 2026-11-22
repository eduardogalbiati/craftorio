// #479 (SEC-14) and #481 (SEC-16, SEC-17), packages/engine/server/index.js:
// - DNS rebinding: a server bound to loopback answers only requests whose Host is localhost,
//   127.0.0.1 or [::1] (with its port); another Host is refused with 403 (as packages/engine/control/index.js does),
//   on HTTP and on the WebSocket upgrade.
// - The token cookie (multiagent_token) has a Max-Age, and `Secure` when the request came over HTTPS
//   (x-forwarded-proto: https, a TLS reverse proxy), never on plain http.
// - POST /session (form body token=<token>, application/x-www-form-urlencoded): the one-shot sign-in
//   that keeps the token out of the address bar and the history; the right token sets the cookie and
//   answers 303 to /, a wrong one 401 without a cookie. `/?token=` keeps working (the desktop app's
//   startUrl, test/engine-connection-serve.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { setupWorkspace } = require('../domains/workspace/workspace');
const { createService } = require('../service');
const { createServer } = require('../server');

const TOKEN = 'test-token-479-0123456789abcdef';

async function start(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-479-'));
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const service = createService({ host: { trashItem: async () => {}, appVersion: '1.2.3', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const server = createServer({ service, token: TOKEN, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(async () => {
    service.shutdown();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { port };
}

// a raw request to 127.0.0.1:<port> with exactly these headers (Host included)
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).join('\n');
const form = () => ({ 'Content-Type': 'application/x-www-form-urlencoded' });

test('#479 Host check: a loopback server refuses a request whose Host is another name (DNS rebinding) with 403', async (t) => {
  const { port } = await start(t);
  const res = await request(port, { path: '/api/version', headers: { Host: `attacker.example:${port}`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 403);
});

test('#479 Host check: localhost:<port>, 127.0.0.1:<port> and [::1]:<port> still work with the bearer token', async (t) => {
  const { port } = await start(t);
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    const res = await request(port, { path: '/api/version', headers: { Host: host, Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200, host);
  }
});

test('#479 Host check: the WebSocket upgrade with another Host is refused with 403', async (t) => {
  const { port } = await start(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws',
      headers: {
        Host: `attacker.example:${port}`, Authorization: `Bearer ${TOKEN}`,
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('#481 POST /session with the right token (form body) sets the cookie and answers 303 to /', async (t) => {
  const { port } = await start(t);
  const res = await request(port, { method: 'POST', path: '/session', headers: { ...form(), Host: `127.0.0.1:${port}` }, body: `token=${encodeURIComponent(TOKEN)}` });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/');
  assert.match(cookieOf(res), /^multiagent_token=/);
  assert.match(cookieOf(res), /HttpOnly/);
});

// green today too (every request without the token is a 401): kept as the contract of the new path
test('#481 POST /session with a wrong token is refused (401) and sets no cookie', async (t) => {
  const { port } = await start(t);
  const res = await request(port, { method: 'POST', path: '/session', headers: { ...form(), Host: `127.0.0.1:${port}` }, body: 'token=wrong-token-0123456789abcdef' });
  assert.equal(res.status, 401);
  assert.equal(cookieOf(res), '');
});

test('#481 the cookie gets Secure when the request came over HTTPS (x-forwarded-proto: https)', async (t) => {
  const { port } = await start(t);
  const res = await request(port, { method: 'POST', path: '/session', headers: { ...form(), Host: `127.0.0.1:${port}`, 'X-Forwarded-Proto': 'https' }, body: `token=${encodeURIComponent(TOKEN)}` });
  assert.match(cookieOf(res), /^multiagent_token=/);
  assert.match(cookieOf(res), /;\s*Secure/i);
});

test('#479 hostAllowed: a server bound to another address (0.0.0.0, a Tailscale IP) accepts any Host; a loopback one only loopback names', () => {
  const { hostAllowed } = require('../server');
  const req = (host) => ({ headers: { host } });
  assert.equal(hostAllowed(req('attacker.example:7300'), '0.0.0.0'), true);
  assert.equal(hostAllowed(req('my-pc:7300'), '100.101.102.103'), true);
  assert.equal(hostAllowed(req('attacker.example:7300'), '127.0.0.1'), false);
  assert.equal(hostAllowed(req('attacker.example:7300'), '::ffff:127.0.0.1'), false);
  assert.equal(hostAllowed(req('attacker.example:7300'), '::1'), false);
  assert.equal(hostAllowed(req('localhost:7300'), '127.0.0.1'), true);
});

test('#479 isLoopbackHost: loopback names, with the port when one is required', () => {
  const { isLoopbackHost } = require('../server');
  assert.equal(isLoopbackHost('[::1]:7301', 7301), true);
  assert.equal(isLoopbackHost('LOCALHOST:7301', 7301), true);
  assert.equal(isLoopbackHost('127.0.0.1:7301', '7301'), true);
  assert.equal(isLoopbackHost('localhost', 7301), false, 'no port when one is required');
  assert.equal(isLoopbackHost('localhost:7302', 7301), false, 'another port');
  assert.equal(isLoopbackHost('localhost'), true, 'no port required');
  assert.equal(isLoopbackHost('localhost.attacker.example'), false);
  assert.equal(isLoopbackHost('127.0.0.1.nip.io:7301'), false);
  assert.equal(isLoopbackHost(undefined), false);
});

test('#479 sliding cookie: a request authorised by the cookie gets it again with Max-Age; one with the bearer token gets none', async (t) => {
  const { port } = await start(t);
  const byCookie = await request(port, { path: '/api/version', headers: { Host: `127.0.0.1:${port}`, Cookie: `multiagent_token=${encodeURIComponent(TOKEN)}` } });
  assert.equal(byCookie.status, 200);
  assert.match(cookieOf(byCookie), /^multiagent_token=/);
  assert.match(cookieOf(byCookie), /;\s*Max-Age=\d+/);
  const byBearer = await request(port, { path: '/api/version', headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(byBearer.status, 200);
  assert.equal(cookieOf(byBearer), '');
});

test('#479 a wrong cookie is refused (401) and gets no cookie back', async (t) => {
  const { port } = await start(t);
  const res = await request(port, { path: '/api/version', headers: { Host: `127.0.0.1:${port}`, Cookie: 'multiagent_token=wrong-token-0123456789abcdef' } });
  assert.equal(res.status, 401);
  assert.equal(cookieOf(res), '');
});

test('#481 the cookie has a Max-Age and no Secure over plain http (/?token= and POST /session)', async (t) => {
  const { port } = await start(t);
  const viaUrl = await request(port, { path: `/?token=${encodeURIComponent(TOKEN)}`, headers: { Host: `127.0.0.1:${port}` } });
  assert.equal(viaUrl.status, 302, '/?token= keeps working (the desktop app\'s startUrl)');
  assert.match(cookieOf(viaUrl), /;\s*Max-Age=\d+/);
  assert.doesNotMatch(cookieOf(viaUrl), /Secure/i);
  const viaForm = await request(port, { method: 'POST', path: '/session', headers: { ...form(), Host: `127.0.0.1:${port}` }, body: `token=${encodeURIComponent(TOKEN)}` });
  assert.match(cookieOf(viaForm), /;\s*Max-Age=\d+/);
  assert.doesNotMatch(cookieOf(viaForm), /Secure/i);
});

// #541: `tailscale serve` (HTTPS on the tailnet) proxies to the loopback server and forwards the
// browser's Host unchanged (`<machine>.<tailnet>.ts.net:8443`, or no port on 443). The names a
// loopback server also answers come from createServer({ allowedHosts }) (the bin's --allow-host or the
// machine's own MagicDNS name), never from a request header; matched exactly, case-insensitively.
const TS_NAME = 'desktop-ifrssed.tail522a91.ts.net';

function upgrade(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

test('#541 a loopback server answers an allowed tailscale serve name, with a port and without one (443)', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  for (const host of [`${TS_NAME}:8443`, TS_NAME]) {
    const res = await request(port, { path: '/api/version', headers: { Host: host, Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200, host);
  }
});

test('#541 the allowed name is matched case-insensitively (an upper-case option or Host)', async (t) => {
  const { port } = await start(t, { allowedHosts: ['Desktop-IFRSSED.tail522a91.TS.NET'] });
  const lower = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(lower.status, 200);
  const upper = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME.toUpperCase()}:8443`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(upper.status, 200);
});

test('#541 the MagicDNS form with its trailing dot (Self.DNSName) allows the name the browser sends', async (t) => {
  const { port } = await start(t, { allowedHosts: [`${TS_NAME}.`] });
  const res = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
});

test('#541 an allowed name keeps the token check: no token is 401, a wrong cookie is 401', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  const none = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443` } });
  assert.equal(none.status, 401);
  const wrong = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Cookie: 'multiagent_token=wrong-token-0123456789abcdef' } });
  assert.equal(wrong.status, 401);
});

test('#541 an allowed name keeps the Origin check: same ts.net origin passes, another origin is 403', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  const same = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Origin: `https://${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(same.status, 200);
  const other = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Origin: 'https://attacker.example', Authorization: `Bearer ${TOKEN}` } });
  assert.equal(other.status, 403);
});

test('#541 the sign-in form works through the allowed name over HTTPS (Secure cookie, 303 to /)', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  const res = await request(port, {
    method: 'POST', path: '/session',
    headers: { ...form(), Host: TS_NAME, Origin: `https://${TS_NAME}`, 'X-Forwarded-Proto': 'https' },
    body: `token=${encodeURIComponent(TOKEN)}`,
  });
  assert.equal(res.status, 303);
  assert.match(cookieOf(res), /^multiagent_token=/);
  assert.match(cookieOf(res), /;\s*Secure/i);
});

test('#541 the WebSocket upgrade through the allowed name is accepted (101), another name still 403', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  assert.equal(await upgrade(port, { Host: `${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}` }), 101);
  assert.equal(await upgrade(port, { Host: `attacker.example:${port}`, Authorization: `Bearer ${TOKEN}` }), 403);
});

test('#541 SEC-16 still holds with an allowed name: other names, suffixes and look-alikes are 403', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  for (const host of [
    `attacker.example:${port}`,
    `evil.${TS_NAME}:8443`, // a subdomain: never a suffix match
    `${TS_NAME}.attacker.example:8443`, // the name as a prefix of another site's name
    `x${TS_NAME}`,
    'other-machine.tail522a91.ts.net:8443', // another machine of the same tailnet
    'tail522a91.ts.net',
  ]) {
    const res = await request(port, { path: '/api/version', headers: { Host: host, Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 403, host);
  }
});

test('#541 a request header never adds an allowed name (Tailscale-User-Login, X-Forwarded-Host)', async (t) => {
  const { port } = await start(t);
  const res = await request(port, {
    path: '/api/version',
    headers: {
      Host: `${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}`,
      'Tailscale-User-Login': 'owner@example.com', 'Tailscale-User-Name': 'Owner', 'X-Forwarded-Host': `127.0.0.1:${port}`, 'X-Forwarded-For': '100.84.99.15',
    },
  });
  assert.equal(res.status, 403);
});

test('#541 a loopback server without allowed names refuses the ts.net name as before (403)', async (t) => {
  for (const options of [{}, { allowedHosts: [] }]) {
    const { port } = await start(t, options);
    const res = await request(port, { path: '/api/version', headers: { Host: `${TS_NAME}:8443`, Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 403, JSON.stringify(options));
  }
});

test('#541 normalizeHostName: lower case, no surrounding spaces, no trailing dot; empty stays empty', () => {
  const { normalizeHostName } = require('../server');
  assert.equal(normalizeHostName(' Desktop-IFRSSED.tail522a91.TS.NET. '), TS_NAME);
  assert.equal(normalizeHostName(TS_NAME), TS_NAME);
  assert.equal(normalizeHostName(''), '');
  assert.equal(normalizeHostName(undefined), '');
  assert.equal(normalizeHostName(null), '');
});

test('#541 the 403 for another name lists the names the server answers, the allowed ones included', async (t) => {
  const { port } = await start(t, { allowedHosts: [`${TS_NAME}.`] });
  const res = await request(port, { path: '/api/version', headers: { Host: `attacker.example:${port}`, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 403);
  assert.match(res.text, /localhost/);
  assert.ok(res.text.includes(TS_NAME), res.text);
});

test('#541 hostAllowed with allowed names: exact name with or without a port on loopback; ignored off loopback', () => {
  const { hostAllowed } = require('../server');
  const req = (host) => ({ headers: { host } });
  assert.equal(hostAllowed(req(`${TS_NAME}:8443`), '127.0.0.1', [TS_NAME]), true);
  assert.equal(hostAllowed(req(TS_NAME), '::1', [TS_NAME]), true);
  assert.equal(hostAllowed(req(`evil.${TS_NAME}`), '127.0.0.1', [TS_NAME]), false);
  assert.equal(hostAllowed(req(undefined), '127.0.0.1', [TS_NAME]), false);
  assert.equal(hostAllowed(req(`${TS_NAME}:8443`), '127.0.0.1'), false, 'no allowed names: as before');
  assert.equal(hostAllowed(req('attacker.example'), '0.0.0.0', [TS_NAME]), true, 'another address behaves as today');
});

test('#541 loopback names still work on a server with allowed names', async (t) => {
  const { port } = await start(t, { allowedHosts: [TS_NAME] });
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    const res = await request(port, { path: '/api/version', headers: { Host: host, Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200, host);
  }
});
