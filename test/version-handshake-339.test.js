// #339 acceptance: the version handshake between the engine and its clients.
//
// The interfaces these tests expect (the developer implements them; this file is not edited):
//
// 1. `contractHash(manifest)` exported by src/service/contract.js: a pure function of an array of
//    manifest entries (as src/service/manifest.js declares them, with or without their `fn`) to a
//    short lowercase hex string (/^[0-9a-f]{6,16}$/). It hashes the contract only: the channel names
//    (channel / send / event), their params and their schema. The same content gives the same hash
//    (a JSON copy of the manifest too); an entry's `fn` never changes it; a change to a channel's
//    schema.params or schema.result, or a channel added or removed, changes it.
//
// 2. `GET /api/version` on the engine server (src/server/index.js) answers 200 with the JSON body
//    `{ app, contract }` (top level, not wrapped in `result`): `app` is package.json's version and
//    `contract` is contractHash(service.manifest). Like every other request it needs the server
//    token (Bearer header or the cookie): without it, 401.
//
// 3. `GET /api/manifest` also answers the contract of the manifest it serves:
//    `{ result: [...entries], contract }`. This is how the browser UI learns "the contract it was
//    built for": src/renderer/api-http.js builds window.api from that manifest at load and keeps its
//    `contract`.
//
// 4. A service channel `app:version` (method `appVersion`, no argument) whose schema.result is an
//    object requiring `app` and `contract` (strings). It answers exactly what GET /api/version
//    answers, so the desktop app gets the same over IPC (src/main.js serves every service channel).
//
// 5. src/renderer/api-http.js, on every WebSocket open (the first connection and each
//    reconnection), reads `GET /api/version` (fetch or XMLHttpRequest) and compares its `contract`
//    with the one /api/manifest gave at load. Different: it shows a banner, an element built with
//    document.createElement carrying `data-testid="version-skew-banner"` (setAttribute or
//    dataset.testid), appended under document.body, whose text says
//    "This engine runs another version (engine <app>, interface <contract>): reload to get its interface"
//    and which holds a Reload button: a `button` element with `data-testid="version-skew-reload"`
//    whose click calls location.reload(). Only one banner at a time (a second reconnection to the
//    other engine does not add another). Same contract: no banner is shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');
const { createServer } = require('../src/server');

const PKG = require('../package.json');
const TOKEN = 'test-token-339-0123456789abcdef';
const HEX = /^[0-9a-f]{6,16}$/;
const API_HTTP = path.join(__dirname, '..', 'src', 'renderer', 'api-http.js');

// the module the change adds to: required inside each test (the export does not exist yet)
const contractHash = () => {
  const { contractHash: fn } = require('../src/service/contract');
  assert.equal(typeof fn, 'function', 'src/service/contract.js exports contractHash(manifest)');
  return fn;
};

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-339-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: PKG.version, isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  t.after(() => {
    service.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return service;
}

async function start(t) {
  const service = makeService(t);
  const server = createServer({ service, token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { service, base: `http://127.0.0.1:${server.address().port}` };
}

function request(base, { method = 'GET', path: p, headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const bearer = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- the HTTP route and the IPC channel -------------------------------------------------------

test('#339 GET /api/version needs the token and answers { app, contract }: package.json\'s version and the manifest\'s hash', async (t) => {
  const { base, service } = await start(t);
  assert.equal((await request(base, { path: '/api/version' })).status, 401, 'without the token');
  const res = await request(base, { path: '/api/version', headers: bearer });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json?.app, PKG.version);
  assert.equal(typeof res.json?.contract, 'string');
  assert.match(res.json.contract, HEX);
  assert.equal(res.json.contract, contractHash()(service.manifest), 'the contract is contractHash(service.manifest)');

  const manifest = await request(base, { path: '/api/manifest', headers: bearer });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json?.contract, res.json.contract, 'GET /api/manifest answers { result, contract } with the same contract');
  assert.ok(Array.isArray(manifest.json.result));
});

test('#339 the app:version channel declares { app, contract } and answers what GET /api/version answers', async (t) => {
  const { base, service } = await start(t);
  const entry = service.manifest.find((e) => e.channel === 'app:version');
  assert.ok(entry, 'app:version is a channel of the manifest');
  assert.equal(entry.method, 'appVersion');
  assert.equal(entry.desktop, undefined, 'a service channel (IPC and HTTP), not desktop-only');
  const result = entry.schema?.result;
  assert.equal(result?.type, 'object', 'schema.result is an object');
  assert.deepEqual([...(result.required || [])].sort(), ['app', 'contract']);
  assert.equal(result.properties?.app?.type, 'string');
  assert.equal(result.properties?.contract?.type, 'string');

  const viaService = await service.api['app:version']();
  const viaRoute = (await request(base, { path: '/api/version', headers: bearer })).json;
  const viaPost = (await request(base, { method: 'POST', path: '/api/app:version', headers: bearer, body: { arg: null } })).json?.result;
  assert.deepEqual([viaService?.app, viaService?.contract], [viaRoute?.app, viaRoute?.contract], 'IPC (the service) and GET /api/version');
  assert.deepEqual([viaPost?.app, viaPost?.contract], [viaRoute?.app, viaRoute?.contract], 'POST /api/app:version and GET /api/version');
});

// ---- the hash -----------------------------------------------------------------------------------

const SYNTHETIC = (fn) => [
  { channel: 'demo:get', method: 'demoGet', params: ['id'], schema: { params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, result: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }, ...(fn ? { fn } : {}) },
  { channel: 'demo:list', method: 'demoList', schema: { result: { type: 'array', items: { type: 'string' } } }, ...(fn ? { fn } : {}) },
  { event: 'demo:changed', method: 'onDemoChange' },
];

test('#339 contractHash is a short hex string, the same for the same content, whatever the channels\' functions', (t) => {
  const hash = contractHash();
  const service = makeService(t);
  const h = hash(service.manifest);
  assert.match(h, HEX);
  assert.equal(hash(service.manifest), h, 'deterministic');
  assert.equal(hash(clone(service.manifest)), h, 'a JSON copy of the manifest has the same contract');
  const a = hash(SYNTHETIC(() => 1));
  assert.match(a, HEX);
  assert.equal(hash(SYNTHETIC(() => 2)), a, 'another fn: same contract');
  assert.equal(hash(SYNTHETIC(null)), a, 'no fn (the declarations the clients get): same contract');
  assert.notEqual(a, h);
});

test('#339 contractHash changes when a channel\'s argument schema or result schema changes', (t) => {
  const hash = contractHash();
  const service = makeService(t);
  const before = hash(service.manifest);

  const params = clone(service.manifest);
  const setTitle = params.find((e) => e.channel === 'runs:setTitle');
  assert.ok(setTitle?.schema?.params?.properties?.title, 'runs:setTitle has a title param schema');
  setTitle.schema.params.properties.title.maxLength = 201;
  assert.notEqual(hash(params), before, 'runs:setTitle\'s title maxLength 200 -> 201');

  const result = clone(service.manifest);
  const info = result.find((e) => e.channel === 'app:info');
  assert.ok(info?.schema?.result?.properties?.version, 'app:info has a result schema');
  info.schema.result.properties.version = { type: 'number' };
  assert.notEqual(hash(result), before, 'app:info\'s result.version string -> number');

  const synthetic = SYNTHETIC(null);
  synthetic[0].schema.result.required = [];
  assert.notEqual(hash(synthetic), hash(SYNTHETIC(null)), 'a result field no longer required');
});

test('#339 contractHash changes when a channel is added or removed', (t) => {
  const hash = contractHash();
  const service = makeService(t);
  const before = hash(service.manifest);
  const added = [...clone(service.manifest), { channel: 'test339:new', method: 'test339New', schema: { result: { type: 'null' } } }];
  assert.notEqual(hash(added), before, 'a channel added');
  const removed = clone(service.manifest).filter((e) => e.channel !== 'projects:list');
  assert.equal(removed.length, service.manifest.length - 1);
  assert.notEqual(hash(removed), before, 'a channel removed');
});

// ---- the browser UI's handshake (src/renderer/api-http.js) -------------------------------------

// A minimal DOM: enough for createElement / append / setAttribute / dataset / textContent /
// innerHTML (text only) / classList / addEventListener / click / querySelector by simple selectors.
const camel = (s) => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
const stripTags = (html) => String(html).replace(/<[^>]*>/g, ' ');
class FakeNode {
  constructor(tag, document) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = document;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.hidden = false;
    this._text = '';
    this._html = '';
    this._cls = new Set();
  }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get classList() {
    const s = this._cls;
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); return on; },
      contains: (c) => s.has(c),
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set id(v) { this.attrs.id = String(v); }
  get id() { return this.attrs.id || ''; }
  setAttribute(k, v) {
    k = String(k).toLowerCase();
    if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v);
    else if (k === 'class') this.className = v;
    else if (k === 'hidden') this.hidden = true;
    else this.attrs[k] = String(v);
  }
  getAttribute(k) {
    k = String(k).toLowerCase();
    if (k.startsWith('data-')) { const d = this.dataset[camel(k.slice(5))]; return d === undefined ? null : String(d); }
    if (k === 'class') return this.className || null;
    if (k === 'hidden') return this.hidden ? '' : null;
    return k in this.attrs ? this.attrs[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) {
    k = String(k).toLowerCase();
    if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))];
    else if (k === 'hidden') this.hidden = false;
    else if (k === 'class') this._cls = new Set();
    else delete this.attrs[k];
  }
  set textContent(v) { this.children.length = 0; this._html = ''; this._text = v == null ? '' : String(v); }
  get textContent() { return this._text + stripTags(this._html) + this.children.map((c) => c.textContent).join(''); }
  set innerText(v) { this.textContent = v; }
  get innerText() { return this.textContent; }
  set innerHTML(v) { this.children.length = 0; this._text = ''; this._html = String(v); }
  get innerHTML() { return this._html; }
  _adopt(n) {
    if (typeof n === 'string') { const t = new FakeNode('#text', this.ownerDocument); t._text = n; return t; }
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    return n;
  }
  appendChild(n) { const c = this._adopt(n); this.children.push(c); return c; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
  prepend(...nodes) { this.children.unshift(...nodes.map((n) => this._adopt(n))); }
  insertBefore(n, ref) {
    const c = this._adopt(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  insertAdjacentElement(where, n) {
    if (where === 'afterbegin') this.prepend(n);
    else if (where === 'beforeend') this.appendChild(n);
    else if (this.parentNode) this.parentNode.insertBefore(n, where === 'beforebegin' ? this : this.parentNode.children[this.parentNode.children.indexOf(this) + 1]);
    return n;
  }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p.removeChild(this); }
  contains(n) { for (let c = n; c; c = c.parentNode) if (c === this) return true; return false; }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  click() {
    const ev = { type: 'click', target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    if (typeof this.onclick === 'function') this.onclick(ev);
    for (const fn of this.listeners.click || []) fn(ev);
  }
  _descendants() { return this.children.flatMap((c) => [c, ...c._descendants()]); }
  _matches(sel) {
    const m = /^([a-z][a-z0-9-]*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
      if (part[0] === '#' && this.id !== part.slice(1)) return false;
      if (part[0] === '.' && !this._cls.has(part.slice(1))) return false;
      if (part[0] === '[') {
        const [, name, value] = /^\[\s*([\w-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(part) || [];
        if (!name) return false;
        const actual = this.getAttribute(name);
        if (actual === null || (value !== undefined && actual !== value)) return false;
      }
    }
    return true;
  }
  querySelectorAll(sel) { return this._descendants().filter((n) => String(sel).split(',').some((s) => n._matches(s))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let c = this; c; c = c.parentNode) if (c._matches(sel)) return c; return null; }
}

function makeDocument() {
  const document = { readyState: 'complete', listeners: {} };
  document.documentElement = new FakeNode('html', document);
  document.head = new FakeNode('head', document);
  document.body = new FakeNode('body', document);
  document.documentElement.append(document.head, document.body);
  document.createElement = (tag) => new FakeNode(tag, document);
  document.createTextNode = (text) => { const n = new FakeNode('#text', document); n._text = String(text); return n; };
  document.querySelector = (sel) => document.documentElement.querySelector(sel);
  document.querySelectorAll = (sel) => document.documentElement.querySelectorAll(sel);
  document.getElementById = (id) => document.documentElement.querySelector(`#${id}`);
  document.addEventListener = (type, fn) => {
    if (type === 'DOMContentLoaded') setImmediate(() => fn({ type }));
    else (document.listeners[type] ||= []).push(fn);
  };
  document.removeEventListener = () => {};
  return document;
}

// api-http.js in a vm sandbox, against a fake engine: GET /api/manifest gives `builtFor` (the
// contract the page loads with), GET /api/version gives the engine's current { app, contract }.
function loadBrowser({ builtFor, engine }) {
  const src = fs.readFileSync(API_HTTP, 'utf8');
  const state = { engine: { ...engine }, reloads: 0, sockets: [], timers: [] };
  const document = makeDocument();
  const answer = (url) => {
    const u = String(url);
    if (/\/api\/version(?:[?#]|$)/.test(u)) return { app: state.engine.app, contract: state.engine.contract };
    if (/\/api\/manifest(?:[?#]|$)/.test(u)) return { result: [], contract: builtFor };
    return { result: null };
  };
  const response = (body) => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    json: async () => JSON.parse(JSON.stringify(body)),
    text: async () => JSON.stringify(body),
  });
  function FakeXHR() { this.readyState = 0; }
  FakeXHR.prototype.open = function open(_method, url) { this.url = url; };
  FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
  FakeXHR.prototype.send = function send() {
    this.status = 200;
    this.readyState = 4;
    this.responseText = JSON.stringify(answer(this.url));
    if (typeof this.onload === 'function') this.onload();
  };
  function FakeWebSocket(url) { this.url = url; this.readyState = 0; this.handlers = {}; state.sockets.push(this); }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  FakeWebSocket.prototype.addEventListener = function on(type, fn) { (this.handlers[type] ||= []).push(fn); };
  FakeWebSocket.prototype.removeEventListener = function off() {};
  FakeWebSocket.prototype.send = function send() {};
  FakeWebSocket.prototype.close = function close() {};
  const location = { protocol: 'http:', host: 'sandbox.invalid', href: 'http://sandbox.invalid/src/renderer/index.html', reload: () => { state.reloads++; } };
  const window = { location, document, addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    window, document, location,
    navigator: { clipboard: {} },
    XMLHttpRequest: FakeXHR, WebSocket: FakeWebSocket,
    // an engine set to { raw: { status, text } } answers GET /api/version with that (an older engine)
    fetch: async (url) => {
      const raw = state.engine.raw;
      if (raw && /\/api\/version(?:[?#]|$)/.test(String(url))) {
        return {
          ok: raw.status < 400, status: raw.status,
          headers: { get: () => 'text/html' },
          json: async () => JSON.parse(raw.text),
          text: async () => raw.text,
        };
      }
      return response(answer(url));
    },
    setTimeout: (fn) => { state.timers.push(fn); return state.timers.length; },
    clearTimeout: (id) => { if (id) state.timers[id - 1] = null; },
    setInterval: () => 0, clearInterval: () => {},
    console, URL,
  };
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const fire = (ws, type) => {
    const ev = { type, target: ws };
    if (typeof ws[`on${type}`] === 'function') ws[`on${type}`](ev);
    for (const fn of ws.handlers[type] || []) fn(ev);
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const isShown = (n) => {
    for (let c = n; c; c = c.parentNode) {
      if (c.hidden || c.style.display === 'none' || c._cls.has('hidden')) return false;
    }
    return n.isConnected;
  };
  return {
    state,
    // the latest socket opens (first connection or reconnection)
    async open() {
      const ws = state.sockets.at(-1);
      assert.ok(ws, 'api-http.js opened a WebSocket');
      ws.readyState = 1;
      fire(ws, 'open');
      await settle();
    },
    // the connection drops, the engine is now `next`, and the client reconnects
    async reconnect(next) {
      const ws = state.sockets.at(-1);
      state.engine = { ...next };
      ws.readyState = 3;
      fire(ws, 'close');
      const pending = state.timers.splice(0);
      for (const fn of pending) if (fn) fn();
      assert.ok(state.sockets.at(-1) !== ws, 'api-http.js reconnects after the socket closes');
      await this.open();
    },
    // primitives only: the visible banners' count and text, and its Reload button
    banner() {
      const shown = document.documentElement._descendants().filter((n) => n.getAttribute('data-testid') === 'version-skew-banner' && isShown(n));
      const first = shown[0];
      const reload = first ? first._descendants().find((n) => n.getAttribute('data-testid') === 'version-skew-reload') : null;
      return {
        count: shown.length,
        text: first ? first.textContent.replace(/\s+/g, ' ').trim() : '',
        reloadTag: reload ? reload.tagName : null,
        clickReload: () => { if (reload) reload.click(); return state.reloads; },
      };
    },
  };
}

const ENGINE_A = { app: '1.1.0', contract: 'aaaa1111' };
const ENGINE_B = { app: '9.9.9', contract: 'bbbb2222' };

test('#339 browser: connected to the engine it was built for, no banner is shown', async () => {
  const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: ENGINE_A });
  await page.open();
  assert.equal(page.banner().count, 0);
});

test('#339 browser: an engine with another contract shows the banner with its versions and a Reload button', async () => {
  const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: ENGINE_B });
  await page.open();
  const b = page.banner();
  assert.equal(b.count, 1, 'one visible [data-testid="version-skew-banner"]');
  assert.match(b.text, /This engine runs another version/);
  assert.ok(b.text.includes('9.9.9'), `the engine's app version in "${b.text}"`);
  assert.ok(b.text.includes('bbbb2222'), `the engine's contract in "${b.text}"`);
  assert.match(b.text, /reload to get its interface/i);
  assert.equal(b.reloadTag, 'BUTTON', 'a button [data-testid="version-skew-reload"] inside the banner');
  assert.equal(b.clickReload(), 1, 'its click reloads the page');
});

test('#339 browser: reconnecting to an engine with the same contract shows nothing', async () => {
  const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: ENGINE_A });
  await page.open();
  await page.reconnect({ ...ENGINE_A });
  assert.equal(page.banner().count, 0, 'same contract after the reconnection');
  await page.reconnect({ app: '1.1.1', contract: ENGINE_A.contract });
  assert.equal(page.banner().count, 0, 'another app version but the same contract: same interface');
});

test('#339 browser: reconnecting to an engine whose contract changed shows the banner, once', async () => {
  const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: ENGINE_A });
  await page.open();
  assert.equal(page.banner().count, 0);
  await page.reconnect(ENGINE_B);
  const b = page.banner();
  assert.equal(b.count, 1, 'the banner after the reconnection');
  assert.ok(b.text.includes('9.9.9') && b.text.includes('bbbb2222'), b.text);
  await page.reconnect(ENGINE_B);
  assert.equal(page.banner().count, 1, 'a second reconnection to that engine adds no second banner');
});

test('#339 browser: back on an engine with the page\'s contract, the banner goes away', async () => {
  const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: ENGINE_B });
  await page.open();
  assert.equal(page.banner().count, 1);
  await page.reconnect(ENGINE_A);
  assert.equal(page.banner().count, 0, 'the engine speaks this page\'s contract again');
});

test('#339 browser: an older engine without GET /api/version (404 or not JSON) shows no banner', async () => {
  for (const raw of [{ status: 404, text: '{"error":"Unknown channel: version"}' }, { status: 200, text: '<!doctype html><title>old</title>' }]) {
    const page = loadBrowser({ builtFor: ENGINE_A.contract, engine: { raw } });
    await page.open();
    assert.equal(page.banner().count, 0, `GET /api/version answered ${raw.status} ${raw.text}`);
  }
});

test('#339 browser: a page whose manifest names no contract (an older engine served it) shows no banner', async () => {
  const page = loadBrowser({ builtFor: null, engine: ENGINE_B });
  await page.open();
  assert.equal(page.banner().count, 0);
});

// ---- the route's fallback when the service gives no version ------------------------------------

async function startOver(t, api) {
  const manifest = [{ channel: 'test339:ping', method: 'test339Ping', schema: { result: { type: 'null' } } }];
  const service = { api: { 'test339:ping': () => null, ...api }, notifications: {}, events: { on() {}, off() {} }, manifest };
  const server = createServer({ service, token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { base: `http://127.0.0.1:${server.address().port}`, manifest };
}

test('#339 GET /api/version without an app:version channel answers the package version and the manifest\'s hash', async (t) => {
  const { base, manifest } = await startOver(t, {});
  const res = await request(base, { path: '/api/version', headers: bearer });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.deepEqual({ app: res.json?.app, contract: res.json?.contract }, { app: PKG.version, contract: contractHash()(manifest) });
});

test('#339 GET /api/version still answers when the app:version channel throws', async (t) => {
  const { base, manifest } = await startOver(t, { 'app:version': () => { throw new Error('boom'); } });
  const res = await request(base, { path: '/api/version', headers: bearer });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.deepEqual({ app: res.json?.app, contract: res.json?.contract }, { app: PKG.version, contract: contractHash()(manifest) });
});
