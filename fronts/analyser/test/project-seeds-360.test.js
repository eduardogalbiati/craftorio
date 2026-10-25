// #360: the Seeds section of a project's Architecture tab (fronts/analyser/views/project/project-seeds.js)
// in a mini DOM, with a fake window.api returning literal rows: one row per seed with its status
// (Never run, Stale with "N commits since", Tool available and free, an error's message), Run asks
// the estimate before running and shows Running while the run is pending, Open result shows the page
// in a sandboxed iframe (no same-origin, no top navigation) whose srcdoc carries a CSP with
// default-src 'none', and "Make it a tool" calls makeSeedTool with the project and the seed.
// The module is created by the change: each test loads it (tests first), so a missing file fails that
// test only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');

const ROOT = path.join(__dirname, '..', '..', '..');

const ROWS = [
  { id: 'churn-complexity', name: 'churn-complexity', summary: 'Churn against complexity.', cost: 'one Oracle turn', lastRun: null, tool: null, commitsSince: null },
  { id: 'dependency-map', name: 'dependency-map', summary: 'The dependency map.', cost: 'one Oracle turn', lastRun: { date: '2026-10-01T10:00:00Z', costUsd: 0.12, source: 'oracle' }, tool: null, commitsSince: 3 },
  { id: 'pipeline-anatomy', name: 'pipeline-anatomy', summary: 'The CI pipeline.', cost: 'one Oracle turn', lastRun: { date: '2026-10-02T10:00:00Z', costUsd: 0, source: 'tool' }, tool: 'node tools/pipeline.js', commitsSince: 0 },
  { id: 'quality-gate-report', name: 'quality-gate-report', summary: 'The quality gate.', cost: 'one Oracle turn', lastRun: null, tool: null, commitsSince: null, error: 'gh: not logged in' },
];

const PAGE = '<html><body><h1>Dependency map</h1></body></html>';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function loadWindow({ runSeed = null } = {}) {
  const calls = [];
  const args = {};
  const record = (name, a) => { calls.push(name); (args[name] ||= []).push(a); };
  const api = {
    listSeeds: async (a) => { record('listSeeds', a); return ROWS.map((r) => ({ ...r })); },
    seedEstimate: async (a) => { record('seedEstimate', a); return { costUsd: 0.1, free: false }; },
    runSeed: async (a) => { record('runSeed', a); return runSeed ? runSeed(a) : { date: '2026-10-15T10:00:00Z', source: 'oracle', costUsd: 0.1, simulated: true }; },
    seedHistory: async (a) => { record('seedHistory', a); return [{ date: '2026-10-01T10:00:00Z', source: 'oracle', costUsd: 0.12, simulated: false }]; },
    seedResult: async (a) => { record('seedResult', a); return { html: PAGE, model: { nodes: [] } }; },
    makeSeedTool: async (a) => { record('makeSeedTool', a); return { preview: true, url: null, title: 'Make dependency-map a tool', body: 'pure core' }; },
    setSeedTool: async (a) => { record('setSeedTool', a); return { tool: null }; },
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    confirm: () => true,
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'json-schema.js'), 'utf8'), sandbox, { filename: 'json-schema.js' });
  vm.runInContext(fs.readFileSync(pageFileOf('views/project/project-seeds.js'), 'utf8'), sandbox, { filename: 'project-seeds.js' });
  const PS = sandbox.ProjectSeeds;
  assert.equal(typeof PS?.show, 'function', 'window.ProjectSeeds.show');
  // Clicks: routed like the project page does when the module exposes onClick; otherwise the module
  // binds its own listeners.
  if (typeof PS.onClick === 'function') dom.document.addEventListener('click', (e) => PS.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { PS, box, calls, args, click };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (box, id) => box.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function shown(opts) {
  const w = loadWindow(opts);
  await w.PS.show('p1', w.box);
  await settle();
  return w;
}

test('#360 the Seeds section renders one row per seed', async () => {
  const w = await shown();
  assert.ok(q(w.box, 'seeds-section'), 'seeds-section');
  assert.equal(w.box.querySelectorAll('[data-testid^="seed-status-"]').length, ROWS.length);
  for (const r of ROWS) {
    assert.ok(q(w.box, `seed-${r.id}`), `row seed-${r.id}`);
    assert.match(text(q(w.box, `seed-${r.id}`)), new RegExp(r.name), `${r.id} shows its name`);
  }
});

test('#360 a never-run seed says Never run', async () => {
  const w = await shown();
  assert.match(text(q(w.box, 'seed-status-churn-complexity')), /Never run/);
});

test('#360 a seed with commits since its last run is Stale with "3 commits since"', async () => {
  const w = await shown();
  const status = text(q(w.box, 'seed-status-dependency-map'));
  assert.match(status, /Stale/);
  assert.match(status, /3 commits since/);
});

test('#360 a seed with a recorded tool says Tool available, free', async () => {
  const w = await shown();
  const status = text(q(w.box, 'seed-status-pipeline-anatomy'));
  assert.match(status, /Tool available/);
  assert.match(status, /free/);
});

test('#360 a seed whose row carries an error shows the message', async () => {
  const w = await shown();
  assert.match(text(q(w.box, 'seed-status-quality-gate-report')), /gh: not logged in/);
});

test('#360 Run asks the estimate before running, and shows Running while the run is pending', async () => {
  const pending = deferred();
  const w = await shown({ runSeed: () => pending.promise });
  w.click(q(w.box, 'seed-run-churn-complexity'));
  await settle();
  const names = w.calls.filter((n) => n === 'seedEstimate' || n === 'runSeed');
  assert.deepEqual(names, ['seedEstimate', 'runSeed']);
  assert.equal(w.args.runSeed[0].projectId, 'p1');
  assert.equal(w.args.runSeed[0].seedId, 'churn-complexity');
  assert.match(text(q(w.box, 'seed-status-churn-complexity')), /Running/);
  pending.resolve({ date: '2026-10-15T10:00:00Z', source: 'oracle', costUsd: 0.1, simulated: true });
  await settle();
});

test('#360 Open result shows the page in a sandboxed iframe with a CSP that blocks the network', async () => {
  const w = await shown();
  w.click(q(w.box, 'seed-open-dependency-map'));
  await settle();
  assert.ok(w.calls.includes('seedResult'), 'seedResult called');
  const frame = q(w.box, 'seed-frame') || w.box.ownerDocument.querySelector('[data-testid="seed-frame"]');
  assert.ok(frame, 'seed-frame');
  assert.equal(frame.localName, 'iframe');
  const sandboxAttr = frame.getAttribute('sandbox') ?? (frame.sandbox == null ? null : String(frame.sandbox.value ?? frame.sandbox));
  assert.equal(typeof sandboxAttr, 'string', 'a sandbox attribute');
  assert.equal(sandboxAttr.includes('allow-same-origin'), false, 'no allow-same-origin');
  assert.equal(sandboxAttr.includes('allow-top-navigation'), false, 'no allow-top-navigation');
  const srcdoc = String(frame.getAttribute('srcdoc') ?? frame.srcdoc ?? '');
  assert.ok(srcdoc.includes('Content-Security-Policy'), 'a CSP meta');
  assert.ok(srcdoc.includes("default-src 'none'"), "default-src 'none'");
});

test('#360 Make it a tool calls makeSeedTool with the project and the seed', async () => {
  const w = await shown();
  w.click(q(w.box, 'seed-make-tool-dependency-map'));
  await settle();
  assert.equal(w.args.makeSeedTool?.length, 1, 'makeSeedTool called once');
  assert.equal(w.args.makeSeedTool[0].projectId, 'p1');
  assert.equal(w.args.makeSeedTool[0].seedId, 'dependency-map');
});
