// #751 acceptance (tests first): the Findings overlay (packages/ui-kit/findings.js) when the app runs
// against a remote engine (the desktop app's remote window) or in a browser tab.
//
// The interface these tests expect (the developer implements it; this file is not edited):
// - A capture that really fails (captureWindow rejects, or gives nothing) shows a message in the
//   interface language, from the i18n catalog (packages/shared/i18n/*.json; pt-BR e.g. "Não foi
//   possível capturar a tela; as marcas vão numa imagem em branco"), never the English text
//   hard-coded today; the finding is still saved, with the note and the context (screen, size).
// - The tool labels (Pin, Circle, Box, Arrow, Freehand), "Undo mark" and the empty marks list
//   ("No marks yet.") come from the catalog: in pt-BR none of them is the English word.
// - In the remote window, window.api is apps/web/renderer/api-http.js and the remote window's
//   preload exposes the native capture as `window.desktopCapture.capturePage()` → a PNG data URL
//   (the contract shared with apps/desktop/test/host/engine-connection-window-751.test.js and
//   apps/web/test/api-http-capture-751.test.js). The overlay opened there shows that capture, and
//   Save and File as issue send it (findings:save's `image`, POSTed to the engine) with the marks.
// The overlay runs in a mini DOM (./mini-dom.js) with a fake 2D context and Image at the canvas
// boundary; the engine is faked at fetch (the HTTP boundary) and the api at its methods.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');

const ROOT = path.join(__dirname, '..', '..', '..');
const RENDERER = path.join(__dirname, '..');
const API_HTTP = path.join(ROOT, 'apps', 'web', 'renderer', 'api-http.js');
const CATALOG = {
  en: JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'en.json'), 'utf8')),
  'pt-BR': JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'pt-BR.json'), 'utf8')),
};
const SHOT = 'data:image/png;base64,UkVNT1RFLVNIT1Q=';
const MARKED = 'data:image/png;base64,TUFSS0VE';
const TOOLS = { pin: 'Pin', circle: 'Circle', box: 'Box', arrow: 'Arrow', freehand: 'Freehand' };

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the catalog keys whose value (its {params} standing for anything) reads exactly `shown`; a value
// that is only placeholders ("{e}") reads anything and does not count
const letters = (s) => s.replace(/\{\w+\}/g, '').replace(/[^\p{L}]/gu, '').length;
function keysReading(shown, lang) {
  const cat = CATALOG[lang];
  return Object.keys(cat).filter((k) => typeof cat[k] === 'string' && letters(cat[k]) >= Math.min(3, letters(shown))
    && new RegExp(`^${cat[k].trim().split(/\{\w+\}/).map(escapeRe).join('[\\s\\S]*')}$`).test(shown));
}

test.afterEach(() => I18n.setLanguage('en'));

// The overlay of a 1000×500 window on the run view. `api`: a fake api object (its methods are the
// boundary), or 'http' for the page's api-http.js over a fake engine (fetch) with `bridge` as the
// remote window preload's window.desktopCapture.
function loadOverlay({ lang = 'en', api = null, bridge = null } = {}) {
  I18n.setLanguage(lang);
  const posts = [];
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, queueMicrotask,
    innerWidth: 1000,
    innerHeight: 500,
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', getPropertyValue: () => '' }),
    state: { view: 'run', tab: 'steps' },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    CurrentProject: { get: () => 'p1' },
  };
  const dom = createDom({ window: sandbox });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = dom.document;
  Object.assign(sandbox, dom.classes);
  const { Element } = dom.classes;
  // the canvas boundary: a 2D context that draws nothing, a PNG out of every canvas
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  Element.prototype.getContext = function getContext(kind) { return this.localName === 'canvas' && kind === '2d' ? ctx : null; };
  Element.prototype.toDataURL = () => MARKED;
  sandbox.Image = class {
    constructor() { this.naturalWidth = 1000; this.naturalHeight = 500; }
    set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  };
  if (api === 'http') {
    // the engine at the HTTP boundary: the channels the overlay uses, findings:save / findings:file recorded
    const manifest = [
      { channel: 'app:info', method: 'appInfo' },
      { channel: 'settings:get', method: 'getSettings' },
      { channel: 'projects:list', method: 'listProjects' },
      { channel: 'findings:save', method: 'saveFinding', params: 'finding' },
      { channel: 'findings:file', method: 'fileFinding', params: ['id', 'projectId', 'mock'] },
      { channel: 'window:capture', method: 'captureWindow', desktop: 'Capturing the window' },
    ];
    function FakeXHR() { this.readyState = 0; }
    FakeXHR.prototype.open = function open(_m, url) { this.url = url; };
    FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
    FakeXHR.prototype.send = function send() { this.status = 200; this.readyState = 4; this.responseText = JSON.stringify({ result: manifest, contract: null }); };
    class FakeWebSocket { constructor(url) { this.url = String(url); this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
    Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const answers = {
      'app:info': { isPackaged: false },
      'settings:get': {},
      'projects:list': [{ id: 'p1' }],
      'findings:save': { id: 'f-751', dir: '/ws/findings/f-751' },
      'findings:file': { ok: true, status: 'filed', issueUrl: 'https://github.com/o/r/issues/9' },
    };
    sandbox.location = { protocol: 'http:', host: 'engine.invalid:7300', href: 'http://engine.invalid:7300/apps/web/renderer/index.html', reload() {} };
    sandbox.navigator = { userAgent: 'Mozilla/5.0 Chrome/140 Electron/44.0.0 MultiagentRemoteClient', clipboard: {}, onLine: true };
    sandbox.XMLHttpRequest = FakeXHR;
    sandbox.WebSocket = FakeWebSocket;
    sandbox.fetch = async (url, opts = {}) => {
      const channel = String(url).replace(/^\/api\//, '');
      const arg = opts.body ? JSON.parse(opts.body).arg : null;
      posts.push({ channel, arg });
      const known = Object.prototype.hasOwnProperty.call(answers, channel);
      return { ok: known, status: known ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (known ? { result: answers[channel] } : { error: `no ${channel}` }), text: async () => '{}' };
    };
    if (bridge) sandbox.desktopCapture = bridge;
  } else {
    sandbox.api = {
      appInfo: async () => ({ isPackaged: false }),
      getSettings: async () => ({ findingsButton: false }),
      listProjects: async () => [{ id: 'p1' }],
      saveFinding: async (finding) => { posts.push({ channel: 'findings:save', arg: JSON.parse(JSON.stringify(finding)) }); return { id: 'f-751', dir: '/ws/findings/f-751' }; },
      fileFinding: async (id, projectId) => { posts.push({ channel: 'findings:file', arg: { id, projectId } }); return { ok: true, status: 'filed', issueUrl: 'https://github.com/o/r/issues/9' }; },
      ...(api || {}),
    };
  }
  withI18n(sandbox);
  vm.createContext(sandbox);
  const files = api === 'http' ? [API_HTTP, path.join(RENDERER, '..', 'shared', 'findings-model.js'), path.join(RENDERER, 'findings.js')] : [path.join(RENDERER, '..', 'shared', 'findings-model.js'), path.join(RENDERER, 'findings.js')];
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  const q = (id) => dom.document.querySelector(`[data-testid="${id}"]`);
  return { sandbox, dom, document: dom.document, posts, q, status: () => text(dom.document.querySelector('[data-testid="findings-status"] .fd-status-text')) };
}

async function opened(opts) {
  const o = loadOverlay(opts);
  await o.sandbox.Findings.open();
  await settle();
  assert.equal(o.sandbox.Findings.isOpen(), true, 'the overlay is open');
  return o;
}

const DESKTOP_ONLY = new Error('Capturing the window is only available in the desktop app.');

// ---------- 3. a capture that really fails: said in the interface language, the finding still saved ----------

test('#751 pt-BR: a capture that fails shows the catalog\'s Portuguese message, not the English one', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => { throw DESKTOP_ONLY; } } });
  const shown = o.status();
  assert.doesNotMatch(shown, /Could not capture the window|only available in the desktop app/, `status: ${shown}`);
  assert.match(shown, /capturar/i, `status: ${shown}`);
  assert.ok(keysReading(shown, 'pt-BR').length > 0, `"${shown}" is not a value of pt-BR.json`);
});

test('#751 pt-BR: a capture that gives nothing shows the same kind of Portuguese message (marks on a blank picture)', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => null } });
  const shown = o.status();
  assert.doesNotMatch(shown, /Capturing the window is only available/, `status: ${shown}`);
  assert.match(shown, /capturar/i, `status: ${shown}`);
  assert.ok(keysReading(shown, 'pt-BR').length > 0, `"${shown}" is not a value of pt-BR.json`);
});

test('#751 en: the capture failure message comes from the catalog too', async () => {
  const o = await opened({ lang: 'en', api: { captureWindow: async () => { throw new Error('boom'); } } });
  const shown = o.status();
  assert.match(shown, /captur/i, `status: ${shown}`);
  assert.ok(keysReading(shown, 'en').length > 0, `"${shown}" is not a value of en.json`);
});

test('#751 a failed capture: Save still saves the finding with the note and the context (screen, size), on a blank picture', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => { throw DESKTOP_ONLY; } } });
  o.dom.type(o.q('findings-note'), 'O botão some');
  o.q('findings-save').click();
  await settle();
  const saves = o.posts.filter((p) => p.channel === 'findings:save');
  assert.equal(saves.length, 1, 'findings:save once');
  const f = saves[0].arg;
  assert.equal(f.note, 'O botão some');
  assert.equal(f.context.view, 'run');
  assert.equal(f.context.tab, 'steps');
  assert.deepEqual(f.context.window, { width: 1000, height: 500 });
  assert.equal(typeof f.image, 'string');
  assert.equal(f.image.startsWith('data:image/png;base64,'), true, 'a (blank) PNG');
});

// ---------- 4. the tools, undo and the empty marks list in the interface language ----------

test('#751 pt-BR: the tool labels are not the English words and each is a pt-BR catalog value', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => SHOT } });
  for (const [tool, english] of Object.entries(TOOLS)) {
    const label = text(o.q(`findings-tool-${tool}`));
    assert.notEqual(label, english, `findings-tool-${tool} reads "${label}"`);
    assert.ok(label.length > 0, `findings-tool-${tool} has a label`);
    assert.ok(keysReading(label, 'pt-BR').length > 0, `"${label}" is not a value of pt-BR.json`);
  }
});

test('#751 en: the tool labels read Pin, Circle, Box, Arrow, Freehand from the catalog', async () => {
  const o = await opened({ lang: 'en', api: { captureWindow: async () => SHOT } });
  for (const [tool, english] of Object.entries(TOOLS)) {
    assert.equal(text(o.q(`findings-tool-${tool}`)), english);
    assert.ok(keysReading(english, 'en').length > 0, `"${english}" is not a value of en.json`);
  }
});

test('#751 pt-BR: the undo button reads "Desfazer marca"', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => SHOT } });
  assert.equal(text(o.q('findings-undo')), 'Desfazer marca');
});

test('#751 pt-BR: the empty marks list does not say "No marks yet." and reads a pt-BR catalog value', async () => {
  const o = await opened({ lang: 'pt-BR', api: { captureWindow: async () => SHOT } });
  const empty = String(o.q('findings-marks').getAttribute('data-empty') ?? '');
  assert.notEqual(empty, 'No marks yet.');
  assert.ok(empty.trim().length > 0, 'an empty-list text');
  assert.ok(keysReading(empty, 'pt-BR').length > 0, `"${empty}" is not a value of pt-BR.json`);
});

// ---------- 2 + 5. the remote window: api-http.js with the preload's capture; Save and File as issue send it ----------

test('#751 remote window: the overlay over api-http.js shows the native capture of the preload, with no error', async () => {
  const o = await opened({ lang: 'pt-BR', api: 'http', bridge: { capturePage: async () => SHOT } });
  const img = o.document.querySelector('[data-testid="findings-frame"] .fd-img');
  assert.equal(String(img?.localName ?? ''), 'img', 'the frozen view is a picture, not the blank one');
  assert.equal(String(img.getAttribute('src') ?? img.src ?? ''), SHOT);
  assert.doesNotMatch(o.status(), /only available in the desktop app|capturar/i, `status: ${o.status()}`);
});

test('#751 remote window: Save POSTs findings:save with the captured screenshot and the marked picture', async () => {
  const o = await opened({ lang: 'en', api: 'http', bridge: { capturePage: async () => SHOT } });
  o.q('findings-canvas').dispatchEvent(new o.dom.classes.MouseEvent('click', { bubbles: true, clientX: 400, clientY: 200 }));
  o.dom.type(o.q('findings-note'), 'the badge overlaps');
  o.q('findings-save').click();
  await settle();
  const saves = o.posts.filter((p) => p.channel === 'findings:save');
  assert.equal(saves.length, 1, `channels POSTed: ${o.posts.map((p) => p.channel).join(', ')}`);
  const f = saves[0].arg;
  assert.equal(f.image, SHOT, 'the remote capture is the finding\'s image');
  assert.equal(f.marked, MARKED, 'the picture with the marks drawn');
  assert.deepEqual(f.marks.map((m) => `${m.type} ${m.x},${m.y}`), ['pin 400,200']);
  assert.equal(f.note, 'the badge overlaps');
  assert.deepEqual(f.context.window, { width: 1000, height: 500 });
});

test('#751 remote window: File as issue saves the screenshot with the marks, then files that finding', async () => {
  const o = await opened({ lang: 'en', api: 'http', bridge: { capturePage: async () => SHOT } });
  o.q('findings-canvas').dispatchEvent(new o.dom.classes.MouseEvent('click', { bubbles: true, clientX: 100, clientY: 50 }));
  o.q('findings-file-issue').click();
  await settle();
  const channels = o.posts.map((p) => p.channel).filter((c) => c.startsWith('findings:'));
  assert.deepEqual(channels, ['findings:save', 'findings:file']);
  const save = o.posts.find((p) => p.channel === 'findings:save').arg;
  assert.equal(save.image, SHOT);
  assert.equal(save.marked, MARKED);
  assert.equal(save.marks.length, 1);
  const file = o.posts.find((p) => p.channel === 'findings:file').arg;
  assert.equal(file.id, 'f-751');
  assert.equal(file.projectId, 'p1');
});
