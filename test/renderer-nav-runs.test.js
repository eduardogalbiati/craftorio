// src/renderer/app.js: the sidebar's Run item and the runs listed under it (renderNavRuns,
// navRunsList, navRunState) for #113 (list a run even when it's the only one) and #142 (the
// Run item's dot/tooltip reflect what is in progress, not the run shown in the top bar). It
// runs only inside the Electron renderer (document, window.api), so these pure/painting helpers
// are pulled out of the source and evaluated in a sandbox with a minimal fake DOM, the way
// test/artifacts-toggle.test.js checks views/artifacts/artifacts.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RunBadges = require('../src/renderer/run-badges');

// run titles, issues and PRs moved into run-meta.js: both files are searched
const src = ['app.js', 'run-meta.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8')).join('\n');

function extract(name, re) {
  const m = re.exec(src);
  assert.ok(m, `${name} not found in app.js or run-meta.js: the source moved`);
  return m[0];
}

// A status-dot badge (#nav-run-gates, #nav-run-count): classList.toggle('hidden', ...), textContent, title.
function fakeBadge() {
  const classes = new Set();
  return {
    classList: { toggle: (c, force) => (force ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    textContent: '',
    title: '',
  };
}

// #nav-run: a plain className/title string, as renderNavRuns writes it directly (no classList.toggle).
function fakeNavRunItem() {
  return { className: '', title: '' };
}

// #nav-runs: innerHTML kept as a plain string, counting writes to prove the dataset.html guard
// skips a rewrite when the rendered markup did not change.
function fakeRunsBox() {
  let html = '';
  let writes = 0;
  const classes = new Set();
  return {
    dataset: {},
    classList: { toggle: (c, force) => (force ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; writes += 1; },
    querySelectorAll: () => [],
    get writes() { return writes; },
  };
}

function load() {
  const body = [
    extract('$', /const \$ = \(sel\) => document\.querySelector\(sel\);/),
    extract('esc', /const esc = \(s\) => [^\n]+/),
    extract('issuesOfRun', /const issuesOfRun = [^\n]+/),
    extract('issueRefs', /const issueRefs = [^\n]+/),
    extract('runMetaOf', /const runMetaOf = [^\n]+/),
    extract('runTitle', /const runTitle = [^\n]+/),
    extract('runPr', /const runPr = [^\n]+/),
    extract('runLabel', /const runLabel = \(r\) => \{[\s\S]*?\n\};/),
    extract('prAsked', /const prAsked = [^\n]+/),
    extract('askPrStates', /function askPrStates\(list\) \{[\s\S]*?\n\}/),
    extract('prBadge', /const prBadge = [^\n]+/),
    extract('runSessionStatus', /const runSessionStatus = [^\n]+/),
    extract('statusLabel', /const statusLabel = [^\n]+/),
    extract('pendingGates', /const pendingGates = [^\n]+/),
    extract('navRunsList', /const navRunsList = [^\n]+/),
    extract('navRunState', /function navRunState\(list\) \{[\s\S]*?\n\}/),
    extract('renderNavRuns', /function renderNavRuns\(\) \{[\s\S]*?\n\}/),
  ].join('\n');

  const gates = fakeBadge();
  const item = fakeNavRunItem();
  const count = fakeBadge();
  const box = fakeRunsBox();
  const state = { runs: new Map(), runId: null, runMeta: new Map(), run: null, view: 'dashboard' };
  const sandbox = {
    state,
    api: {},
    RunBadges,
    StatusPill: require('../src/renderer/status-pill.js'), // the real readable statuses (#266)
    document: {
      querySelector: (sel) => ({
        '#nav-run-gates': gates,
        '#nav-run': item,
        '#nav-run-count': count,
        '#nav-runs': box,
      }[sel] || null),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${body}\nthis.helpers = { navRunsList, navRunState, renderNavRuns, statusLabel };`, sandbox);
  return { ...sandbox.helpers, state, elements: { gates, item, count, box } };
}

// A run list item: the engine's run plus its gates/steps, as state.runs stores them.
function runView(run, { approvals = new Map(), steps = new Map() } = {}) {
  return { run, approvals, steps };
}

function makeRun(overrides = {}) {
  return { id: 'r1', status: 'running', workflow: 'software-development.yaml', project: 'demo', startedAt: Date.now(), ...overrides };
}

// ---- navRunsList (#113) ----------------------------------------------------------------------

test('navRunsList: running, failed and interrupted runs, and any run waiting at a gate, are listed; a finished run is not, even if selected', () => {
  const { navRunsList, state } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'success' })));
  state.runs.set('r2', runView(makeRun({ id: 'r2', status: 'running' })));
  state.runs.set('r3', runView(makeRun({ id: 'r3', status: 'failed' })));
  state.runs.set('r4', runView(makeRun({ id: 'r4', status: 'interrupted' })));
  state.runs.set('r5', runView(makeRun({ id: 'r5', status: 'success' }), { approvals: new Map([['a1', { step_id: 's' }]]) }));
  state.runId = 'r1'; // selected, but finished: still excluded
  assert.deepEqual(Array.from(navRunsList(), (v) => v.run.id), ['r2', 'r3', 'r4', 'r5']);
});

// ---- navRunState (#142) ----------------------------------------------------------------------

// navRunState runs inside the vm sandbox: its return value is a plain object of that realm, so
// compare its fields instead of deep-equalling the object itself (a cross-realm false mismatch).
function navStateOf(navRunState, list) {
  const { status, title } = navRunState(list);
  return { status, title };
}

test('navRunState: idle with nothing listed, a gate wins over running, which wins over failed/interrupted', () => {
  const { navRunState } = load();
  assert.deepEqual(navStateOf(navRunState, []), { status: 'idle', title: 'No run in progress' });

  const running = [runView(makeRun({ status: 'running' }))];
  assert.deepEqual(navStateOf(navRunState, running), { status: 'active', title: '1 run in progress' });

  const failed = [runView(makeRun({ status: 'failed' }))];
  assert.deepEqual(navStateOf(navRunState, failed), { status: 'failed', title: '1 run failed or interrupted: open it to resume' });

  const waiting = [runView(makeRun({ status: 'success' }), { approvals: new Map([['a1', {}]]) })];
  assert.deepEqual(navStateOf(navRunState, waiting), { status: 'waiting', title: '1 run waiting for you' });

  const mixed = [
    runView(makeRun({ id: 'r1', status: 'running' })),
    runView(makeRun({ id: 'r2', status: 'success' }), { approvals: new Map([['a1', {}]]) }),
  ];
  assert.deepEqual(navStateOf(navRunState, mixed), { status: 'waiting', title: '1 run waiting for you' }, 'a waiting gate wins even with a run also running');
});

// ---- renderNavRuns (#113 + #142) -----------------------------------------------------------

test('renderNavRuns: one running run renders one row with its title, issues, workflow label and running step; the Run item turns active', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(
    makeRun({ id: 'r1', status: 'running', workflow: 'software-development.yaml', issues: [{ number: 74 }, { number: 84 }] }),
    { steps: new Map([['build', { status: 'running' }]]) },
  ));
  state.runMeta.set('r1', { title: 'Fix the login bug' });

  renderNavRuns();

  assert.equal(elements.box.classList.contains('hidden'), false);
  assert.match(elements.box.innerHTML, /class="nav-run-item st-active" data-run="r1"/);
  assert.match(elements.box.innerHTML, /nav-run-title">Fix the login bug</);
  assert.match(elements.box.innerHTML, /nav-run-issues">#74, #84</);
  assert.match(elements.box.innerHTML, /nav-run-wf">software-development</, 'the workflow label drops the .yaml extension');
  assert.match(elements.box.innerHTML, /nav-run-at">build</);
  assert.match(elements.item.className, /\bst-active\b/);
  assert.equal(elements.count.classList.contains('hidden'), true, 'a single run: no count badge');
});

test('renderNavRuns: a running run with no step marked running yet shows "starting"', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'running' })));
  renderNavRuns();
  assert.match(elements.box.innerHTML, /nav-run-at">starting</);
});

test('renderNavRuns: zero runs hides and clears the list, and the Run item reads idle', () => {
  const { renderNavRuns, elements } = load();
  renderNavRuns();
  assert.equal(elements.box.classList.contains('hidden'), true);
  assert.equal(elements.box.innerHTML, '');
  assert.match(elements.item.className, /\bst-idle\b/);
  assert.equal(elements.item.title, 'No run in progress');
});

test('renderNavRuns: only a finished, successful run (even selected) also hides the list and reads idle', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'success' })));
  state.runId = 'r1';
  renderNavRuns();
  assert.equal(elements.box.classList.contains('hidden'), true);
  assert.equal(elements.item.title, 'No run in progress');
});

test('renderNavRuns: a failed run stays listed with st-failed, and the Run item summarises it', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'failed' })));
  renderNavRuns();
  assert.match(elements.box.innerHTML, /nav-run-item st-failed/);
  assert.match(elements.box.innerHTML, /nav-run-at">Failed</);
  assert.equal(elements.item.title, '1 run failed or interrupted: open it to resume');
});

test('renderNavRuns: a run waiting at a gate shows "Waiting for you · <step>", turns the Run item st-waiting and fills the gates badge', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(
    makeRun({ id: 'r1', status: 'running' }),
    { approvals: new Map([['a1', { run_id: 'r1', approval_id: 'a1', step_id: 'review' }]]) },
  ));
  renderNavRuns();
  assert.match(elements.box.innerHTML, /nav-run-at">Waiting for you · review</);
  assert.match(elements.item.className, /\bst-waiting\b/);
  assert.equal(elements.gates.classList.contains('hidden'), false);
  assert.equal(elements.gates.textContent, '1');
});

test('renderNavRuns: several listed runs show a count badge, and the selected run is highlighted', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'running' })));
  state.runs.set('r2', runView(makeRun({ id: 'r2', status: 'failed' })));
  state.runId = 'r2';
  renderNavRuns();
  assert.equal(elements.count.classList.contains('hidden'), false);
  assert.equal(elements.count.textContent, '2');
  assert.match(elements.box.innerHTML, /class="nav-run-item st-failed selected" data-run="r2"/);
  assert.doesNotMatch(elements.box.innerHTML, /class="nav-run-item st-active selected"/, 'only the selected row carries it');
});

test('renderNavRuns: re-rendering unchanged content does not rewrite innerHTML (dataset.html guard)', () => {
  const { renderNavRuns, state, elements } = load();
  state.runs.set('r1', runView(makeRun({ id: 'r1', status: 'running' })));
  renderNavRuns();
  const writesAfterFirst = elements.box.writes;
  renderNavRuns();
  assert.equal(elements.box.writes, writesAfterFirst, 'the same list and gates render the same markup: no innerHTML write');

  state.runs.set('r2', runView(makeRun({ id: 'r2', status: 'failed' })));
  renderNavRuns();
  assert.equal(elements.box.writes, writesAfterFirst + 1, 'a changed list does rewrite it');
});

// ---- #142: the top-bar pill is decoupled from the sidebar dot ------------------------------

test('statusLabel: a finished run still reads as ended, "Succeeded" (#266: the top-bar pill), while the sidebar dot for the same selected run stays idle', () => {
  const { renderNavRuns, statusLabel, state, elements } = load();
  const run = makeRun({ id: 'r1', status: 'success' });
  assert.equal(statusLabel(run), 'Succeeded');

  state.runs.set('r1', runView(run));
  state.runId = 'r1';
  renderNavRuns();
  assert.match(elements.item.className, /\bst-idle\b/);
  assert.equal(elements.item.title, 'No run in progress');
});
