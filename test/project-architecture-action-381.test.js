// #381: the Architecture tab's one action (src/renderer/views/project/project-architecture.js) in a
// mini DOM: "Analyze this project" with its combined estimate (the map's chain estimate plus the
// Oracle's, or "no estimate yet"), a click starts the project map run at once (run:start with mode
// auto and the analysis on, no confirmation), the tab follows the run's events (the step while it
// runs, the city and the report read again when it ends, its error when it fails), a run started
// elsewhere shows the same way, and the old "Map this project" / "Analyze with the Oracle" controls
// are gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const hash = '11'.repeat(20);
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }, { path: 'docs/a.md', lines: 5 }];
const factsModel = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
const PLAN = { version: 1, project: 'fixture', zones: [{ id: 'core', name: 'Core', kind: 'industrial' }], districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['**'] }] };

function loadWindow({ estimate = null, mapEstimate = null, plan = null, startRun = null } = {}) {
  const calls = { startRun: [], city: 0, report: 0 };
  const listeners = [];
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: factsModel(), exclude: [], gate: [] }),
    architectureReport: async () => { calls.report++; return { report: null, findings: [], gone: [], runsSince: 0 }; },
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
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER, 'views', 'project', f), 'utf8'), sandbox, { filename: f });
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

test('#381 one action, "Analyze this project", with the combined estimate of the map and the Oracle\'s turn', async () => {
  const w = loadWindow({ estimate: { usd: 0.4, basis: 3 }, mapEstimate: { items: [{ basis: 2, costUsd: 0.25, minutes: 3 }] } });
  w.PA.show('p1', w.box);
  await settle();
  const button = q(w.box, 'architecture-analyze');
  assert.match(text(button), /Analyze this project/);
  assert.match(text(q(w.box, 'architecture-estimate')), /≈ US\$ 0\.65/, 'the map plus the Oracle');
  assert.match(button.title, /simulations only/);
  for (const gone of ['architecture-map', 'architecture-map-confirm']) assert.equal(q(w.box, gone), null, `${gone} is gone`);
  assert.equal(text(w.box).includes('Analyze with the Oracle'), false);
  assert.equal(text(w.box).includes('Map this project'), false);
});

test('#381 no estimate yet: the button says so, and still starts the run', async () => {
  const w = loadWindow();
  w.PA.show('p1', w.box);
  await settle();
  assert.match(text(q(w.box, 'architecture-estimate')), /no estimate yet/);
  assert.match(q(w.box, 'architecture-analyze').title, /first real run shows its cost/);
  w.click(q(w.box, 'architecture-analyze'));
  await settle();
  assert.equal(w.calls.startRun.length, 1);
});

test('#381 a click starts the project map run at once: mode auto, the analysis on, the project\'s folder; then the tab shows it running', async () => {
  const w = loadWindow();
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'architecture-analyze'));
  await settle();
  const [spec] = w.calls.startRun;
  assert.equal(spec.file, 'project-map.yaml');
  assert.deepEqual(JSON.parse(JSON.stringify(spec.inputs)), { repo_path: 'C:/fixture', project_id: 'p1', mode: 'auto', analyze: true }); // the sandbox's object, compared by value
  assert.equal(spec.mock, true, 'a simulation in a simulation-only app');
  assert.equal(spec.projectId, 'p1');
  assert.equal(q(w.box, 'architecture-map-confirm'), null, 'no confirmation');
  assert.match(text(q(w.box, 'architecture-analyzing')), /Analyzing this project/);
  assert.equal(q(w.box, 'architecture-analyze').disabled, true);
  w.emit({ type: 'step.started', run_id: 'run-1', step_id: 'plan' });
  assert.match(text(q(w.box, 'architecture-analyzing')), /cartographer writes the city plan/);
  w.emit({ type: 'step.started', run_id: 'run-1', step_id: 'analyze' });
  assert.match(text(q(w.box, 'architecture-analyzing')), /Oracle analyses the hotspots/);
  w.emit({ type: 'step.started', run_id: 'other', step_id: 'facts' });
  assert.match(text(q(w.box, 'architecture-analyzing')), /Oracle analyses the hotspots/, 'another run\'s events are not this one\'s');
});

test('#381 when the run ends with success the tab reads the city and the report again and shows no running state', async () => {
  const w = loadWindow();
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'architecture-analyze'));
  await settle();
  const before = { city: w.calls.city, report: w.calls.report };
  w.emit({ type: 'workflow.finished', run_id: 'run-1', status: 'success' });
  await settle();
  assert.equal(q(w.box, 'architecture-analyzing'), null, 'not shown as running once finished');
  assert.ok(w.calls.city > before.city && w.calls.report > before.report, 'the city and the report are read again');
  assert.equal(q(w.box, 'architecture-state-error'), null);
  assert.equal(q(w.box, 'architecture-analyze').disabled, false);
});

test('#381 when the run fails the tab shows its error and the action again', async () => {
  const w = loadWindow();
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'architecture-analyze'));
  await settle();
  w.emit({ type: 'workflow.finished', run_id: 'run-1', status: 'failed', error: 'The Oracle refused the analysis: the daily budget is reached.' });
  await settle();
  assert.match(text(q(w.box, 'architecture-state-error')), /daily budget/);
  assert.equal(q(w.box, 'architecture-analyzing'), null);
  assert.equal(q(w.box, 'architecture-analyze').disabled, false);
});

test('#381 a run that fails to start shows the error, nothing stuck as running', async () => {
  const w = loadWindow({ startRun: () => { throw new Error('No workflow slot is free.'); } });
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'architecture-analyze'));
  await settle();
  assert.match(text(q(w.box, 'architecture-state-error')), /No workflow slot/);
  assert.equal(q(w.box, 'architecture-analyzing'), null);
});

test('#381 a project map run started elsewhere for this project shows as running too', async () => {
  const w = loadWindow();
  w.PA.show('p1', w.box);
  await settle();
  w.emit({ type: 'workflow.started', run_id: 'run-9', project_id: 'p1', workflow: 'project-map' });
  assert.match(text(q(w.box, 'architecture-analyzing')), /Analyzing this project/);
  w.emit({ type: 'workflow.started', run_id: 'run-10', project_id: 'p2', workflow: 'project-map' });
  assert.match(q(w.box, 'architecture-analyzing').title, /run-9/, 'another project\'s run is not this one\'s');
});

test('#381 the City view gets the same action and the same state', async () => {
  const w = loadWindow({ estimate: { usd: 0.4, basis: 3 } });
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'architecture-mode-city'));
  await settle();
  const note = q(w.box, 'project-city-no-plan');
  assert.match(text(note), /Analyze this project.*≈ US\$ 0\.40/);
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  assert.equal(w.calls.startRun.length, 1, 'the city\'s button starts the same run');
  assert.match(text(q(w.box, 'project-city-analyzing')), /Analyzing this project/);
});
