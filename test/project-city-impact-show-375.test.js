// #375, the impact overlay's preview on the City view: ProjectCityImpact.attach(city, { projectId })
// → { show(req), destroy() } (src/renderer/views/project/project-city-impact.js), in a mini DOM without
// WebGL next to the city's own scripts, with the app's api faked at its boundary:
//   - an issue after its run: the city's 'impact' layer holds the three sets (changed as predicted,
//     predicted but untouched, changed but not predicted) in three colours, the card gives the hit rate,
//     and the rate is recorded once (architecture:impact with `record`), never again for the same run
//     nor when the history could not be read;
//   - a stage: a building two items would change is in the collision red and listed in
//     data-testid="city-impact-conflicts";
//   - Close removes the layer, and an answer arriving after Close is dropped.
// #440/#441 (the contract in test/project-city-modes-440.test.js and test/project-city-panels-441.test.js):
// the issue puts the city in its mode (data-city-mode="impact", "Issue #375"), a stage in "stage";
// Close and a second show leave no legend row and no card of the previous preview; the card is a panel
// (data-city-panel="impact") whose chevron minimizes it and keeps its content.
// #430 (the contract in test/project-city-modal-430.test.js): "Show on the map" (showIssue, showStage,
// fromRoadmap) opens the impact in the City modal (data-testid="city-modal") over the screen it was
// asked from, never the Project screen (no openProjectView); the attach / show contract above is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'renderer', 'views', 'project');
const hash = '37'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// the issue cites run.js and queue.js; its finished run changed run.js and docs/a.md
const ISSUE = {
  number: 375, title: 'Preview the impact',
  body: 'Change `src/engine/run.js:12` and src/engine/queue.js.',
  runs: [{ runId: 'run-1', status: 'done', mock: false }],
};
const CHANGED = ['src/engine/run.js', 'docs/a.md'];

function load({ impact = () => ({ plan: null, history: {}, error: null }) } = {}) {
  const calls = { impact: [], overlay: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: {
      architectureCity: async () => ({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }),
      architectureImpact: async (arg) => {
        calls.impact.push(JSON.parse(JSON.stringify(arg)));
        const out = await impact(arg);
        return JSON.parse(JSON.stringify(out));
      },
      productOwnerHistory: async () => [],
      getBacklog: async () => ({ issues: [] }),
      runDiff: async () => ({ files: CHANGED.map((file) => ({ file })) }),
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    showRun: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  // #440/#441: the modes' and the panels' helpers, when they have their own files
  const optional = ['project-city-modes.js', 'project-city-panels.js'].filter((f) => fs.existsSync(path.join(DIR, f)));
  for (const f of [...optional, 'project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  const overlay = sandbox.ProjectCity.overlay;
  sandbox.ProjectCity.overlay = (name, spec) => { calls.overlay.push({ name: String(name), spec: spec ? JSON.parse(JSON.stringify(spec)) : null }); return overlay(name, spec); };
  vm.runInContext(fs.readFileSync(path.join(DIR, 'project-city-impact.js'), 'utf8'), sandbox, { filename: 'project-city-impact.js' });
  return { w: sandbox, calls };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lastImpact = (calls) => calls.overlay.filter((c) => c.name === 'impact').at(-1) || null;
const records = (calls) => calls.impact.filter((a) => a.record);

async function open(t, opts) {
  const { w, calls } = load(opts);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityImpact.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  return { w, calls, city, handle };
}

test('#375 impact preview after the run: the three sets on the map and the hit rate on the card', async (t) => {
  const { calls, city, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  const layer = lastImpact(calls);
  assert.ok(layer && layer.spec, 'the impact layer is set');
  const hl = layer.spec.highlight;
  assert.deepEqual(Object.keys(hl).sort(), ['docs/a.md', 'src/engine/queue.js', 'src/engine/run.js']);
  assert.equal(new Set([hl['src/engine/run.js'], hl['src/engine/queue.js'], hl['docs/a.md']]).size, 3, 'hit, missed and unexpected have their own colours');
  const card = text(q(city.el, 'city-impact-comparison'));
  assert.match(card, /50%/);
  assert.match(text(q(city.el, 'city-impact-hit')), /^1\b/);
  assert.match(text(q(city.el, 'city-impact-missed')), /^1\b/);
  assert.match(text(q(city.el, 'city-impact-unexpected')), /^1\b/);
});

test('#375 impact preview records the run\'s hit rate once', async (t) => {
  const { calls, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  assert.deepEqual(records(calls), [{ projectId: 'p1', record: { issue: 375, hitRate: 0.5, run: 'run-1', withSection: false } }]);
});

test('#375 impact preview does not record again when the history already holds the run', async (t) => {
  const history = { 375: [{ hitRate: 0.5, ts: '2026-10-14T10:00:00.000Z', run: 'run-1' }] };
  const { calls, handle } = await open(t, { impact: () => ({ plan: null, history, error: null }) });
  await handle.show({ issue: ISSUE });
  await settle();
  assert.equal(records(calls).length, 0);
  assert.ok(calls.impact.length >= 1, 'the history was read');
});

test('#375 impact preview never records when the history could not be read', async (t) => {
  const { calls, handle } = await open(t, { impact: () => ({ plan: null, history: {}, error: 'Could not read impact-history.json: Unexpected end of JSON input' }) });
  await handle.show({ issue: ISSUE });
  await settle();
  assert.equal(records(calls).length, 0);
});

test('#375 impact preview before any run records nothing and has no comparison', async (t) => {
  const { calls, city, handle } = await open(t);
  await handle.show({ issue: { ...ISSUE, runs: [] } });
  await settle();
  assert.equal(records(calls).length, 0);
  assert.equal(q(city.el, 'city-impact-comparison') === null, true);
  assert.deepEqual(Object.keys(lastImpact(calls).spec.highlight).sort(), ['src/engine/queue.js', 'src/engine/run.js']);
});

test('#375 stage footprint: a building two items would change is in the collision red and listed as a conflict', async (t) => {
  const { w, calls, city, handle } = await open(t);
  const stage = {
    name: 'Engine fixes',
    items: [
      { id: 'a', number: 1, title: 'First', body: 'Edit `src/engine/run.js` and `src/engine/gates.js`' },
      { id: 'b', number: 2, title: 'Second', body: 'Edit `src/engine/run.js` and `docs/a.md`' },
    ],
  };
  await handle.show({ stage });
  await settle();
  const hl = lastImpact(calls).spec.highlight;
  assert.equal(hl['src/engine/run.js'], w.CityAgents.COLLISION_COLOUR);
  assert.notEqual(hl['src/engine/gates.js'], hl['docs/a.md']);
  assert.match(text(q(city.el, 'city-impact-conflicts')), /src\/engine\/run\.js/);
  assert.doesNotMatch(text(q(city.el, 'city-impact-conflicts')), /gates\.js/);
});

test('#375 Close removes the impact layer and hides the card', async (t) => {
  const { calls, city, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  q(city.el, 'city-impact-close').click();
  await settle();
  assert.deepEqual(lastImpact(calls), { name: 'impact', spec: null });
  assert.equal(q(city.el, 'city-impact-header') === null, true);
  assert.equal(q(city.el, 'city-impact').classList.contains('hidden'), true);
});

test('#375 an answer arriving after Close is dropped: no layer comes back, nothing is recorded', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { calls, city, handle } = await open(t, { impact: async () => { await gate; return { plan: null, history: {}, error: null }; } });
  const shown = handle.show({ issue: ISSUE });
  await settle();
  q(city.el, 'city-impact-close').click();
  release();
  await shown;
  await settle();
  const layer = lastImpact(calls);
  assert.equal(layer === null || layer.spec === null, true, 'no impact layer after Close');
  assert.equal(records(calls).length, 0);
  assert.equal(q(city.el, 'city-impact-header') === null, true);
});

const legendText = (city) => text(q(city.el, 'project-city-legend'));
const STAGE = {
  name: 'Engine fixes',
  items: [
    { id: 'a', number: 1, title: 'First', body: 'Edit `src/engine/run.js`' },
    { id: 'b', number: 2, title: 'Second', body: 'Edit `docs/a.md`' },
  ],
};

test('#440 an issue puts the city in the impact mode; Close takes its legend rows away and the city back to Explore', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: { ...ISSUE, runs: [] } });
  await settle();
  assert.equal(String(city.el.getAttribute('data-city-mode') ?? ''), 'impact');
  assert.equal(text(q(city.el, 'city-mode-title')), 'Issue #375');
  assert.match(legendText(city), /Cited in the issue/);
  q(city.el, 'city-impact-close').click();
  await settle();
  assert.doesNotMatch(legendText(city), /Cited in the issue|Impact/i, 'no impact row left in the legend');
  assert.equal(String(city.el.getAttribute('data-city-mode') ?? ''), 'explore');
});

test('#440 a second show replaces the first: the stage after the issue, no row and no card of the issue left', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: { ...ISSUE, runs: [] } });
  await settle();
  await handle.show({ stage: STAGE });
  await settle();
  assert.equal(String(city.el.getAttribute('data-city-mode') ?? ''), 'stage');
  assert.match(text(q(city.el, 'city-mode-title')), /Stage.*Engine fixes/);
  assert.doesNotMatch(legendText(city), /Cited in the issue/);
  assert.equal(q(city.el, 'city-impact-header') === null, true, 'no stale issue card');
});

test('#441 the impact card is a panel: its chevron minimizes it to its title row and keeps its content', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  const panel = city.el.querySelector('[data-city-panel="impact"]');
  assert.equal(panel === null, false, 'data-city-panel="impact"');
  const chev = panel.querySelector('[data-testid="city-panel-toggle"]');
  assert.equal(chev === null, false, 'its chevron');
  assert.equal(chev.localName, 'button');
  assert.equal(String(chev.getAttribute('aria-expanded')), 'true');
  const before = text(q(city.el, 'city-impact-comparison'));
  chev.click();
  await settle();
  const toggle = city.el.querySelector('[data-city-panel="impact"] [data-testid="city-panel-toggle"]');
  assert.equal(String(toggle?.getAttribute('aria-expanded')), 'false');
  assert.equal(text(q(city.el, 'city-impact-comparison')), before, 'the comparison is kept while minimized');
  toggle.click();
  await settle();
  assert.equal(String(city.el.querySelector('[data-city-panel="impact"] [data-testid="city-panel-toggle"]')?.getAttribute('aria-expanded')), 'true');
  assert.match(text(q(city.el, 'city-impact-comparison')), /50%/);
});

// #430: the entry points through the app's window (test/city-modes-harness.js: every city script,
// project-city-modal.js included; openProjectView recorded in calls.openCity), on the Backlog
const MODAL_FILE = path.join(DIR, 'project-city-modal.js');
async function fromBacklog(t, show) {
  assert.equal(fs.existsSync(MODAL_FILE), true, 'src/renderer/views/project/project-city-modal.js exists (#430)');
  const H = require('./city-modes-harness');
  const h = H.loadWindow();
  h.w.state.view = 'backlog';
  show(h.w);
  await settle();
  const modal = q(h.dom.document.body, 'city-modal');
  t.after(() => { try { q(modal, 'city-modal-close')?.click(); } catch { /* already closed */ } });
  return { ...h, modal, city: q(modal, 'project-city') };
}

test('#430 "Show on the map" on an issue opens its impact in the City modal, not on the Project screen', async (t) => {
  const o = await fromBacklog(t, (w) => w.ProjectCityImpact.showIssue('p1', { ...ISSUE, runs: [] }));
  assert.equal(o.modal === null, false, 'the City modal');
  assert.equal(String(o.city?.getAttribute('data-city-mode') ?? ''), 'impact');
  assert.match(text(q(o.city, 'city-impact-header')), /#375/);
  assert.deepEqual(o.calls.openCity, [], 'no openProjectView');
  assert.equal(String(o.w.state.view), 'backlog');
});

test('#430 a roadmap stage\'s "Show the stage on the map" (fromRoadmap) opens its footprint in the City modal', async (t) => {
  const roadmap = { stages: [{ id: 'st1', name: 'Engine fixes', items: [
    { id: 'it1', issues: [{ number: 1, title: 'First' }] },
    { id: 'it2', issues: [{ number: 2, title: 'Second' }] },
  ] }] };
  const issues = [
    { number: 1, title: 'First', body: 'Edit `src/engine/run.js`', runs: [] },
    { number: 2, title: 'Second', body: 'Edit `src/engine/run.js`', runs: [] },
  ];
  const o = await fromBacklog(t, (w) => w.ProjectCityImpact.fromRoadmap('p1', roadmap, issues, { rmMapStage: '0' }));
  assert.equal(o.modal === null, false, 'the City modal');
  assert.equal(String(o.city?.getAttribute('data-city-mode') ?? ''), 'stage');
  assert.match(text(q(o.city, 'city-impact-conflicts')), /src\/engine\/run\.js/);
  assert.deepEqual(o.calls.openCity, [], 'no openProjectView');
});
