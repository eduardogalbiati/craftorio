// #381: the City tab's one action (fronts/analyser/views/project/project-architecture.js, #730: the City
// tab of its own, the action in the city's notes, views/project/project-city-notes.js) in a mini DOM:
// "Analyze this project" with its combined estimate (the map's chain estimate plus the Oracle's, or
// "no estimate yet"), a click starts the project map run at once (run:start with mode auto and the
// analysis on, no confirmation), the tab follows the run's events (the step while it runs, the city
// and the facts read again when it ends, its error when it fails), a run started elsewhere shows the
// same way, and the old "Map this project" / "Analyze with the Oracle" controls are gone.
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
const hash = '11'.repeat(20);
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }, { path: 'docs/a.md', lines: 5 }];
const factsModel = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// #730: a city plan whose districts cover every file of FILES (no Outskirts)
const PLAN = {
  version: 1, project: 'fixture', summary: 'An engine and its docs.',
  zones: [{ id: 'core', name: 'Core', kind: 'commercial' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['src/**'] }, { id: 'docs', name: 'Docs', zone: 'core', include: ['docs/**'] }],
};

function loadWindow({ estimate = null, mapEstimate = null, startRun = null, plan = null } = {}) {
  const calls = { startRun: [], city: 0, facts: 0 };
  const listeners = [];
  const api = {
    architectureFacts: async () => { calls.facts++; return { state: 'ok', model: factsModel(), exclude: [], gate: [] }; },
    architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: 0 }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate }),
    architectureCity: async () => { calls.city++; return { state: 'ok', ...buildCity({ plan, facts: factsModel() }), refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null }; },
    chainEstimate: async () => mapEstimate,
    startRun: async (spec) => { calls.startRun.push(spec); return startRun ? startRun(spec) : { runId: 'run-1' }; },
    onEvent: (fn) => { listeners.push(fn); return () => {}; },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(pageFileOf('date-range.js'), 'utf8'), sandbox, { filename: 'date-range.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(pageFileOf(`views/project/${f}`), 'utf8'), sandbox, { filename: f });
  }
  dom.document.addEventListener('click', (e) => sandbox.ProjectArchitecture.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  const emit = (ev) => { for (const fn of listeners) fn(ev); };
  return { PA: sandbox.ProjectArchitecture, box, calls, click, emit, listeners };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (box, id) => box.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const estimateOf = (box) => q(box, 'project-city-no-plan')?.querySelector('.pc-estimate');

async function open(opts) {
  const w = loadWindow(opts);
  w.PA.show('p1', w.box);
  await settle();
  return w;
}

test('#381 one action, "Analyze this project", with the combined estimate of the map and the Oracle\'s turn', async () => {
  const w = await open({ estimate: { usd: 0.4, basis: 3 }, mapEstimate: { items: [{ basis: 2, costUsd: 0.25, minutes: 3 }] } });
  assert.match(text(q(w.box, 'project-city-analyze')), /Analyze this project/);
  assert.match(text(estimateOf(w.box)), /≈ US\$ 0\.65/, 'the map plus the Oracle');
  assert.match(estimateOf(w.box).getAttribute('title'), /simulations only/);
  for (const gone of ['architecture-map', 'architecture-map-confirm', 'architecture-mode-facts', 'architecture-mode-city']) assert.equal(q(w.box, gone), null, `${gone} is gone`);
  assert.equal(text(w.box).includes('Analyze with the Oracle'), false);
  assert.equal(text(w.box).includes('Map this project'), false);
});

// #730 (task "Cidade"): the City keeps its "Analyze" once the project has a plan, as a refresh of the plan
// (its title says so, as the Facts view's action did before #730) with its estimate, and a click starts the run
test('#730 with a city plan the City still offers "Analyze this project" as a refresh, with its estimate', async () => {
  const w = await open({ plan: PLAN, estimate: { usd: 0.4, basis: 3 }, mapEstimate: { items: [{ basis: 2, costUsd: 0.25, minutes: 3 }] } });
  assert.equal(q(w.box, 'project-city-no-plan'), null, 'the city is drawn from its plan');
  const button = w.box.querySelector('[data-testid="architecture-analyze"], [data-testid="project-city-analyze"]');
  assert.equal(button === null, false, 'an "Analyze this project" button on the City with a plan');
  assert.match(text(button), /Analyze this project/);
  assert.equal(button.disabled, false);
  assert.match(String(button.getAttribute('title')), /refresh/i, 'its title says it refreshes the plan');
  assert.match(text(w.box), /≈ US\$ 0\.65/, 'its estimate, the map plus the Oracle');
  w.click(button);
  await settle();
  assert.equal(w.calls.startRun.length, 1, 'a click starts the project map run');
});

test('#381 no estimate yet: the action says so, and still starts the run', async () => {
  const w = await open();
  assert.match(text(estimateOf(w.box)), /no estimate yet/);
  assert.match(estimateOf(w.box).getAttribute('title'), /first real run shows its cost/);
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  assert.equal(w.calls.startRun.length, 1);
});

test('#381 a click starts the project map run at once: mode auto, the analysis on, the project\'s folder; then the tab shows it running', async () => {
  const w = await open();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  const [spec] = w.calls.startRun;
  assert.equal(spec.file, 'analyze-project.yaml', '#631: project-map merged into analyze-project');
  assert.deepEqual(JSON.parse(JSON.stringify(spec.inputs)), { repo_path: 'C:/fixture', project_id: 'p1', mode: 'auto', analyze: true }); // the sandbox's object, compared by value
  assert.equal(spec.mock, true, 'a simulation in a simulation-only app');
  assert.equal(spec.projectId, 'p1');
  assert.equal(q(w.box, 'architecture-map-confirm'), null, 'no confirmation');
  assert.match(text(q(w.box, 'project-city-analyzing')), /Analyzing this project/);
  assert.equal(q(w.box, 'project-city-analyze'), null, 'no second start while it runs');
  w.emit({ type: 'step.started', run_id: 'run-1', step_id: 'plan' });
  assert.match(text(q(w.box, 'project-city-analyzing')), /cartographer writes the city plan/);
  w.emit({ type: 'step.started', run_id: 'run-1', step_id: 'analyze' });
  assert.match(text(q(w.box, 'project-city-analyzing')), /Oracle analyses the hotspots/);
  w.emit({ type: 'step.started', run_id: 'other', step_id: 'facts' });
  assert.match(text(q(w.box, 'project-city-analyzing')), /Oracle analyses the hotspots/, 'another run\'s events are not this one\'s');
});

test('#381 when the run ends with success the tab reads the city again and shows no running state', async () => {
  const w = await open();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  const before = w.calls.city;
  w.emit({ type: 'workflow.finished', run_id: 'run-1', status: 'success' });
  await settle();
  assert.equal(q(w.box, 'project-city-analyzing'), null, 'not shown as running once finished');
  assert.ok(w.calls.city > before, 'the city is read again');
  assert.equal(q(w.box, 'project-city-analysis-error'), null);
  assert.equal(q(w.box, 'project-city-analyze').disabled, false);
});

test('#381 when the run fails the tab shows its error and the action again', async () => {
  const w = await open();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  w.emit({ type: 'workflow.finished', run_id: 'run-1', status: 'failed', error: 'The Oracle refused the analysis: the daily budget is reached.' });
  await settle();
  const error = q(w.box, 'project-city-analysis-error');
  assert.match(text(error), /daily budget/);
  assert.equal(q(w.box, 'project-city-analyzing'), null);
  assert.equal(q(error, 'project-city-analyze').disabled, false, 'Analyze again');
});

test('#381 a run that fails to start shows the error, nothing stuck as running', async () => {
  const w = await open({ startRun: () => { throw new Error('No workflow slot is free.'); } });
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  assert.match(text(q(w.box, 'project-city-analysis-error')), /No workflow slot/);
  assert.equal(q(w.box, 'project-city-analyzing'), null);
});

test('#381 a project map run started elsewhere for this project shows as running too', async () => {
  const w = await open();
  // #631: the analysis run is analyze-project (project-map merged into it)
  w.emit({ type: 'workflow.started', run_id: 'run-9', project_id: 'p1', workflow: 'analyze-project' });
  assert.match(text(q(w.box, 'project-city-analyzing')), /Analyzing this project/);
  w.emit({ type: 'workflow.started', run_id: 'run-10', project_id: 'p2', workflow: 'analyze-project' });
  w.emit({ type: 'step.started', run_id: 'run-10', step_id: 'plan' });
  assert.equal(/cartographer writes the city plan/.test(text(q(w.box, 'project-city-analyzing'))), false, 'another project\'s run is not this one\'s');
  w.emit({ type: 'step.started', run_id: 'run-9', step_id: 'plan' });
  assert.match(text(q(w.box, 'project-city-analyzing')), /cartographer writes the city plan/);
});
