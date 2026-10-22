// #433 characterization of the window's run-event reducer (app.js onEvent) before it is split into a
// pure reducer and its side effects: what each run event does to the run's view (state.runs, the Run
// screen's data) and which side effects a live event has (the toast, the usage reload, the Save to
// issue preview, the active runs sync) while a replay from disk (hydrateRun) has none of them.
// Driven through the page's own seam: the whole page loaded by test/renderer-app-harness.js, the
// events handed to the handlers it registered with window.api.onEvent, as the preload does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('./renderer-app-harness');

const ts = (s) => `2026-09-30T10:00:${String(s).padStart(2, '0')}.000Z`;
const T0 = Date.parse(ts(0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(api = {}) {
  const page = loadApp({ api: { listActiveRuns: async () => [], ...api } });
  await page.boot();
  page.el('#toast').innerHTML = '';
  return page;
}
const fire = (page, ev) => { for (const fn of page.apiHandlers.onEvent || []) fn(ev); };
const toast = (page) => text(page.el('#toast').innerHTML).replace(/^× /, '');
const clearToast = (page) => { page.el('#toast').innerHTML = ''; };

// The run view's observable state, serialised in the page's realm (primitives only cross it).
function view(page, runId) {
  return JSON.parse(page.run(`JSON.stringify((() => {
    const v = state.runs.get(${JSON.stringify(runId)});
    if (!v) return null;
    return {
      run: v.run,
      steps: [...v.steps].map(([id, s]) => [id, s.status, s.visits]),
      sessions: Object.fromEntries([...v.sessions].map(([id, s]) => [id, { ...s, turnLog: [...(s.turnLog || new Map()).values()] }])),
      orchLog: v.orchLog.map((l) => [l.text, l.level]),
      approvals: [...v.approvals.keys()],
      selected: v.selected ?? null,
      preview: v.preview ?? null,
      saveToIssue: !!v.saveToIssue,
      chainLoaded: v.chainLoaded ?? null,
      events: v.events.length,
      lastSeq: v.lastSeq,
      groups: v.groups,
    };
  })())`));
}
const runIds = (page) => JSON.parse(page.run('JSON.stringify([...state.runs.keys()])'));
const orchSince = (page, runId, n) => view(page, runId).orchLog.slice(n);

const started = (runId, seq = 1, extra = {}) => ({
  seq, run_id: runId, ts: ts(0), type: 'workflow.started', workflow: 'fixture', version: '1', mock: true,
  inputs: { task: 'Fix the bug' }, steps: [{ id: 'work' }, { id: 'review' }], groups: [{ id: 'g', steps: ['work'] }], ...extra,
});

// A run waiting at a human gate: started, a session's turn, its step done, the gate asked.
function gateRun(runId) {
  return [
    started(runId),
    { seq: 2, run_id: runId, ts: ts(1), type: 'session.opened', session_id: 's1', session: { agent: 'dev', provider: 'claude', model: 'm', status: 'idle' } },
    { seq: 3, run_id: runId, ts: ts(2), type: 'step.started', step_id: 'work', visit: 1 },
    { seq: 4, run_id: runId, ts: ts(3), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'work', prompt: 'do the work' },
    { seq: 5, run_id: runId, ts: ts(4), type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'text', text: 'working' } },
    { seq: 6, run_id: runId, ts: ts(5), type: 'session.message_received', session_id: 's1', turn: 1, usage: {}, cost_usd: 0.01, duration_ms: 500, session: { status: 'idle' } },
    { seq: 7, run_id: runId, ts: ts(6), type: 'step.finished', step_id: 'work' },
    { seq: 8, run_id: runId, ts: ts(7), type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Merge?' },
  ];
}

test('workflow.started: the run, its steps pending, its groups, its orchestrator line, and it takes the Run screen', async () => {
  const page = await openPage();
  fire(page, started('r1', 1, { issues: [{ number: 7, title: 'Export' }] }));
  const v = view(page, 'r1');
  assert.deepEqual(v.run, {
    id: 'r1', startedAt: T0, mock: true, workflow: 'fixture', version: '1', inputs: { task: 'Fix the bug' },
    issues: [{ number: 7, title: 'Export' }], project: null, projectId: null, agentNames: null, stepNames: null,
    chain: v.run.chain, parentRun: null, childRuns: [], status: 'running', costPerTurn: false,
  });
  assert.deepEqual(v.steps, [['work', 'pending', 0], ['review', 'pending', 0]]);
  assert.deepEqual(v.groups, [{ id: 'g', steps: ['work'] }]);
  assert.deepEqual(v.orchLog, [['workflow "fixture" started (simulation)', '']]);
  assert.equal(v.events, 1);
  assert.equal(page.state().runId, 'r1');
  fire(page, started('r2', 1, { mock: false, cost_accounting: 'per_turn' }));
  assert.equal(view(page, 'r2').run.costPerTurn, true);
  assert.deepEqual(view(page, 'r2').orchLog, [['workflow "fixture" started ', '']]);
  assert.equal(page.state().runId, 'r1', 'a new run does not take the Run screen from a run still going');
});

test('a run\'s steps, sessions and turns follow its events', async () => {
  const page = await openPage();
  for (const ev of gateRun('r1')) fire(page, ev);
  const v = view(page, 'r1');
  assert.deepEqual(v.steps, [['work', 'done', 1], ['review', 'pending', 0]]);
  assert.equal(v.selected, 's1');
  assert.deepEqual(v.sessions.s1, {
    agent: 'dev', provider: 'claude', model: 'm', status: 'idle', localOpenedAt: T0 + 1000, turns_count: 1,
    turnLog: [{ n: 1, items: [{ kind: 'text', text: 'working' }], prompt: 'do the work', result: { usage: {}, cost: 0.01, duration: 500 }, stepId: 'work', startedAt: T0 + 3000 }],
  });
  assert.deepEqual(v.orchLog, [
    ['workflow "fixture" started (simulation)', ''],
    ['session s1 opened: dev (claude · m)', ''],
    ['▶ step work (visit 1)', 'transition'],
    ['→ s1 turn 1 (work)', ''],
    ['← s1 replied in 0s', ''],
    ['? approval requested at review', 'warn'],
  ]);
  assert.deepEqual(v.approvals, ['g1']);
  assert.equal(v.events, 8);
  assert.equal(v.lastSeq, 8);
});

test('session events: status, stream items, provider session, snapshots, the orchestrator session unlogged', async () => {
  const page = await openPage();
  const ev = (seq, e) => fire(page, { seq, run_id: 'r1', ts: ts(seq), ...e });
  fire(page, started('r1', 1, { cost_accounting: 'per_turn' }));
  ev(2, { type: 'session.opened', session_id: 'orchestrator', session: { agent: 'orchestrator', provider: 'x', model: 'y', status: 'idle' } });
  ev(3, { type: 'session.opened', session_id: 's1', session: { agent: 'dev', provider: 'claude', model: 'm', status: 'idle' } });
  ev(4, { type: 'session.status', session_id: 's1', status: 'busy' });
  ev(5, { type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'session', sessionId: 'prov-1' } });
  ev(6, { type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'usage', input: 3 } });
  ev(7, { type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'tool', name: 'Read' } });
  ev(8, { type: 'session.updated', session_id: 's1', session: { note: 'saved', cost_usd: 0.2 } });
  ev(9, { type: 'session.attempt_stopped', session_id: 's1', session: { cost_usd: 0.3 } });
  ev(10, { type: 'session.closed', session_id: 's1', status: 'done', session: { status: 'done' } });
  ev(11, { type: 'session.closed', session_id: 'orchestrator', status: 'done', session: { status: 'done' } });
  ev(12, { type: 'session.status', session_id: 'ghost', status: 'busy' });
  ev(13, { type: 'session.message_received', session_id: 'ghost', turn: 1, duration_ms: 5 });
  const v = view(page, 'r1');
  assert.equal(v.selected, 'orchestrator');
  const s1 = v.sessions.s1;
  assert.equal(s1.status, 'done');
  assert.equal(s1.provider_session_id, 'prov-1');
  assert.equal(s1.note, 'saved');
  assert.equal(s1.cost_usd, 0.3);
  assert.deepEqual(s1.turnLog.map((t) => t.items), [[{ kind: 'tool', name: 'Read' }]]);
  assert.deepEqual(Object.keys(v.sessions), ['orchestrator', 's1']);
  assert.deepEqual(v.orchLog.slice(1), [['session s1 opened: dev (claude · m)', ''], ['session s1 closed (done)', '']]);
  assert.equal(v.events, 13);
});

test('step.waiting, step.goal and step.transition: their orchestrator lines; an unknown step only logs', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  const ev = (seq, e) => fire(page, { seq, run_id: 'r1', ts: ts(seq), ...e });
  ev(2, { type: 'step.waiting', step_id: 'review', interval_ms: 90000 });
  ev(3, { type: 'step.goal', met: false, goal: 'green', iteration: 2 });
  ev(4, { type: 'step.goal', met: true, goal: 'green', iteration: 3 });
  ev(5, { type: 'step.transition', from: 'work', to: 'review', when: 'always' });
  ev(6, { type: 'step.started', step_id: 'nope', visit: 2 });
  ev(7, { type: 'step.finished', step_id: 'nope' });
  const v = view(page, 'r1');
  assert.deepEqual(v.steps, [['work', 'pending', 0], ['review', 'waiting', 0]]);
  assert.deepEqual(v.orchLog.slice(1), [
    ['⏳ review: /loop, next check in 1m30s', ''],
    ['🎯 /goal pending: green (iteration 2)', ''],
    ['🎯 /goal met: green (iteration 3)', 'transition'],
    ['work → review   [always]', 'transition'],
    ['▶ step nope (visit 2)', 'transition'],
  ]);
});

test('events that only write an orchestrator line, with their level', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  const ev = (seq, e) => fire(page, { seq, run_id: 'r1', ts: ts(seq), ...e });
  ev(2, { type: 'action.executed', command: 'npm test', exit_code: 0 });
  ev(3, { type: 'action.executed', command: 'git push', skipped: true });
  ev(4, { type: 'limit.exceeded', limit: 'max_turns' });
  ev(5, { type: 'process.killed', command_line: 'node x' });
  ev(6, { type: 'process.killed', message: 'stopped a big one' });
  ev(7, { type: 'memory.hold', step_id: 'work', waited_ms: 4600, recovered: true });
  ev(8, { type: 'memory.hold', waited_ms: 1000 });
  ev(9, { type: 'file.saved', step_id: 'work', agent: 'dev', path: 'docs/x.md' });
  ev(10, { type: 'budget.exceeded', provider: 'claude', blocked: true });
  ev(11, { type: 'budget.exceeded', provider: 'codex' });
  ev(12, { type: 'decision.logged', agent: 'dev', count: 2, path: 'decisions.md' });
  ev(13, { type: 'log', message: 'hello', level: 'info' });
  ev(14, { type: 'supervisor.started', step_id: 'work' });
  ev(15, { type: 'supervisor.started', step_id: 'work', error: 'tests red' });
  assert.deepEqual(orchSince(page, 'r1', 1), [
    ['$ npm test → exit 0', ''],
    ['$ git push (not executed — simulation)', ''],
    ['limit exceeded: max_turns', 'error'],
    ['memory guard stopped node x', 'warn'],
    ['stopped a big one', 'warn'],
    ['work waited 5 s for memory', 'warn'],
    ['a step waited 1 s for memory (started anyway)', 'warn'],
    ['💾 work (dev) saved to docs/x.md', ''],
    ['💸 claude reached its monthly budget: turn blocked', 'error'],
    ['💸 codex reached its monthly budget (not blocking)', 'warn'],
    ['📝 dev logged 2 decision(s) in decisions.md', ''],
    ['hello', 'info'],
    ['◆ supervisor called on work: step failed', 'supervisor'],
    ['◆ supervisor called on work: tests red', 'supervisor'],
  ]);
});

test('an event type it does not know is kept in the run\'s events and changes nothing else', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  const before = view(page, 'r1');
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'worktree.merged' });
  const after = view(page, 'r1');
  assert.equal(after.events, before.events + 1);
  assert.equal(after.lastSeq, 2);
  assert.deepEqual({ ...after, events: 0, lastSeq: 0 }, { ...before, events: 0, lastSeq: 0 });
});

test('an event whose seq was already applied is ignored; one without seq is always applied', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'log', message: 'once', level: 'info' });
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'log', message: 'once', level: 'info' });
  fire(page, { seq: 1, run_id: 'r1', ts: ts(3), type: 'log', message: 'older', level: 'info' });
  fire(page, { run_id: 'r1', ts: ts(4), type: 'log', message: 'no seq', level: 'info' });
  fire(page, { run_id: 'r1', ts: ts(4), type: 'log', message: 'no seq', level: 'info' });
  assert.deepEqual(orchSince(page, 'r1', 1), [['once', 'info'], ['no seq', 'info'], ['no seq', 'info']]);
  assert.equal(view(page, 'r1').lastSeq, 2);
});

test('pause, chain and child runs on the run', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  const ev = (seq, e) => fire(page, { seq, run_id: 'r1', ts: ts(seq), ...e });
  ev(2, { type: 'run.pausing', step_id: 'work', agents: ['dev'], command: 'pause' });
  assert.deepEqual(view(page, 'r1').run.pause, { state: 'pausing', step: 'work', agents: ['dev'], command: 'pause', at: ts(2) });
  ev(3, { type: 'run.pause_cancelled' });
  assert.equal(view(page, 'r1').run.pause, null);
  ev(4, { type: 'run.then', then: { workflow: 'deploy' } });
  assert.deepEqual(view(page, 'r1').run.chain, { then: { workflow: 'deploy' }, state: 'waiting' });
  ev(5, { type: 'workflow.child_started', child_run_id: 'c1', step_id: 'fan', index: 0, label: 'a', workflow: 'wf' });
  ev(6, { type: 'workflow.child_started', child_run_id: 'c2', step_id: 'fan', index: 1, workflow: 'wf', reused: true });
  ev(7, { type: 'workflow.child_started', child_run_id: 'c1', step_id: 'fan', index: 0, label: 'a', workflow: 'wf', resumed_from: 'old' });
  ev(8, { type: 'workflow.child_finished', child_run_id: 'c1', status: 'failed', label: 'a', error: 'red', cost_usd: 0.5 });
  ev(9, { type: 'workflow.child_finished', status: 'cancelled' });
  ev(10, { type: 'workflow.child_finished', child_run_id: 'c2', status: 'success' });
  assert.deepEqual(view(page, 'r1').run.childRuns, [
    { run_id: 'c2', step_id: 'fan', index: 1, workflow: 'wf', status: 'success', reused: true, cost_usd: 0 },
    { run_id: 'c1', step_id: 'fan', index: 0, label: 'a', workflow: 'wf', status: 'failed', resumed_from: 'old', cost_usd: 0.5 },
  ]);
  assert.deepEqual(orchSince(page, 'r1', 1), [
    ['pausing after the current turn (work)', 'transition'],
    ['pause cancelled: the run goes on', 'transition'],
    ['child run c1 started (wf: a)', 'transition'],
    ['child run c2 reused (wf)', 'transition'],
    ['child run c1 resumed from old (wf: a)', 'transition'],
    ['child run c1 failed (a): red', 'error'],
    ['child run (not started) cancelled', 'error'],
    ['child run c2 success', 'transition'],
  ]);
});

test('the local preview: running, failed when it exits with an error, stopped otherwise', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  const ev = (seq, e) => fire(page, { seq, run_id: 'r1', ts: ts(seq), ...e });
  ev(2, { type: 'local_preview.started', approval_id: 'g1', step_id: 'try', command: 'npm start', dir: 'C:/p', url: 'http://localhost:3000' });
  assert.deepEqual(view(page, 'r1').preview, { status: 'running', approval: 'g1', url: 'http://localhost:3000', command: 'npm start' });
  ev(3, { type: 'local_preview.stopped', approval_id: 'g1', exit_code: 1 });
  assert.deepEqual(view(page, 'r1').preview, { status: 'failed', approval: 'g1', url: 'http://localhost:3000', command: 'npm start', error: 'The app exited with code 1: see its terminal.' });
  ev(4, { type: 'local_preview.stopped', approval_id: 'g2', exit_code: 1, reason: 'gate' });
  assert.deepEqual(view(page, 'r1').preview, { status: 'stopped', approval: 'g2', url: 'http://localhost:3000', command: 'npm start', error: null });
  ev(5, { type: 'local_preview.started', approval_id: 'g3', step_id: 'try', command: 'npm start', dir: 'C:/p' });
  ev(6, { type: 'local_preview.stopped', approval_id: 'g3', exit_code: 0 });
  assert.deepEqual(view(page, 'r1').preview, { status: 'stopped', approval: 'g3', url: null, command: 'npm start', error: null });
  assert.deepEqual(orchSince(page, 'r1', 1), [
    ['local preview started at try: npm start in C:/p', ''],
    ['local preview stopped (exit 1)', ''],
    ['local preview stopped (gate)', ''],
    ['local preview started at try: npm start in C:/p', ''],
    ['local preview stopped (exit 0)', ''],
  ]);
});

test('a gate: asked (a toast when its run is not on screen), then resolved (its wait time, the decision line)', async () => {
  const page = await openPage();
  for (const ev of gateRun('r1')) fire(page, ev);
  assert.equal(toast(page), 'Approval waiting: Fix the bug · fixture Step review. Click to open its run.');
  fire(page, { seq: 9, run_id: 'r1', ts: ts(9), type: 'approval.requested', approval_id: 'g2', step_id: 'review', brief: { headline: 'Tests are red' } });
  assert.equal(toast(page), 'Approval waiting: Fix the bug · fixture Tests are red Click to open its run.');
  fire(page, { seq: 10, run_id: 'r1', ts: ts(10), type: 'approval.resolved', approval_id: 'g1', approved: true, by: 'owner', wait_ms: 1500 });
  fire(page, { seq: 11, run_id: 'r1', ts: ts(11), type: 'approval.resolved', approval_id: 'g2', approved: false, by: 'supervisor' });
  fire(page, { seq: 12, run_id: 'r1', ts: ts(12), type: 'approval.requested', approval_id: 'g3', step_id: 'review' });
  fire(page, { seq: 13, run_id: 'r1', ts: ts(13), type: 'approval.resolved', approval_id: 'g3', choice: 'redo', intent: 'rework', by: 'owner', wait_ms: 500 });
  const v = view(page, 'r1');
  assert.deepEqual(v.approvals, []);
  assert.equal(v.run.gateWaitMs, 2000);
  assert.equal(v.saveToIssue, false);
  assert.deepEqual(v.orchLog.slice(-4), [
    ['approval granted (owner)', 'transition'],
    ['approval denied (supervisor)', 'warn'],
    ['? approval requested at review', 'warn'],
    ['human decision: redo (rework) (owner)', 'transition'],
  ]);
});

test('no gate toast for the run the Run screen shows', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  page.state().view = 'run';
  page.state().runId = 'r1';
  clearToast(page);
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'approval.requested', approval_id: 'g1', step_id: 'review' });
  assert.equal(toast(page), '');
  assert.deepEqual(view(page, 'r1').approvals, ['g1']);
});

test('workflow.finished: the run\'s end, its steps done, its gates cleared, the usage reloaded', async () => {
  const page = await openPage();
  for (const ev of gateRun('r1')) fire(page, ev);
  clearToast(page);
  const usage = page.callsTo('getUsage').length;
  fire(page, { seq: 9, run_id: 'r1', ts: ts(9), type: 'workflow.finished', status: 'failed', error: 'boom', summary: { tested: 'red', tested_failures: ['a.test.js'] } });
  const v = view(page, 'r1');
  assert.equal(v.run.status, 'failed');
  assert.equal(v.run.finishedAt, T0 + 9000);
  assert.equal(v.run.error, 'boom');
  assert.equal(v.run.pause, null);
  assert.equal(v.run.tested, 'red');
  assert.deepEqual(v.run.testedFailures, ['a.test.js']);
  assert.equal(v.chainLoaded, false);
  assert.deepEqual(v.steps, [['work', 'done', 1], ['review', 'pending', 0]]);
  assert.deepEqual(v.approvals, []);
  assert.deepEqual(v.orchLog.at(-1), ['workflow finished: failed — boom', 'error']);
  assert.equal(page.callsTo('getUsage').length, usage + 1);
  assert.equal(toast(page), '', 'no toast when no other run is going');
});

test('workflow.finished: a paused run keeps where it stopped; a success logs as a transition', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'workflow.finished', status: 'paused', paused: { step_id: 'review', agent: 'dev' } });
  assert.deepEqual(view(page, 'r1').run.pause, { state: 'paused', step_id: 'review', agent: 'dev' });
  assert.equal(view(page, 'r1').run.tested, null);
  fire(page, started('r2'));
  fire(page, { seq: 2, run_id: 'r2', ts: ts(2), type: 'workflow.finished', status: 'success' });
  assert.deepEqual(view(page, 'r2').orchLog.at(-1), ['workflow finished: success', 'transition']);
  assert.equal(view(page, 'r2').run.error, null);
});

test('a run ending while another goes: a toast, and the Run screen moves on to the one still going', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  fire(page, started('r2'));
  assert.equal(page.state().runId, 'r1');
  clearToast(page);
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'workflow.finished', status: 'success' });
  assert.equal(toast(page), 'Fix the bug · fixture: Succeeded');
  assert.equal(page.state().runId, 'r2');
});

test('"Accept and save to issue": a run that ends in failure says the issue was not saved', async () => {
  const page = await openPage();
  fire(page, started('r1', 1, { issues: [{ number: 7, title: 'Export' }] }));
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'approval.resolved', approval_id: 'g1', choice: 'accept', intent: 'save_to_issue', by: 'owner' });
  assert.equal(view(page, 'r1').saveToIssue, true);
  clearToast(page);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(3), type: 'workflow.finished', status: 'failed' });
  assert.equal(toast(page), 'Not saved to issue #7 The run ended failed: the document was not accepted.');
  assert.equal(view(page, 'r1').saveToIssue, false);
});

test('"Accept and save to issue": a run that succeeds opens the Save to issue preview', async () => {
  const page = await openPage();
  const opened = [];
  page.sandbox.openDuoSaveToIssue = (arg) => opened.push(JSON.parse(JSON.stringify(arg)));
  fire(page, started('r1', 1, { issues: [{ number: 7, title: 'Export' }], inputs: { task: 'x', document_skill: 'prd' } }));
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'approval.resolved', approval_id: 'g1', choice: 'accept', intent: 'save_to_issue', by: 'owner' });
  fire(page, { seq: 3, run_id: 'r1', ts: ts(3), type: 'workflow.finished', status: 'success' });
  await wait(700);
  assert.deepEqual(opened, [{ runId: 'r1', issue: { number: 7, title: 'Export' }, mock: true, docSkill: 'prd' }]);
});

test('the supervisor\'s decision: its orchestrator line and a toast', async () => {
  const page = await openPage();
  fire(page, started('r1'));
  fire(page, { seq: 2, run_id: 'r1', ts: ts(2), type: 'supervisor.decision', step_id: 'work', action: 'goto', goto: 'plan', cause_class: 'spec', explanation: 'unclear', note: 'n' });
  assert.deepEqual(orchSince(page, 'r1', 1), [['◆ supervisor → goto plan [spec] — unclear (n)', 'supervisor']]);
  assert.match(toast(page), /^◆ Supervisor on "work": .* unclear$/);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(3), type: 'supervisor.decision', step_id: 'work', action: 'retry', explanation: 'flaky' });
  assert.equal(toast(page), '◆ Supervisor on "work": retry the step flaky');
});

test('finished runs beyond eight are forgotten as new runs start, oldest first', async () => {
  const page = await openPage();
  for (let i = 0; i < 10; i++) {
    fire(page, started(`r${i}`));
    fire(page, { seq: 2, run_id: `r${i}`, ts: ts(2), type: 'workflow.finished', status: 'success' });
  }
  assert.deepEqual(runIds(page), ['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']);
});

test('live events: one active-runs sync about a second after a burst', async () => {
  const page = await openPage();
  await wait(1200);
  const before = page.callsTo('listActiveRuns').length;
  for (const ev of gateRun('r1')) fire(page, ev);
  assert.equal(page.callsTo('listActiveRuns').length, before);
  await wait(1200);
  assert.equal(page.callsTo('listActiveRuns').length, before + 1);
});

test('a run first seen mid-way is rebuilt from its recorded events, the same as one followed live', async () => {
  const live = await openPage();
  const events = gateRun('r1');
  for (const ev of [...events, { seq: 9, run_id: 'r1', ts: ts(9), type: 'log', message: 'late', level: 'info' }]) fire(live, ev);
  const page = await openPage({ runEvents: async (runId) => (runId === 'r1' ? events : []) });
  clearToast(page);
  const usage = page.callsTo('getUsage').length;
  fire(page, { seq: 9, run_id: 'r1', ts: ts(9), type: 'log', message: 'late', level: 'info' });
  await page.settle(10);
  const rebuilt = view(page, 'r1');
  const followed = view(live, 'r1');
  assert.deepEqual(rebuilt, followed);
  assert.equal(JSON.stringify(page.callsTo('runEvents')), JSON.stringify([['r1', { activity: true }]]));
  assert.equal(page.state().runId, 'r1');
  assert.equal(page.callsTo('getUsage').length, usage, 'no usage reload for replayed events');
  // the step's display name here (agentLabel), its id in the live toast
  assert.equal(toast(page), 'Approval waiting: Fix the bug · fixture Step Review. Click to open its run.', 'the gate still waiting says so once');
});

test('a replayed run that ended: no toast, no usage reload, no Save to issue preview, no new gate', async () => {
  const recorded = [
    started('r1', 1, { issues: [{ number: 7, title: 'Export' }] }),
    { seq: 2, run_id: 'r1', ts: ts(2), type: 'approval.requested', approval_id: 'g1', step_id: 'review' },
    { seq: 3, run_id: 'r1', ts: ts(3), type: 'approval.resolved', approval_id: 'g1', choice: 'accept', intent: 'save_to_issue', by: 'owner' },
    { seq: 4, run_id: 'r1', ts: ts(4), type: 'supervisor.decision', step_id: 'work', action: 'retry', explanation: 'flaky' },
    { seq: 5, run_id: 'r1', ts: ts(5), type: 'workflow.finished', status: 'failed', error: 'boom' },
  ];
  const page = await openPage({ runEvents: async () => recorded });
  fire(page, started('r0'));
  clearToast(page);
  const usage = page.callsTo('getUsage').length;
  fire(page, { seq: 6, run_id: 'r1', ts: ts(6), type: 'log', message: 'after', level: 'info' });
  await page.settle(10);
  const v = view(page, 'r1');
  assert.equal(v.run.status, 'failed');
  assert.equal(v.saveToIssue, false);
  assert.deepEqual(v.approvals, []);
  assert.deepEqual(v.orchLog.at(-1), ['after', 'info']);
  assert.equal(v.lastSeq, 6);
  assert.equal(toast(page), '');
  assert.equal(page.callsTo('getUsage').length, usage);
  assert.equal(page.state().runId, 'r0', 'a replayed workflow.started does not take the Run screen');
});
