// src/renderer/app.js: the Run screen rebuilt from disk after a reload or a window reopened mid-run
// (#74). onEvent is the live reducer; hydrateRun replays a run's recorded events through the same
// onEvent, deduplicated by `seq`, then applies any live events that arrived meanwhile. It runs only
// inside the Electron renderer (document, window.api), so these pure/async pieces are pulled out of
// the source and evaluated in a sandbox, the way test/renderer-run-view.test.js checks app.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RunProgress = require('@multiagent/shared/run-progress-model');
const RunBadges = require('../src/renderer/run-badges');
const ChainModel = require('@multiagent/shared/chain-model'); // #134: runInfo reads a run's chain through it
const RunRecord = require('@multiagent/shared/run-record'); // #350: onEvent upgrades a past run's events through it
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

// run titles, issues and PRs moved into run-meta.js: both files are searched
const src = ['app.js', 'run-meta.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8')).join('\n');
const supSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'supervisor-drawer.js'), 'utf8');

const PATTERNS = {
  fmtDur: /function fmtDur\(ms\) \{[\s\S]*?\n\}/,
  isRunLive: /const isRunLive = [^\n]+;/,
  liveRuns: /const liveRuns = [^\n]+;/,
  issuesOfRun: /const issuesOfRun = [^\n]+;/,
  issueRefs: /const issueRefs = [^\n]+;/,
  runMetaOf: /const runMetaOf = [^\n]+;/,
  runTitle: /const runTitle = [^\n]+;/,
  runPr: /const runPr = \(r\) => [^\n]+;/,
  runLabel: /const runLabel = \(r\) => \{[\s\S]*?\n\};/,
  statusLabel: /const statusLabel = [^\n]+;/,
  agentLabel: /const agentLabel = [^\n]+;/, // readable step names in gate toasts (#245)
  newRunView: /const newRunView = \(\) => \(\{[\s\S]*?\n\}\);/,
  getTurn: /function getTurn\(sess, n\) \{[\s\S]*?\n\}/,
  viewOf: /function viewOf\(ev\) \{[\s\S]*?\n\}/,
  runInfo: /function runInfo\(x\) \{[\s\S]*?\n\}/,
  pruneRuns: /function pruneRuns\(\) \{[\s\S]*?\n\}/,
  hydrateBlock: /const hydrating = new Map\(\);[\s\S]*?\nasync function hydrateRun\(runId\) \{[\s\S]*?\n\}/,
  onEvent: /function onEvent\(ev\) \{[\s\S]*?\n\}/,
  // onEvent's helpers (#368: the run's pause; the supervisor's decision)
  onSupervisorDecision: /function onSupervisorDecision\(v, ev\) \{[\s\S]*?\n\}/,
  onPauseEvent: /function onPauseEvent\(v, ev\) \{[\s\S]*?\n\}/,
  finishedPause: /const finishedPause = [^\n]+;/,
  orch: /function orch\(ev, text, level = ''\) \{[\s\S]*?\n\}/,
  PROJECT_REFRESH_EVENTS: /const PROJECT_REFRESH_EVENTS = new Set\(\[[^\]]+\]\);/,
  RUN_ROW_EVENTS: /const RUN_ROW_EVENTS = new Set\(\[[^\]]+\]\);/,
  ARTIFACT_EVENTS: /const ARTIFACT_EVENTS = new Set\(\[[^\]]+\]\);/,
  SUP_ACTIONS: /const SUP_ACTIONS = \{[^\n]+\};/,
  openPastRun: /async function openPastRun\(runId\) \{[\s\S]*?\n\}/,
};

function loadHelpers({ api = {}, view = 'dashboard' } = {}) {
  const code = {};
  for (const [name, re] of Object.entries(PATTERNS)) {
    const m = re.exec(name === 'SUP_ACTIONS' ? supSrc : src);
    assert.ok(m, `${name} not found in ${name === 'SUP_ACTIONS' ? 'supervisor-drawer.js' : 'app.js or run-meta.js'}: the source moved`);
    code[name] = m[0];
  }
  const calls = { showToast: [], loadUsage: 0, loadUsageThrottled: 0, loadActiveRuns: 0, showView: [], showRunInList: [] };
  const sandbox = {
    state: { runs: new Map(), runId: null, runMeta: new Map(), projects: [], view },
    api,
    console,
    setTimeout,
    clearTimeout,
    RunProgress,
    RunBadges,
    ChainModel,
    RunRecord,
    showToast: (...args) => calls.showToast.push(args),
    loadUsage: () => { calls.loadUsage += 1; },
    loadUsageThrottled: () => { calls.loadUsageThrottled += 1; },
    loadProjectRunsThrottled: () => {},
    loadWorkflowRunsThrottled: () => {},
    loadArtifactsThrottled: () => {},
    refreshUnpushed: () => {},
    renderRunListsSoon: () => {},
    refreshRunRow: () => {}, // its own seam: src/renderer/run-list.js, a global in the renderer
    scheduleRender: () => {},
    scheduleActiveSync: () => {},
    reportNotifyContext: () => {},
    loadActiveRuns: () => { calls.loadActiveRuns += 1; return Promise.resolve(); },
    showView: (v) => calls.showView.push(v),
    showRunInList: (id) => calls.showRunInList.push(id),
    paintGateApps: () => {},
    ArtifactsPanel: { refreshRun: () => {} }, // its own seam: test/artifacts-panel.test.js
  };
  sandbox.window = sandbox;
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(
    Object.values(code).join('\n')
    + '\nthis.helpers = { onEvent, hydrateRun, newRunView, viewOf, runLabel, openPastRun };',
    sandbox,
  );
  return { helpers: sandbox.helpers, calls, state: sandbox.state };
}

// A workflow.started..step.finished..approval.requested sequence (`seq` as the engine assigns it),
// its gate left pending (no approval.resolved): a run still waiting at a human gate.
function fixtureEvents(runId) {
  const ts = (s) => `2026-09-30T10:00:${String(s).padStart(2, '0')}.000Z`;
  return [
    { seq: 1, run_id: runId, ts: ts(0), type: 'workflow.started', workflow: 'fixture', version: '1', mock: true, inputs: { task: 'Fix the bug' }, steps: [{ id: 'work' }, { id: 'review' }], groups: [] },
    { seq: 2, run_id: runId, ts: ts(1), type: 'session.opened', session_id: 's1', session: { agent: 'dev', provider: 'claude', model: 'm', status: 'idle' } },
    { seq: 3, run_id: runId, ts: ts(2), type: 'step.started', step_id: 'work', visit: 1 },
    { seq: 4, run_id: runId, ts: ts(3), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'work', prompt: 'do the work' },
    { seq: 5, run_id: runId, ts: ts(4), type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'text', text: 'working' } },
    { seq: 6, run_id: runId, ts: ts(5), type: 'session.message_received', session_id: 's1', turn: 1, usage: {}, cost_usd: 0.01, duration_ms: 500, session: { status: 'idle' } },
    { seq: 7, run_id: runId, ts: ts(6), type: 'step.finished', step_id: 'work' },
    { seq: 8, run_id: runId, ts: ts(7), type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Merge?' },
  ];
}

// A snapshot of a run view's observable state, ignoring bookkeeping fields (lastSeq, past) that
// legitimately differ between how a view was built. JSON round-tripped: values built in the vm
// sandbox are plain objects/arrays of a different realm, not reference-equal to the host's.
function snapshot(v) {
  return JSON.parse(JSON.stringify({
    run: v.run,
    steps: [...v.steps.entries()].map(([id, s]) => [id, s.status, s.visits]),
    sessions: [...v.sessions.entries()].map(([id, s]) => [id, s.status]),
    orchLogLength: v.orchLog.length,
    approvals: [...v.approvals.keys()],
  }));
}

test('a run replayed from disk (hydrateRun) ends up in the same state as one built live, event by event', async () => {
  const live = loadHelpers();
  const runId = 'r1';
  live.state.runs.set(runId, live.helpers.newRunView());
  for (const ev of fixtureEvents(runId)) live.helpers.onEvent(ev);

  const replayed = loadHelpers({ api: { runEvents: async () => fixtureEvents(runId) } });
  replayed.state.runs.set(runId, replayed.helpers.newRunView());
  await replayed.helpers.hydrateRun(runId);

  assert.deepEqual(snapshot(replayed.state.runs.get(runId)), snapshot(live.state.runs.get(runId)));
});

test('hydrateRun: no toast or usage reload while replaying; one toast per gate still pending for a run not shown', async () => {
  const { helpers, calls, state } = loadHelpers({ api: { runEvents: async () => fixtureEvents('r1') } });
  state.runs.set('r1', helpers.newRunView());
  await helpers.hydrateRun('r1');
  assert.equal(calls.loadUsage, 0);
  assert.equal(calls.loadUsageThrottled, 0);
  assert.equal(calls.showToast.length, 1);
  assert.match(calls.showToast[0][0], /Approval waiting/);
  assert.match(calls.showToast[0][1], /review/);
});

test('hydrateRun: no gate toast for the run currently shown in the Run screen', async () => {
  const { helpers, calls, state } = loadHelpers({ api: { runEvents: async () => fixtureEvents('r1') }, view: 'run' });
  state.runs.set('r1', helpers.newRunView());
  state.runId = 'r1';
  await helpers.hydrateRun('r1');
  assert.equal(calls.showToast.length, 0);
});

test('onEvent: a live event whose seq was already replayed is ignored (no duplicate, no status change)', async () => {
  const { helpers, state } = loadHelpers({ api: { runEvents: async () => fixtureEvents('r1') } });
  state.runs.set('r1', helpers.newRunView());
  await helpers.hydrateRun('r1');
  const v = state.runs.get('r1');
  const before = snapshot(v);
  const eventsBefore = v.events.length;
  helpers.onEvent({ seq: 3, run_id: 'r1', type: 'step.started', step_id: 'work', visit: 1 }); // already replayed
  assert.equal(v.events.length, eventsBefore);
  assert.deepEqual(snapshot(v), before);
});

test('hydrateRun: a live event that arrives while the recorded events are still being read is applied after them, in order', async () => {
  let resolveRead;
  const api = { runEvents: () => new Promise((resolve) => { resolveRead = resolve; }) };
  const { helpers, state } = loadHelpers({ api });
  state.runs.set('r2', helpers.newRunView());
  const p = helpers.hydrateRun('r2');
  // the run view exists (viewOf created it on the first live event), so this one buffers until the read resolves
  helpers.onEvent({ seq: 9, run_id: 'r2', ts: '2026-09-30T10:00:08.000Z', type: 'step.started', step_id: 'review', visit: 2 });
  resolveRead(fixtureEvents('r2'));
  await p;
  const v = state.runs.get('r2');
  assert.deepEqual([...v.events.map((e) => e.seq)], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(v.steps.get('review')?.status, 'running');
  assert.equal(v.lastSeq, 9);
});

// #233: a run recorded before per-turn costs (no cost_accounting on workflow.started): its resumed
// Claude turns stored the CLI session's running total, and its stopped attempts have no cost.
function pastCostEvents(runId, failure, workflowStarted = {}) {
  const ts = (s) => `2026-09-30T10:00:${String(s).padStart(2, '0')}.000Z`;
  const snap = (cost) => ({ agent: 'developer', provider: 'claude', model: 'm', status: 'idle', provider_session_id: 'cli-1', cost_usd: cost });
  return [
    { seq: 1, run_id: runId, ts: ts(0), type: 'workflow.started', workflow: 'fixture', version: '1', mock: false, inputs: { task: 'x' }, steps: [{ id: 'plan' }, { id: 'implement' }], groups: [], ...workflowStarted },
    { seq: 2, run_id: runId, ts: ts(1), type: 'session.opened', session_id: 's1', session: snap(0) },
    { seq: 3, run_id: runId, ts: ts(2), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'plan', prompt: 'plan' },
    { seq: 4, run_id: runId, ts: ts(3), type: 'session.message_received', session_id: 's1', turn: 1, usage: {}, cost_usd: 3.21, duration_ms: 500, session: snap(3.21) },
    { seq: 5, run_id: runId, ts: ts(4), type: 'session.message_sent', session_id: 's1', turn: 2, step_id: 'implement', prompt: 'implement' },
    { seq: 6, run_id: runId, ts: ts(5), type: 'session.message_received', session_id: 's1', turn: 2, usage: {}, cost_usd: 3.56, duration_ms: 500, session: snap(6.77) },
    { seq: 7, run_id: runId, ts: ts(6), type: 'log', level: 'error', message: `[developer] attempt 1/2 failed: ${failure}` },
  ];
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('onEvent (#233): a past run\'s resumed Claude turn costs its own part and the session reads the CLI\'s last total', () => {
  const { helpers, state } = loadHelpers();
  state.runs.set('r1', helpers.newRunView());
  for (const ev of pastCostEvents('r1', 'Command "claude" not found in PATH.')) helpers.onEvent(ev);
  const s = JSON.parse(JSON.stringify({ ...state.runs.get('r1').sessions.get('s1'), turnLog: undefined }));
  const turns = state.runs.get('r1').sessions.get('s1').turnLog;
  near(turns.get(1).result.cost, 3.21);
  near(turns.get(2).result.cost, 0.35);
  near(s.cost_usd, 3.56);
  assert.ok(!s.costNotRecorded, 'an attempt that failed before the CLI ran cost nothing');
});

test('onEvent (#233): a past run\'s attempt stopped by a timeout marks its agent\'s cost as not recorded', () => {
  const { helpers, state } = loadHelpers();
  state.runs.set('r1', helpers.newRunView());
  for (const ev of pastCostEvents('r1', 'Timed out after 1800s')) helpers.onEvent(ev);
  assert.equal(state.runs.get('r1').sessions.get('s1').costNotRecorded, true);
});

test('onEvent (#233): a run recorded with per-turn costs is read as recorded', () => {
  const { helpers, state } = loadHelpers();
  state.runs.set('r1', helpers.newRunView());
  for (const ev of pastCostEvents('r1', 'Timed out after 1800s (US$ 0.10, estimated from 3 model calls)', { cost_accounting: 'per_turn' })) helpers.onEvent(ev);
  const sess = state.runs.get('r1').sessions.get('s1');
  near(sess.turnLog.get(2).result.cost, 3.56);
  near(sess.cost_usd, 6.77);
  assert.ok(!sess.costNotRecorded, 'its stopped attempts have their own events');
});

test('openPastRun: a finished run becomes the selected view, read-only, with no approvals left pending', async () => {
  const events = [...fixtureEvents('r1'), { seq: 9, run_id: 'r1', ts: '2026-09-30T10:00:08.000Z', type: 'workflow.finished', status: 'success' }];
  const { helpers, state } = loadHelpers({ api: { runEvents: async () => events, listActiveRuns: async () => [] } });
  await helpers.openPastRun('r1');
  assert.equal(state.runId, 'r1');
  const v = state.runs.get('r1');
  assert.equal(v.past, true);
  assert.equal(v.run.status, 'success');
  assert.deepEqual([...v.approvals.keys()], []);
});

test('openPastRun: a run still "running" on disk but not in runs:active becomes interrupted', async () => {
  const { helpers, state } = loadHelpers({ api: { runEvents: async () => fixtureEvents('r1'), listActiveRuns: async () => [] } });
  await helpers.openPastRun('r1');
  const v = state.runs.get('r1');
  assert.equal(v.run.status, 'interrupted');
  assert.deepEqual([...v.approvals.keys()], []);
});

test('openPastRun: a run with nothing recorded falls back to the runs list instead of a blank Run screen', async () => {
  const { helpers, calls, state } = loadHelpers({ api: { runEvents: async () => [], listActiveRuns: async () => [] } });
  await helpers.openPastRun('ghost');
  assert.equal(state.runs.has('ghost'), false);
  assert.deepEqual(calls.showRunInList, ['ghost']);
});
