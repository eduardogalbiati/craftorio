// #376, the release overlay on the City view: ProjectCityRelease.attach(city, { projectId }) →
// { show(req), destroy() } and ProjectCityRelease.showRelease(projectId, { to, from? })
// (fronts/analyser/views/project/project-city-release.js), in a mini DOM without WebGL next to the
// city's own scripts, with the app's api faked at its boundary (architectureRelease, architectureCity,
// captureWindow):
//   - a release: the 'release' layer colours the added and changed buildings, marks the removed ones
//     "removed", and the card counts them; the issue filter keeps one issue's files without reading again;
//   - the first release: the two-tag picker only when two refs or more can be picked, and a pick reads again;
//   - Close removes the layer and reloads the project's own city;
//   - a destroyed overlay (a project switch) no longer answers showRelease;
//   - Save image: a PNG named after the project and the tags, the caption under the city; a failed
//     capture is said on the card.
// #440/#441 (the contract in test/project-city-modes-440.test.js and test/project-city-panels-441.test.js):
// a release puts the city in its mode (data-city-mode="release", "Release 1.1.1 → 1.1.2"), with no
// Live toggle (#439: only the plan's real problems, not what the base commit lacks); Close goes back to "explore"; the card
// is a panel (data-city-panel="release") whose chevron minimizes it and keeps the issue picked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIR = pageFileOf('views/project');
const hash = '76'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// 1.1.1 → 1.1.2: #12 added new.js, #13 changed run.js and removed docs/a.md
const RELEASE = () => ({
  state: 'ok', from: '1.1.1', to: '1.1.2', tags: ['1.1.2', '1.1.1', '1.1.0'], plan: null,
  base: buildCity({ plan: null, facts: facts() }),
  changes: [
    { status: 'removed', path: 'docs/a.md', lines: 5 },
    { status: 'added', path: 'src/engine/new.js', lines: 5 },
    { status: 'changed', path: 'src/engine/run.js', lines: 10 },
  ],
  commits: [
    { commit: 'a'.repeat(40), subject: 'Add the new module (#12)', issues: [12], files: ['src/engine/new.js'] },
    { commit: 'b'.repeat(40), subject: 'Remove a doc and edit run (#13)', issues: [13], files: ['docs/a.md', 'src/engine/run.js'] },
  ],
});

function load({ release = async () => RELEASE(), capture = async () => 'data:image/png;base64,QUJD' } = {}) {
  const calls = { release: [], city: 0, overlay: [], anchors: [], captions: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    state: { projects: [{ id: 'p1', name: 'fixture-app' }] },
    api: {
      architectureCity: async () => { calls.city++; return { state: 'ok', ...buildCity({ plan: null, facts: facts() }) }; },
      architectureRelease: async (arg) => {
        calls.release.push(JSON.parse(JSON.stringify(arg)));
        return JSON.parse(JSON.stringify(await release(arg)));
      },
      captureWindow: capture,
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'city-release.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  // The app's select builder, so the pickers are built as in the app (#383).
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'ui-kit', 'select.js'), 'utf8'), sandbox, { filename: 'select.js' });
  // #440/#441: the modes' and the panels' helpers, when they have their own files
  const optional = ['project-city-modes.js', 'project-city-panels.js'].filter((f) => fs.existsSync(path.join(DIR, f)));
  for (const f of [...optional, 'project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  const overlay = sandbox.ProjectCity.overlay;
  sandbox.ProjectCity.overlay = (name, spec) => { calls.overlay.push({ name: String(name), spec: spec ? JSON.parse(JSON.stringify(spec)) : null }); return overlay(name, spec); };
  vm.runInContext(fs.readFileSync(path.join(DIR, 'project-city-release.js'), 'utf8'), sandbox, { filename: 'project-city-release.js' });
  return { w: sandbox, dom, calls };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lastRelease = (calls) => calls.overlay.filter((c) => c.name === 'release').at(-1) || null;
const pick = (w, el, value) => { el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

async function open(t, opts) {
  const { w, dom, calls } = load(opts);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityRelease.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  return { w, dom, calls, city, handle };
}

async function shown(t, opts) {
  const o = await open(t, opts);
  await o.handle.show({ to: '1.1.2' });
  await settle();
  return o;
}

test('#376 a release on the city: added and changed buildings coloured, removed ones marked, the counts on the card', async (t) => {
  const { calls, city } = await shown(t);
  assert.deepEqual(calls.release, [{ projectId: 'p1', from: null, to: '1.1.2' }]);
  const layer = lastRelease(calls);
  assert.ok(layer && layer.spec, 'the release layer is set');
  assert.deepEqual(Object.keys(layer.spec.highlight).sort(), ['src/engine/new.js', 'src/engine/run.js']);
  assert.deepEqual(layer.spec.markers.map((m) => `${m.path} ${m.label}`), ['docs/a.md removed']);
  const header = text(q(city.el, 'city-release-header'));
  for (const s of ['1 added', '1 changed', '1 removed']) assert.match(header, new RegExp(s));
});

test('#376 the issue filter keeps only that issue\'s files, without reading the release again', async (t) => {
  const { w, calls, city } = await shown(t);
  pick(w, q(city.el, 'city-release-issue'), '12');
  await settle();
  assert.equal(calls.release.length, 1);
  const layer = lastRelease(calls);
  assert.deepEqual(Object.keys(layer.spec.highlight), ['src/engine/new.js']);
  assert.deepEqual(layer.spec.markers, []);
  const header = text(q(city.el, 'city-release-header'));
  assert.match(header, /1 added/);
  assert.doesNotMatch(header, /changed|removed/);
});

test('#376 the first release with a single tag: no previous release, no picker', async (t) => {
  const { city } = await shown(t, { release: async () => ({ state: 'first-release', from: null, to: '1.1.0', tags: ['1.1.0'] }) });
  const card = text(q(city.el, 'city-release'));
  assert.match(card, /first tag/);
  assert.doesNotMatch(card, /Pick a later release/);
  assert.equal(q(city.el, 'city-release-from') === null, true);
  assert.equal(q(city.el, 'city-release-to') === null, true);
});

test('#376 the first release with later tags: the two-tag picker is offered and a pick reads the release again', async (t) => {
  const first = { state: 'first-release', from: null, to: '1.1.0', tags: ['1.1.1', '1.1.0'] };
  const { w, calls, city } = await shown(t, { release: async (arg) => (arg.to === '1.1.1' ? { ...RELEASE(), from: '1.1.0', to: '1.1.1' } : first) });
  assert.match(text(q(city.el, 'city-release')), /Pick a later release below/);
  assert.equal(q(city.el, 'city-release-from') === null, false);
  pick(w, q(city.el, 'city-release-to'), '1.1.1');
  await settle();
  assert.equal(calls.release.length, 2);
  assert.equal(calls.release[1].to, '1.1.1');
  assert.match(text(q(city.el, 'city-release-header')), /1 added/);
});

test('#376 Close removes the release layer and reloads the project\'s own city', async (t) => {
  const { calls, city } = await shown(t);
  const before = calls.city;
  q(city.el, 'city-release-close').click();
  await settle();
  assert.deepEqual(lastRelease(calls), { name: 'release', spec: null });
  assert.equal(calls.city, before + 1, 'architecture:city read again');
  assert.equal(q(city.el, 'city-release-header') === null, true);
  assert.equal(q(city.el, 'city-release').classList.contains('hidden'), true);
});

test('#376 a destroyed release overlay (a project switch) no longer answers "Show on the map": one read for the live one', async (t) => {
  const { w, calls, city, handle } = await open(t);
  handle.destroy();
  const again = w.ProjectCityRelease.attach(city, { projectId: 'p1' });
  t.after(() => again.destroy());
  w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
  assert.equal(calls.release.length, 1);
  assert.equal(city.el.querySelectorAll('[data-testid="city-release"]').length, 1, 'the destroyed card is gone');
});

test('#376 Save image: a PNG named after the project and the tags, the caption with the project, the release and the counts', async (t) => {
  const { w, calls, city } = await shown(t);
  const ctx = {
    drawImage() {}, fillRect() {},
    fillText(s) { calls.captions.push(String(s)); },
  };
  w.Element.prototype.getContext = function (kind) { return this.localName === 'canvas' && kind === '2d' ? ctx : null; };
  w.Element.prototype.toDataURL = () => 'data:image/png;base64,UE5H';
  w.Image = class {
    constructor() { this.naturalWidth = 800; this.naturalHeight = 600; }
    set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };
  const make = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => { const el = make(tag); if (String(tag).toLowerCase() === 'a') calls.anchors.push(el); return el; };
  q(city.el, 'city-release-save-image').click();
  await settle();
  assert.equal(calls.anchors.length, 1, 'one download link');
  assert.equal(String(calls.anchors[0].download), 'fixture-app-1.1.1-to-1.1.2.png');
  assert.equal(String(calls.anchors[0].href), 'data:image/png;base64,UE5H');
  assert.equal(calls.captions.length, 1);
  for (const part of ['fixture-app', '1.1.1', '1.1.2', '1 added', '1 changed', '1 removed']) assert.ok(calls.captions[0].includes(part), `caption: ${calls.captions[0]}`);
});

test('#376 Save image when the window cannot be captured: the card says why, nothing is downloaded', async (t) => {
  const { w, calls, city } = await shown(t, { capture: async () => null });
  const make = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => { const el = make(tag); if (String(tag).toLowerCase() === 'a') calls.anchors.push(el); return el; };
  q(city.el, 'city-release-save-image').click();
  await settle();
  assert.match(text(q(city.el, 'city-release')), /Could not save the image: capturing the window is only available in the desktop app/);
  assert.equal(calls.anchors.filter((a) => a.download).length, 0);
});

// a plan with a district naming an unknown zone: the release's base city has plan problems
const PLAN = {
  version: 1, project: 'fixture-app', zones: [{ id: 'core', name: 'Core', kind: 'industrial' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['src/engine/**'] }, { id: 'lost', name: 'Lost', zone: 'nowhere', include: ['nothing/**'] }],
};

// #439 made a real plan problem (an unknown zone) still a problem on the release view: what a base
// commit lacks is tested in test/project-city-release-438-439.test.js
test('#440 a release puts the city in the release mode: its title, no Live; Close goes back to Explore', async (t) => {
  const { city } = await shown(t, { release: async () => ({ ...RELEASE(), plan: PLAN, base: buildCity({ plan: PLAN, facts: facts() }) }) });
  const mode = () => String(city.el.getAttribute('data-city-mode') ?? '');
  assert.equal(mode(), 'release');
  assert.equal(text(q(city.el, 'city-mode-title')), 'Release 1.1.1 → 1.1.2');
  const live = q(city.el, 'city-live-toggle');
  assert.equal(live === null || live.hidden === true || live.disabled === true, true, 'no Live on a release');
  q(city.el, 'city-release-close').click();
  await settle();
  assert.equal(mode(), 'explore');
  assert.equal(text(q(city.el, 'city-mode-title')), 'fixture-app');
});

test('#441 the release card is a panel: minimized it keeps the issue picked, expanded it shows the same counts', async (t) => {
  const { w, city } = await shown(t);
  pick(w, q(city.el, 'city-release-issue'), '12');
  await settle();
  const chev = () => city.el.querySelector('[data-city-panel="release"] [data-testid="city-panel-toggle"]');
  assert.equal(chev() === null, false, 'the release panel\'s chevron');
  assert.equal(chev().localName, 'button');
  assert.equal(String(chev().getAttribute('title') || '').trim() === '', false, 'a tooltip');
  chev().click();
  await settle();
  assert.equal(String(chev()?.getAttribute('aria-expanded')), 'false');
  assert.equal(String(q(city.el, 'city-release-issue')?.value ?? ''), '12', 'the issue picked is kept');
  chev().click();
  await settle();
  assert.equal(String(chev()?.getAttribute('aria-expanded')), 'true');
  assert.match(text(q(city.el, 'city-release-header')), /1 added/);
});

// #556 (a #428 regression): appended to the city, the card lay over the mode's header and its Close
test('#428 the release card sits at the top of the city\'s left column, away from the mode\'s Close', async (t) => {
  const { city } = await shown(t);
  const card = q(city.el, 'city-release');
  const left = city.el.querySelector('[data-pc-left]');
  const close = q(city.el, 'city-mode-close');
  assert.equal(left === null, false, 'the left column');
  assert.equal(close === null, false, 'the mode\'s Close');
  assert.equal(left.contains(card), true, 'the card is in the left column');
  assert.equal(left.firstElementChild === card, true, 'at its top');
  assert.equal(card.contains(close) || left.contains(close), false, 'the mode\'s Close is not under the card');
});
