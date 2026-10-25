// The engine connection's pure rules (src/host/engine-connection.js): the address typed, the per-machine
// setting and its encrypted token, the mode decided at start, the connection test (an injected
// fetch), the remote window's navigation and permission rules, the server's addresses
// (`npm run serve -- --host tailscale`), and the browser client's side (src/renderer/api-http.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const conn = require('../../src/host/engine-connection');

const tmpFile = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-connection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'user-data', conn.FILE);
};

// ---- parseAddress ------------------------------------------------------------------------

test('an address without a port takes the engine\'s 7300; host:port keeps its port', () => {
  assert.equal(conn.parseAddress('desktop-ifrssed.tail522a91.ts.net').url, 'http://desktop-ifrssed.tail522a91.ts.net:7300');
  assert.equal(conn.parseAddress('  100.84.99.15  ').url, 'http://100.84.99.15:7300');
  assert.equal(conn.parseAddress('100.84.99.15:7400').url, 'http://100.84.99.15:7400');
  assert.equal(conn.parseAddress('My-PC:7300/').url, 'http://my-pc:7300');
  const p = conn.parseAddress('desktop-ifrssed');
  assert.equal(p.host, 'desktop-ifrssed:7300');
  assert.equal(p.hostname, 'desktop-ifrssed');
  assert.equal(p.port, 7300);
  assert.equal(p.secure, false);
});

test('a full URL: http without a port is 7300 too, https keeps 443 (tailscale serve), a typed port stays', () => {
  assert.equal(conn.parseAddress('http://my-pc').url, 'http://my-pc:7300');
  assert.equal(conn.parseAddress('http://my-pc:80').url, 'http://my-pc');
  assert.equal(conn.parseAddress('https://my-pc.tailnet.ts.net').url, 'https://my-pc.tailnet.ts.net');
  assert.equal(conn.parseAddress('https://my-pc.tailnet.ts.net').port, 443);
  assert.equal(conn.parseAddress('https://my-pc.tailnet.ts.net:8443/').url, 'https://my-pc.tailnet.ts.net:8443');
  assert.equal(conn.parseAddress('HTTP://My-PC:7300').url, 'http://my-pc:7300');
});

test('IPv6 addresses go in brackets', () => {
  assert.equal(conn.parseAddress('[fd7a:115c:a1e0::1]').url, 'http://[fd7a:115c:a1e0::1]:7300');
  assert.equal(conn.parseAddress('[::1]:7301').url, 'http://[::1]:7301');
  assert.match(conn.parseAddress('fd7a::1').error, /brackets/);
});

test('the URL the server printed, pasted whole, gives the address and its token', () => {
  const p = conn.parseAddress('http://100.84.99.15:7300/?token=abc_DEF-123');
  assert.equal(p.url, 'http://100.84.99.15:7300');
  assert.equal(p.token, 'abc_DEF-123');
  assert.equal(conn.parseAddress('100.84.99.15:7300/?token=xyz').token, 'xyz');
  assert.equal(conn.parseAddress('100.84.99.15').token, undefined);
});

test('what is not an engine address is refused with a reason', () => {
  assert.match(conn.parseAddress('').error, /Type the engine's address/);
  assert.match(conn.parseAddress('   ').error, /Type the engine's address/);
  assert.match(conn.parseAddress(null).error, /Type the engine's address/);
  assert.match(conn.parseAddress('ftp://my-pc').error, /http:\/\/ or https:\/\//);
  assert.match(conn.parseAddress('ws://my-pc:7300').error, /not ws:\/\//);
  assert.match(conn.parseAddress('http://my-pc:7300/src/renderer/index.html').error, /without a path/);
  assert.match(conn.parseAddress('my-pc:7300/?token=a&x=1').error, /without a path/);
  assert.match(conn.parseAddress('http://my-pc:7300/#x').error, /without a path/);
  assert.match(conn.parseAddress('http://me:secret@my-pc').error, /user name and password/);
  assert.match(conn.parseAddress('my pc').error, /Not an address/);
  assert.match(conn.parseAddress('my-pc:99999').error, /Not an address/);
});

// ---- the setting ---------------------------------------------------------------------------

const reverse = (s) => [...String(s)].reverse().join('');
const encrypt = (s) => Buffer.from(reverse(s), 'utf8');
const decrypt = (b) => reverse(b.toString('utf8'));

test('no setting, or a corrupt one, is this computer', (t) => {
  const file = tmpFile(t);
  assert.deepEqual(conn.readConnection(file, { decrypt }), { mode: 'local', address: '', token: '' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(conn.readConnection(file, { decrypt }), { mode: 'local', address: '', token: '' });
  fs.writeFileSync(file, JSON.stringify({ mode: 'elsewhere', address: 42 }));
  assert.deepEqual(conn.readConnection(file, { decrypt }), { mode: 'local', address: '', token: '' });
});

test('the setting round-trips; the token is written encrypted, never in clear', (t) => {
  const file = tmpFile(t);
  const token = 'secret-token-0123456789';
  conn.writeConnection(file, { mode: 'remote', address: 'http://my-pc:7300', token }, { encrypt });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(token), 'the token is not in the file in clear');
  assert.equal(JSON.parse(raw).token.encrypted, encrypt(token).toString('base64'));
  assert.deepEqual(conn.readConnection(file, { decrypt }), { mode: 'remote', address: 'http://my-pc:7300', token });
});

test('without encryption on the computer the token is kept as is; a token that cannot be decrypted reads as none', (t) => {
  const file = tmpFile(t);
  conn.writeConnection(file, { mode: 'remote', address: 'my-pc', token: 'plain-token-0123456789' }, { encrypt: null });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token.plain, 'plain-token-0123456789');
  assert.equal(conn.readConnection(file).token, 'plain-token-0123456789');

  conn.writeConnection(file, { mode: 'remote', address: 'my-pc', token: 'enc-token-0123456789' }, { encrypt });
  const errors = [];
  const original = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    const read = conn.readConnection(file, { decrypt: () => { throw new Error('another OS user'); } });
    assert.equal(read.mode, 'remote');
    assert.equal(read.token, '');
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /could not read the saved token: another OS user/);
  // and no decrypt function at all: no token
  assert.equal(conn.readConnection(file).token, '');
});

test('a local setting keeps no token key when there is none; the view never carries the token', (t) => {
  const file = tmpFile(t);
  conn.writeConnection(file, { mode: 'local' }, { encrypt });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mode: 'local', address: '' });
  const view = conn.connectionView({ mode: 'remote', address: 'my-pc', token: 'secret-token-0123456789' });
  assert.deepEqual(view, { mode: 'remote', address: 'my-pc', hasToken: true });
  assert.ok(!JSON.stringify(view).includes('secret'));
});

// ---- decideMode ----------------------------------------------------------------------------

const REMOTE = { mode: 'remote', address: 'http://desktop-ifrssed.tail522a91.ts.net:7300', token: 'tok-0123456789abcdef' };

test('the default is this computer; a remote setting gives the engine\'s URL and token', () => {
  assert.deepEqual(conn.decideMode({ connection: null }), { mode: 'local' });
  assert.deepEqual(conn.decideMode({ connection: { mode: 'local', address: 'x', token: 'y' } }), { mode: 'local' });
  assert.deepEqual(conn.decideMode({ connection: REMOTE, env: {} }), {
    mode: 'remote', address: REMOTE.address, url: 'http://desktop-ifrssed.tail522a91.ts.net:7300', host: 'desktop-ifrssed.tail522a91.ts.net:7300', token: REMOTE.token,
  });
});

test('MULTIAGENT_ENGINE=local forces this computer', () => {
  const d = conn.decideMode({ connection: REMOTE, env: { MULTIAGENT_ENGINE: 'local' } });
  assert.equal(d.mode, 'local');
  assert.match(d.reason, /MULTIAGENT_ENGINE=local/);
});

test('a remote setting that cannot be used stays remote with the reason (the connection page shows it)', () => {
  const bad = conn.decideMode({ connection: { ...REMOTE, address: 'ftp://x' } });
  assert.equal(bad.mode, 'remote');
  assert.match(bad.error, /not valid/);
  const noToken = conn.decideMode({ connection: { ...REMOTE, token: '' } });
  assert.equal(noToken.mode, 'remote');
  assert.match(noToken.error, /No token/);
  assert.equal(noToken.url, 'http://desktop-ifrssed.tail522a91.ts.net:7300');
});

test('simulation only: a remote engine is used only on this computer', () => {
  const env = { MULTIAGENT_SIMULATION_ONLY: '1' };
  const away = conn.decideMode({ connection: REMOTE, env });
  assert.equal(away.mode, 'local');
  assert.match(away.reason, /Simulation only/);
  for (const address of ['127.0.0.1:7311', 'localhost:7311', '[::1]:7311']) {
    assert.equal(conn.decideMode({ connection: { ...REMOTE, address }, env }).mode, 'remote', address);
  }
});

// ---- testConnection ------------------------------------------------------------------------

const answer = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => { if (body === undefined) throw new SyntaxError('Unexpected token <'); return body; },
});
const failing = (code, message = code) => async () => {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error(message), { code });
  throw e;
};

test('the test asks GET /api/version with the token and gives the engine\'s version and contract', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return answer(200, { app: '1.4.0', contract: 'abc123' })(); };
  const r = await conn.testConnection({ address: 'desktop-ifrssed', token: ' tok-1 ', fetch, localContract: 'abc123' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://desktop-ifrssed:7300/api/version');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok-1');
  assert.ok(calls[0].opts.signal, 'the request has a timeout');
  assert.deepEqual(
    { ok: r.ok, url: r.url, host: r.host, app: r.app, contract: r.contract, sameContract: r.sameContract },
    { ok: true, url: 'http://desktop-ifrssed:7300', host: 'desktop-ifrssed:7300', app: '1.4.0', contract: 'abc123', sameContract: true },
  );
  assert.equal(r.message, 'Connected: engine 1.4.0 (interface abc123).');
});

test('an engine speaking another contract connects, with a warning naming both', async () => {
  const r = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(200, { app: '1.5.0', contract: 'fff000' }), localContract: 'abc123' });
  assert.equal(r.ok, true);
  assert.equal(r.sameContract, false);
  assert.match(r.message, /another interface than this app \(abc123\)/);
  assert.match(r.message, /engine 1\.5\.0 \(interface fff000\)/);
});

test('the token of a pasted URL is used when the token field is blank', async () => {
  let auth = null;
  const fetch = async (_url, opts) => { auth = opts.headers.Authorization; return answer(200, { app: '1', contract: 'c' })(); };
  const r = await conn.testConnection({ address: 'http://my-pc:7300/?token=from-url', token: '', fetch });
  assert.equal(r.ok, true);
  assert.equal(auth, 'Bearer from-url');
});

test('the test fails with a reason: bad address, no token, refused token, not an engine, another HTTP error', async () => {
  let called = 0;
  const never = async () => { called++; throw new Error('not called'); };
  const address = await conn.testConnection({ address: 'ftp://x', token: 't', fetch: never });
  assert.deepEqual([address.ok, address.reason], [false, 'address']);
  const noToken = await conn.testConnection({ address: 'my-pc', token: '  ', fetch: never });
  assert.deepEqual([noToken.ok, noToken.reason], [false, 'token']);
  assert.match(noToken.message, /MULTIAGENT_SERVER_TOKEN/);
  assert.equal(called, 0, 'nothing is asked without an address and a token');

  const refused = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(401, { error: 'Missing or invalid token' }) });
  assert.deepEqual([refused.reason, refused.status], ['token', 401]);
  assert.match(refused.message, /refused the token/);
  const notFound = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(404, { error: 'Not found.' }) });
  assert.equal(notFound.reason, 'not-engine');
  const html = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(200) });
  assert.equal(html.reason, 'not-engine');
  assert.match(html.message, /not a Multiagent Orchestrator engine/);
  const other = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(200, { result: [] }) });
  assert.equal(other.reason, 'not-engine');
  const broken = await conn.testConnection({ address: 'my-pc', token: 't', fetch: answer(500, { error: 'boom' }) });
  assert.deepEqual([broken.reason, broken.status], ['http', 500]);
  assert.match(broken.message, /HTTP 500: boom/);
});

test('an unreachable engine says what to check: nothing listening, an unknown name, no answer', async () => {
  const refused = await conn.testConnection({ address: '100.84.99.15', token: 't', fetch: failing('ECONNREFUSED') });
  assert.equal(refused.reason, 'unreachable');
  assert.match(refused.message, /refused the connection: nothing listens on port 7300/);
  assert.match(refused.message, /--host/);
  const unknown = await conn.testConnection({ address: 'no-such-pc', token: 't', fetch: failing('ENOTFOUND') });
  assert.match(unknown.message, /no-such-pc was not found/);
  assert.match(unknown.message, /MagicDNS/);
  const slow = await conn.testConnection({
    address: 'my-pc', token: 't', timeoutMs: 2000,
    fetch: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); },
  });
  assert.match(slow.message, /No answer from my-pc:7300 in 2 s/);
  const odd = await conn.testConnection({ address: 'my-pc', token: 't', fetch: failing('EHOSTUNREACH', 'host unreachable') });
  assert.match(odd.message, /Could not reach my-pc:7300: host unreachable/);
});

test('a real timeout aborts the request', async () => {
  const fetch = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  const r = await conn.testConnection({ address: 'my-pc', token: 't', fetch, timeoutMs: 50 });
  assert.equal(r.reason, 'unreachable');
  assert.match(r.message, /No answer from my-pc:7300/);
});

// ---- the remote window's rules ---------------------------------------------------------------

test('the first address carries the token once, encoded', () => {
  assert.equal(conn.startUrl('http://my-pc:7300', 'a b/c+d'), 'http://my-pc:7300/?token=a%20b%2Fc%2Bd');
});

test('the remote window loads only the engine\'s origin; its connection path, other sites and other schemes are routed', () => {
  const origin = 'http://my-pc:7300';
  assert.equal(conn.routeUrl('http://my-pc:7300/src/renderer/index.html', origin), 'stay');
  assert.equal(conn.routeUrl('http://my-pc:7300/?token=x', origin), 'stay');
  assert.equal(conn.routeUrl(`http://my-pc:7300${conn.CONNECTION_PATH}`, origin), 'connection');
  assert.equal(conn.routeUrl(`http://my-pc:7300${conn.CONNECTION_PATH}?lang=pt-BR`, origin), 'connection');
  assert.equal(conn.routeUrl(`http://my-pc:7301${conn.CONNECTION_PATH}`, origin), 'external');
  assert.equal(conn.routeUrl('https://github.com/eduardogalbiati/multiagent-orchestrator/pull/1', origin), 'external');
  assert.equal(conn.routeUrl('http://evil.example:7300/', origin), 'external');
  assert.equal(conn.routeUrl('file:///C:/Windows/system32/calc.exe', origin), 'deny');
  assert.equal(conn.routeUrl('javascript:alert(1)', origin), 'deny');
  assert.equal(conn.routeUrl('not a url', origin), 'deny');
});

// #480 (SEC-15): reading the clipboard only for an https engine; writing it on http too
test('the remote window gets the clipboard for the engine\'s origin only, and nothing else', () => {
  const origin = 'http://my-pc:7300';
  assert.equal(conn.allowRemotePermission('clipboard-sanitized-write', 'http://my-pc:7300/src/renderer/index.html', origin), true);
  assert.equal(conn.allowRemotePermission('clipboard-read', 'http://my-pc:7300', origin), false, '#480: no clipboard-read over plain http');
  assert.equal(conn.allowRemotePermission('clipboard-read', 'https://my-pc.tail1234.ts.net/src/renderer/index.html', 'https://my-pc.tail1234.ts.net'), true);
  assert.equal(conn.allowRemotePermission('clipboard-sanitized-write', 'http://other:7300/', origin), false);
  assert.equal(conn.allowRemotePermission('media', 'http://my-pc:7300/', origin), false);
  assert.equal(conn.allowRemotePermission('notifications', 'http://my-pc:7300/', origin), false);
  assert.equal(conn.allowRemotePermission('clipboard-read', undefined, origin), false);
});

// ---- the server's side ------------------------------------------------------------------------

const INTERFACES = {
  Ethernet: [{ family: 'IPv4', address: '192.168.3.4', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
  Tailscale: [{ family: 'IPv4', address: '100.84.99.15', internal: false }],
  'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
};

test('Tailscale\'s addresses are 100.64.0.0/10', () => {
  assert.equal(conn.isTailscaleIp('100.84.99.15'), true);
  assert.equal(conn.isTailscaleIp('100.64.0.1'), true);
  assert.equal(conn.isTailscaleIp('100.127.255.254'), true);
  assert.equal(conn.isTailscaleIp('100.63.0.1'), false);
  assert.equal(conn.isTailscaleIp('100.128.0.1'), false);
  assert.equal(conn.isTailscaleIp('192.168.3.4'), false);
  assert.equal(conn.isTailscaleIp(undefined), false);
});

test('the addresses another computer can type: IPv4 beyond loopback, Tailscale\'s first', () => {
  assert.deepEqual(conn.lanAddresses(INTERFACES), [
    { address: '100.84.99.15', name: 'Tailscale', tailscale: true },
    { address: '192.168.3.4', name: 'Ethernet', tailscale: false },
  ]);
  assert.deepEqual(conn.lanAddresses(undefined), []);
});

test('--host tailscale listens on the Tailscale address only; other hosts are kept as typed (beyond loopback with --insecure-http, #479)', () => {
  assert.deepEqual(conn.resolveListenHost('tailscale', INTERFACES), { host: '100.84.99.15' });
  assert.deepEqual(conn.resolveListenHost('0.0.0.0', INTERFACES, { insecureHttp: true }), { host: '0.0.0.0' });
  assert.deepEqual(conn.resolveListenHost('127.0.0.1', {}), { host: '127.0.0.1' });
  assert.match(conn.resolveListenHost('tailscale', { Ethernet: INTERFACES.Ethernet }).error, /no Tailscale address/);
});

// ---- the browser client: src/renderer/api-http.js ----------------------------------------------

// api-http.js in a vm sandbox with the given user agent and manifest; window.open is recorded
function loadApiHttp({ userAgent = '', manifest = [], language = null } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'api-http.js'), 'utf8');
  function FakeXHR() {}
  FakeXHR.prototype.open = function open() {};
  FakeXHR.prototype.send = function send() { this.status = 200; this.responseText = JSON.stringify({ result: manifest }); };
  function FakeWebSocket() { this.readyState = 0; }
  FakeWebSocket.OPEN = 1;
  const opened = [];
  const sandbox = {
    window: { open: (url) => { opened.push(url); return null; }, ...(language && { I18n: { getLanguage: () => language } }) },
    navigator: { clipboard: {}, userAgent },
    location: { protocol: 'http:', host: 'my-pc:7300' },
    XMLHttpRequest: FakeXHR, WebSocket: FakeWebSocket, fetch: async () => ({ ok: false }),
    setTimeout: () => 0, clearTimeout, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { api: sandbox.window.api, opened };
}

const DESKTOP_MANIFEST = () => {
  const { DESKTOP, declarations } = require('@multiagent/engine/service/manifest');
  return declarations(DESKTOP);
};

test('engine:openConnection is a desktop channel the preload exposes as openEngineConnection', () => {
  const entry = require('@multiagent/engine/service/manifest').DESKTOP.find((e) => e.channel === 'engine:openConnection');
  assert.equal(entry.method, 'openEngineConnection');
  assert.ok(entry.desktop);
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'host', 'main.js'), 'utf8');
  // through the sender guard (#467: ipc = guardIpc(ipcMain, ...)) or directly
  assert.match(main, /\b(?:ipc|ipcMain)\.handle\('engine:openConnection'/, 'src/host/main.js answers it');
});

test('in the desktop app showing a remote engine, the page knows it and opens the connection page through its path', async () => {
  const { api, opened } = loadApiHttp({ userAgent: `Mozilla/5.0 Chrome/140 Electron/44.0.0 ${conn.CLIENT_MARK}`, manifest: DESKTOP_MANIFEST() });
  assert.equal(api.engineConnection.mode, 'remote');
  assert.equal(api.engineConnection.host, 'my-pc:7300');
  assert.equal(await api.openEngineConnection(), true);
  assert.deepEqual(opened, [conn.CONNECTION_PATH]);
  // the other desktop methods still say they are the desktop app's
  await assert.rejects(api.keepAwakeState(), /only available in the desktop app/);
});

test('in a plain browser the page says so, and cannot open the desktop app\'s connection page', async () => {
  const { api, opened } = loadApiHttp({ userAgent: 'Mozilla/5.0 Chrome/140', manifest: DESKTOP_MANIFEST() });
  assert.equal(api.engineConnection.mode, 'browser');
  await assert.rejects(api.openEngineConnection(), /Choosing where the engine runs is only available in the desktop app/);
  assert.deepEqual(opened, []);
});

test('#329 the engine\'s page sends its interface language along to the connection page', async () => {
  const { api, opened } = loadApiHttp({ userAgent: `Mozilla/5.0 ${conn.CLIENT_MARK}`, manifest: DESKTOP_MANIFEST(), language: 'pt-BR' });
  await api.openEngineConnection();
  assert.deepEqual(opened, [`${conn.CONNECTION_PATH}?lang=pt-BR`]);
});

// ---- the interface language (#329): Settings › Execution › Engine and the connection page ----------

const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));

// settings-engine.js in a vm sandbox, its t the catalog's in `lang`
function engineSettingsMarkup(lang, engineConnection, canChange = true) {
  const I18n = require('@multiagent/shared/i18n');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'views', 'settings', 'settings-engine.js'), 'utf8');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const api = { platform: engineConnection.mode === 'local' ? 'win32' : 'browser', engineConnection, ...(canChange && { openEngineConnection: async () => true }) };
  const sandbox = { window: {}, api, esc, errMsg: (e) => e.message, t: (key, params) => I18n.t(key, params, lang) };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const w = sandbox.window.EngineSettings;
  return w.markup(w.where());
}

test('#329 Settings › Execution › Engine speaks the interface language', () => {
  const en = engineSettingsMarkup('en', { mode: 'local' });
  assert.match(en, /This computer runs the engine/);
  assert.match(en, />Change…</);
  const pt = engineSettingsMarkup('pt-BR', { mode: 'local' });
  assert.match(pt, /Este computador roda o engine/);
  assert.match(pt, />Alterar…</);
  assert.match(pt, />Este computador</);
  const remote = engineSettingsMarkup('pt-BR', { mode: 'remote', host: 'my-pc:7300' });
  assert.match(remote, /Esta janela mostra o engine em my-pc:7300/);
  assert.match(remote, /Engine remoto · my-pc:7300/);
  assert.match(remote, /data-engine-mode="remote"/);
  const browser = engineSettingsMarkup('pt-BR', { mode: 'browser', host: 'my-pc:7300' }, false);
  assert.match(browser, /Esta página é servida pelo engine em my-pc:7300/);
  assert.doesNotMatch(browser, /settings-engine-change/, 'a plain browser has no Change…');
});

test('#329 every text key of the connection page is in both catalogs', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'connection');
  const html = fs.readFileSync(path.join(dir, 'connection.html'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'connection.js'), 'utf8');
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-placeholder)?="([\w.]+)"/g)].map((m) => m[1]),
    ...[...js.matchAll(/'((?:connection|common)\.[\w.]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(keys.size > 30, `${keys.size} keys`);
  for (const lang of ['en', 'pt-BR']) {
    const c = catalog(lang);
    const missing = [...keys].filter((k) => !(k in c));
    assert.deepEqual(missing, [], `missing from ${lang}.json`);
  }
  assert.match(html, /<script src="\.\.\/\.\.\/\.\.\/packages\/shared\/i18n\.js"><\/script>\s*<script src="connection\.js">/, 'the catalog loads before the page\'s script');
});
