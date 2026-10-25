// apps/desktop/renderer/run3d-model.js: the run's 3D view as a pure model. A recorded sequence of the
// engine's raw events in (the shapes runs:events and run:event carry), the floor, the robots' states,
// the cart's position, the KPIs and the gates out.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/run3d-model');

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

// A software-development-like run: develop (developer), code_review (two reviewers), a human gate in
// a group (approve_merge, on the main path), a failure gate (test_failed), an engine suite step.
const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'code_review', type: 'agent', agent: 'reviewer · security_reviewer' },
  { id: 'test', type: 'agent', agent: 'test_writer' },
  { id: 'suite', type: 'suite', agent: null },
  { id: 'test_failed', type: 'human_approval', agent: null },
  { id: 'approve_merge', type: 'human_approval', agent: null },
];
let seq = 0;
const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: at(s), run_id: 'run-1', type, ...fields });
function started(extra = {}) {
  seq = 0;
  return [
    ev(0, 'workflow.started', {
      workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Add a /health endpoint', mode: 'validated' },
      issues: [{ number: 12, title: 'Health endpoint' }], steps: STEPS, groups: [{ name: 'Develop', steps: ['develop'] }, { name: 'Review', steps: ['code_review'] }],
      display: { steps: { code_review: 'Code review' } }, ...extra,
    }),
    ev(0, 'session.opened', { session_id: 'orc', session: { agent: 'orchestrator', provider: 'engine' } }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-test', session: { agent: 'test_writer', provider: 'codex', model: 'gpt-6' } }),
  ];
}
const model = (events, opts = { mainGates: ['approve_merge'] }) => {
  const m = new M.Run3DModel(opts);
  m.applyAll(events);
  return m;
};

test('the floor: one station per step in workflow order, a gate of the main path drawn, a failure gate only once reached', () => {
  const m = model(started());
  const L = m.layout();
  assert.deepEqual(L.stations.map((s) => [s.id, s.kind]), [
    ['develop', 'agent'], ['code_review', 'agent'], ['test', 'agent'], ['suite', 'machine'], ['approve_merge', 'gate'],
  ]);
  assert.deepEqual(L.byId.code_review.agents, ['reviewer', 'security_reviewer'], 'a fan-out step seats each of its agents');
  assert.equal(L.byId.code_review.label, 'Code review', 'the YAML display name');
  // the lane passes every station in order: docks grow along the floor
  const docks = L.stations.map((s) => L.dock[s.id]);
  assert.deepEqual(docks, [...docks].sort((a, b) => a - b));
  assert.ok(L.total > docks.at(-1), 'the lane ends past the last station');

  m.applyAll([ev(30, 'step.started', { step_id: 'test_failed', visit: 1, step_type: 'human_approval' })]);
  assert.deepEqual(m.layout().stations.map((s) => s.id), ['develop', 'code_review', 'test', 'suite', 'test_failed', 'approve_merge']);
});

test('the floor: a long workflow gets more columns, so it grows in rows more slowly', () => {
  const steps = Array.from({ length: 18 }, (_, i) => ({ id: `s${i}`, type: 'agent', agents: ['a'], label: `s${i}` }));
  const L = M.buildLayout(steps);
  assert.equal(new Set(L.stations.map((s) => s.row)).size, 4, '18 stations on 5 columns: 4 rows');
  assert.ok(L.overview >= 46 && L.overview <= 104);
});

test('pointAt: the cart\'s point along the lane, clamped to its ends', () => {
  const L = M.buildLayout(STEPS.slice(0, 4).map((s) => ({ ...s, agents: s.agent ? [s.agent] : [], label: s.id })));
  assert.deepEqual(M.pointAt(L, -5), L.path[0]);
  assert.deepEqual(M.pointAt(L, L.total + 5), L.path.at(-1));
  const p = M.pointAt(L, L.dock.develop);
  assert.ok(Math.abs(p.x - L.byId.develop.x) < 1e-9, 'a station\'s dock is in front of it');
});

test('a live turn: thinking, reading on a tool, writing on an Edit or on text, thinking after a result, done for a few seconds, then idle', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ev(2, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
  ]);
  const key = 'develop:developer';
  assert.equal(m.robotState(key), 'thinking');
  m.apply(ev(3, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_call', name: 'Read', input: { file_path: 'src/app.js' } } }));
  assert.equal(m.robotState(key), 'reading');
  assert.equal(m.robots[key].tool, 'Read · src/app.js');
  m.apply(ev(4, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_result', output: '...' } }));
  assert.equal(m.robotState(key), 'thinking');
  m.apply(ev(5, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_call', name: 'Edit', input: { file_path: 'src/app.js' } } }));
  assert.equal(m.robotState(key), 'writing');
  m.apply(ev(6, 'session.stream', { session_id: 's-dev', item: { kind: 'text', text: 'Adding the route.' } }));
  assert.equal(m.robotState(key), 'writing');
  assert.equal(m.robots[key].say, 'Adding the route.');
  m.apply(ev(10, 'session.message_received', { session_id: 's-dev', step_id: 'develop', turn: 1, cost_usd: 0.42, usage: { input: 1000, output: 300 }, text: 'Done: the route is in.' }));
  assert.equal(m.robotState(key, T0 + 12000), 'done');
  assert.equal(m.robotState(key, T0 + 16000), 'idle');
  assert.equal(m.robotState('test:test_writer'), 'sleeping', 'never ran');
  assert.equal(m.turns, 1);
  assert.equal(m.cost().toFixed(2), '0.42');
  assert.equal(m.tokensOut(), 300);
  assert.equal(m.stepCost('develop').toFixed(2), '0.42');
});

test('a recorded tool call (runs:events activity: its input a cut JSON string) still names what it works on', () => {
  assert.equal(M.toolDetail('{"command":"npm test","description":"Run the tests"}'), 'Run the tests');
  assert.equal(M.toolDetail('{"file_path":"src/very/long.js","old_string":"aaaa…'), 'src/very/long.js');
  assert.equal(M.toolDetail({ pattern: 'TODO' }), 'TODO');
});

test('a turn of an agent away from its desk animates its own desk; a supervisor session animates the supervisor', () => {
  const m = model([
    ...started(),
    ev(1, 'session.opened', { session_id: 's-sup', session: { agent: '_supervisor', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(2, 'step.started', { step_id: 'test', visit: 1 }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'test:delegate', turn: 2 }),
  ]);
  assert.equal(m.robotState('develop:developer'), 'thinking', 'the developer works from the develop desk');
  m.applyAll([
    ev(4, 'supervisor.started', { step_id: 'test', error: 'invalid output' }),
    ev(4, 'session.message_sent', { session_id: 's-sup', step_id: 'test:supervisor', turn: 1 }),
  ]);
  assert.equal(m.sup.target, 'test', 'packets go to the step the supervisor works on');
  assert.equal(m.robotState('supervisor'), 'thinking');
  assert.equal(m.turns, 1, 'the supervisor\'s turn is not counted as an agent turn');
  m.applyAll([
    ev(6, 'session.message_received', { session_id: 's-sup', step_id: 'test:supervisor', turn: 1, cost_usd: 0.1 }),
    ev(6, 'supervisor.decision', { step_id: 'test', action: 'retry', explanation: 'Try again' }),
  ]);
  assert.equal(m.sup.target, null);
  assert.equal(m.sup.calls, 1);
  assert.equal(m.robotState('supervisor', T0 + 7000), 'done');
  assert.equal(m.robotState('supervisor', T0 + 20000), 'sleeping');
  assert.equal(m.agentCost('supervisor').toFixed(2), '0.10');
});

test('waiting at a gate: the station waits with its question, the cart goes there; the answer opens it', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(9, 'step.finished', { step_id: 'develop', visit: 1, output: { summary: 'Route added' } }),
    ev(10, 'step.started', { step_id: 'approve_merge', visit: 1, step_type: 'human_approval' }),
    ev(10, 'approval.requested', { approval_id: 'ap-1', step_id: 'approve_merge', message: 'Merge?', brief: { headline: 'Merge the health endpoint?' } }),
  ]);
  const L = m.layout();
  assert.equal(m.state.approve_merge.status, 'waiting');
  assert.equal(m.state.approve_merge.ask, 'Merge the health endpoint?');
  assert.deepEqual(m.pendingGates().map((g) => [g.id, g.step]), [['ap-1', 'approve_merge']]);
  assert.equal(m.cartGoal(L), L.dock.approve_merge);
  assert.equal(m.farthest(L), L.dock.approve_merge);
  assert.equal(m.state.develop.note, 'Route added');
  m.apply(ev(70, 'approval.resolved', { approval_id: 'ap-1', choice: 'approve', by: 'user', wait_ms: 60000 }));
  assert.equal(m.state.approve_merge.status, 'done');
  assert.equal(m.pendingGates().length, 0);
  assert.match(m.feed[0].text, /Answered “approve” by user after 01:00/);
});

test('an approval asked on an agent step (develop:context_limit) puts its robot in waiting, then back where it was', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
    ev(4, 'session.message_received', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
    ev(5, 'approval.requested', { approval_id: 'ap-2', step_id: 'develop:context_limit', message: 'The context is full: continue?' }),
  ]);
  assert.equal(m.state.develop.status, 'waiting');
  assert.equal(m.robotState('develop:developer'), 'waiting');
  m.apply(ev(8, 'approval.resolved', { approval_id: 'ap-2', approved: true }));
  assert.equal(m.state.develop.status, 'running');
});

test('a failed step: the station is red and its robot shows the error; a reviewer asking for changes is not a failure', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'code_review', visit: 1 }),
    ev(5, 'step.finished', { step_id: 'code_review', visit: 1, output: { results: { reviewer: { verdict: 'changes_requested', findings: [1, 2] } } } }),
    ev(6, 'step.started', { step_id: 'test', visit: 1 }),
    ev(7, 'session.message_sent', { session_id: 's-test', step_id: 'test', turn: 1 }),
    ev(9, 'session.message_received', { session_id: 's-test', step_id: 'test', turn: 1 }),
    ev(9, 'step.finished', { step_id: 'test', visit: 1, error: true, output: { error: 'no tests written' } }),
  ]);
  assert.equal(m.state.code_review.status, 'changes');
  assert.match(m.state.code_review.note, /reviewer: changes requested, 2 finding\(s\)/);
  assert.equal(m.state.test.status, 'failed');
  assert.equal(m.robotState('test:test_writer', T0 + 60000), 'error');
});

test('the engine\'s suite step: its outcome and a note from its output', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'suite', visit: 1, step_type: 'suite' }),
    ev(4, 'step.finished', { step_id: 'suite', visit: 1, output: { kind: 'suite', status: 'fail', passed: 10, failed: 2, scope: 'affected', command: 'npm test' } }),
  ]);
  assert.equal(m.state.suite.status, 'failed');
  assert.equal(m.state.suite.note, '10 passed, 2 failed (affected): npm test');
});

test('KPIs of a live run: visits so far (the open one has no end), elapsed time up to now, cost as turns end', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(8, 'step.finished', { step_id: 'develop', visit: 1 }),
    ev(9, 'step.started', { step_id: 'code_review', visit: 1 }),
  ]);
  assert.equal(m.live, true);
  assert.deepEqual(m.visits.map((v) => [v.step, v.t1 == null]), [['develop', false], ['code_review', true]]);
  assert.equal(m.elapsed(T0 + 30000), 30000);
  assert.equal(m.stepTime('code_review', T0 + 30000), 21000);
  assert.equal(m.stepTime('develop', T0 + 30000), 6000);
});

test('a finished run: the cart at the lane\'s end, every visit closed, "merged into <base>" when it merged', () => {
  const m = model([
    ...started(),
    ev(1, 'worktree.ready', { ref: 'multiagent/run-1', base: 'main' }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
    ev(50, 'worktree.merged', { branch: 'multiagent/run-1', base: 'main', commit: 'abcdef123456' }),
    ev(60, 'workflow.finished', { status: 'success' }),
  ]);
  const L = m.layout();
  assert.equal(m.finished, true);
  assert.equal(m.run.final, 'success');
  assert.equal(m.cartGoal(L), L.total);
  assert.equal(m.farthest(L), L.total);
  assert.deepEqual(m.merged, { branch: 'multiagent/run-1', base: 'main', commit: 'abcdef1' });
  assert.equal(m.elapsed(T0 + 999999), 60000, 'a finished run\'s elapsed time stops at its end');
  assert.equal(m.robots['develop:developer'].busy, false, 'nobody keeps working after the end');
  assert.equal(m.state.develop.status, 'done');
});

test('a past run with no recorded end is shown as interrupted; a run with no events yet is loading', () => {
  assert.equal(new M.Run3DModel().run.status, 'loading');
  const m = model([...started(), ev(2, 'step.started', { step_id: 'develop', visit: 1 })]);
  assert.equal(m.interrupt(), true);
  assert.equal(m.run.final, 'interrupted');
  assert.equal(m.state.develop.status, 'failed');
});

test('replayed + live events: an event at or below the last seq is applied once', () => {
  const events = [...started(), ev(2, 'step.started', { step_id: 'develop', visit: 1 })];
  const m = model(events);
  assert.equal(m.apply(events.at(-1)), false);
  assert.equal(m.visits.length, 1);
});

test('subscribers hear once per batch of events, and on notify (the clock)', () => {
  const m = new M.Run3DModel();
  let n = 0;
  const off = m.subscribe(() => { n++; });
  m.applyAll(started());
  assert.equal(n, 1);
  m.notify();
  assert.equal(n, 2);
  off();
  m.notify();
  assert.equal(n, 2);
});

test('dump / restore (the replay\'s kept states): a deep copy of the state, restored as often as needed', () => {
  const events = [
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
  ];
  const m = model(events);
  const kept = m.dump();
  m.applyAll([
    ev(9, 'session.message_received', { session_id: 's-dev', step_id: 'develop', turn: 1, cost_usd: 0.3 }),
    ev(10, 'step.finished', { step_id: 'develop', visit: 1 }),
  ]);
  assert.equal(kept.state.develop.status, 'running', 'the dump does not follow the model');
  assert.equal(kept.robots['develop:developer'].doneAt, -Infinity, 'a robot that never finished a turn');
  const other = new M.Run3DModel().restore(kept);
  assert.deepEqual(other.dump(), kept);
  assert.equal(other.robotState('develop:developer'), 'thinking');
  other.apply(ev(11, 'step.finished', { step_id: 'develop', visit: 1 }));
  assert.equal(kept.state.develop.status, 'running', 'nor the model it was restored into');
  assert.deepEqual(new M.Run3DModel().restore(kept).dump(), kept, 'restored a second time');
  // a replayed moment stands on another model's floor (the whole run's)
  other.floorOf = m;
  assert.equal(other.layout(), m.layout());
});

test('robotState: a replay stretches `done` by its speed, so it is still seen', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
    ev(10, 'session.message_received', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
  ]);
  assert.equal(m.robotState('develop:developer', T0 + 40000), 'idle');
  assert.equal(m.robotState('develop:developer', T0 + 40000, 16), 'done');
  assert.equal(m.robotState('develop:developer', T0 + 100000, 16), 'idle');
});

test('clockOf: minutes and seconds, hours when there are some', () => {
  assert.equal(M.clockOf(75000), '01:15');
  assert.equal(M.clockOf(3725000), '1:02:05');
});
