// #751 acceptance (tests first): the release city's Save image (fronts/analyser/views/project/
// project-city-release.js, cityImage → api.captureWindow) works in the desktop app's remote engine
// window, through the same capture as the Findings overlay: window.api there is
// apps/web/renderer/api-http.js, and the remote window's preload exposes the native capture as
// `window.desktopCapture.capturePage()` → a PNG data URL (contract in
// apps/desktop/test/host/engine-connection-window-751.test.js). Today api-http.js's captureWindow
// throws "Capturing the window is only available in the desktop app." there.
// Loaded as in project-city-release-show-376.test.js (a mini DOM without WebGL, the city's scripts),
// with api-http.js loaded first as the page does; the release's own channels are faked on that api
// and the canvas is faked at its boundary (2D context, toDataURL, Image).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIR = pageFileOf('views/project');
const API_HTTP = path.join(ROOT, 'apps', 'web', 'renderer', 'api-http.js');
const SHOT = 'data:image/png;base64,UkVNT1RF';
const PNG = 'data:image/png;base64,UE5H';
const hash = '75'.repeat(20);
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'docs/a.md', lines: 5 }];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
const RELEASE = () => ({
  state: 'ok', from: '1.1.1', to: '1.1.2', tags: ['1.1.2', '1.1.1'], plan: null,
  base: buildCity({ plan: null, facts: facts() }),
  changes: [{ status: 'changed', path: 'src/engine/run.js', lines: 10 }],
  commits: [{ commit: 'b'.repeat(40), subject: 'Edit run (#13)', issues: [13], files: ['src/engine/run.js'] }],
});

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function load({ bridge }) {
  const { DESKTOP } = require('@craftorio/engine/service/manifest');
  const calls = { anchors: [], drawn: [], captures: 0 };
  function FakeXHR() { this.readyState = 0; }
  FakeXHR.prototype.open = function open(_m, url) { this.url = url; };
  FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
  FakeXHR.prototype.send = function send() { this.status = 200; this.readyState = 4; this.responseText = JSON.stringify({ result: DESKTOP, contract: null }); };
  class FakeWebSocket { constructor(url) { this.url = String(url); this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, URL, queueMicrotask,
    innerWidth: 800, innerHeight: 600,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    state: { projects: [{ id: 'p1', name: 'fixture-app' }] },
    location: { protocol: 'http:', host: 'engine.invalid:7300', href: 'http://engine.invalid:7300/apps/web/renderer/index.html', reload() {} },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/140 Electron/44.0.0 CraftorioRemoteClient', clipboard: {}, onLine: true },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    fetch: async () => ({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({ error: 'not here' }), text: async () => '{}' }),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    desktopCapture: { capturePage: async () => { calls.captures++; return bridge(); } },
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, self: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = function getContext(kind) {
    return this.localName === 'canvas' && kind === '2d' ? { drawImage: (img) => calls.drawn.push(String(img?.src ?? '')), fillRect() {}, fillText() {} } : null;
  };
  dom.classes.Element.prototype.toDataURL = () => PNG;
  sandbox.Image = class {
    constructor() { this.naturalWidth = 800; this.naturalHeight = 600; }
    set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };
  withI18n(sandbox);
  vm.createContext(sandbox);
  // the page's api first (app.js uses window.api as it loads)
  vm.runInContext(fs.readFileSync(API_HTTP, 'utf8'), sandbox, { filename: 'api-http.js' });
  assert.ok(sandbox.api, 'api-http.js defined window.api');
  sandbox.api.architectureCity = async () => ({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) });
  sandbox.api.architectureRelease = async () => JSON.parse(JSON.stringify(RELEASE()));
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'city-release.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'ui-kit', 'select.js'), 'utf8'), sandbox, { filename: 'select.js' });
  const optional = ['project-city-modes.js', 'project-city-panels.js'].filter((f) => fs.existsSync(path.join(DIR, f)));
  for (const f of [...optional, 'project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-release.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  const make = sandbox.document.createElement.bind(sandbox.document);
  sandbox.document.createElement = (tag) => { const el = make(tag); if (String(tag).toLowerCase() === 'a') calls.anchors.push(el); return el; };
  return { w: sandbox, calls };
}

async function shown(t, opts) {
  const { w, calls } = load(opts);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityRelease.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  await handle.show({ to: '1.1.2' });
  await settle();
  return { w, calls, city };
}

test('#751 remote window: Save image cuts the city out of the preload\'s native capture and downloads the PNG', async (t) => {
  const { calls, city } = await shown(t, { bridge: async () => SHOT });
  q(city.el, 'city-release-save-image').click();
  await settle();
  assert.doesNotMatch(text(q(city.el, 'city-release')), /Could not save the image|only available in the desktop app/);
  assert.equal(calls.captures, 1, 'the native capture was asked once');
  assert.deepEqual(calls.drawn, [SHOT], 'the city is cut out of that capture');
  const links = calls.anchors.filter((a) => a.download);
  assert.equal(links.length, 1, 'one download link');
  assert.equal(String(links[0].download), 'fixture-app-1.1.1-to-1.1.2.png');
  assert.equal(String(links[0].href), PNG);
});
