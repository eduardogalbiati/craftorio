// packages/ui-kit/run3d-replay.js: the replay of the run's 3D view as a pure player. A recorded
// sequence of the engine's raw events in; the state at any moment of the run, a clock that plays it
// at a speed, the live events kept while a past moment is shown, and the long waits cut short out.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../run3d-model');
const R = require('../run3d-replay');

const T0 = Date.parse('2026-10-05T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'code_review', type: 'agent', agent: 'reviewer' },
  { id: 'suite', type: 'suite', agent: null },
  { id: 'approve_merge', type: 'human_approval', agent: null },
];
let seq = 0;
const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: at(s), run_id: 'run-1', type, ...fields });

// A run of 100 s: develop (a turn with tool calls, 2 s → 40 s), code_review (41 s → 70 s), suite
// (71 s → 80 s), merged at 90 s, finished at 100 s.
function run({ finished = true } = {}) {
  seq = 0;
  return [
    ev(0, 'workflow.started', { workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Add a /health endpoint' }, steps: STEPS, groups: [] }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-rev', session: { agent: 'reviewer', provider: 'codex', model: 'gpt-6' } }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
    ev(10, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_call', name: 'Read', input: { file_path: 'src/app.js' } } }),
    ev(12, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_result', output: '...' } }),
    ev(20, 'session.stream', { session_id: 's-dev', item: { kind: 'tool_call', name: 'Edit', input: { file_path: 'src/app.js' } } }),
    ev(30, 'session.stream', { session_id: 's-dev', item: { kind: 'text', text: 'The route is in.' } }),
    ev(38, 'session.message_received', { session_id: 's-dev', step_id: 'develop', turn: 1, cost_usd: 0.4, usage: { output: 300 }, text: 'Done.' }),
    ev(40, 'step.finished', { step_id: 'develop', visit: 1, output: { summary: 'Route added' } }),
    ev(41, 'step.started', { step_id: 'code_review', visit: 1, step_type: 'agent' }),
    ev(42, 'session.message_sent', { session_id: 's-rev', step_id: 'code_review', turn: 1 }),
    ev(69, 'session.message_received', { session_id: 's-rev', step_id: 'code_review', turn: 1, cost_usd: 0.2, usage: { output: 100 }, text: 'Approved.' }),
    ev(70, 'step.finished', { step_id: 'code_review', visit: 1, output: { results: { reviewer: { verdict: 'approved', findings: [] } } } }),
    ev(71, 'step.started', { step_id: 'suite', visit: 1, step_type: 'suite' }),
    ev(80, 'step.finished', { step_id: 'suite', visit: 1, output: { kind: 'suite', status: 'pass', passed: 12, failed: 0, command: 'npm test' } }),
    ...(finished ? [
      ev(90, 'worktree.merged', { branch: 'multiagent/run-1', base: 'main', commit: 'abcdef123456' }),
      ev(100, 'workflow.finished', { status: 'success' }),
    ] : []),
  ];
}
function player(events, opts) {
  const p = new R.Run3DPlayer(opts);
  p.add(events);
  return p;
}
// what the model is after the events of the run's first `seconds` (the fold, from nothing)
const foldUpTo = (events, seconds) => {
  const m = new M.Run3DModel();
  for (const e of events) if (Date.parse(e.ts) - T0 <= seconds * 1000) m.apply(e);
  return m.dump();
};

test('a finished run opens on its final state, with the replay available: the head is the fold of every event', () => {
  const events = run(), p = player(events);
  assert.equal(p.atHead, true);
  assert.equal(p.live, false);
  assert.equal(p.moving, false, 'nothing plays until asked');
  assert.equal(p.model, p.head);
  assert.equal(p.model.finished, true);
  assert.deepEqual(p.model.dump(), foldUpTo(events, 100));
  assert.equal(p.duration, 100000);
  assert.deepEqual(p.clock(), { at: 100000, total: 100000, cut: 0 });
});

test('seek: the state at T is the fold of the events up to T, whatever the order of the seeks', () => {
  const events = run(), p = player(events);
  // back, forward, into a turn, onto a step's boundary, to the very start
  for (const s of [50, 11, 12, 35, 2, 99.9, 40, 41, 0, 70.5, 3]) {
    assert.equal(p.seek(s * 1000), true);
    assert.equal(p.atHead, false);
    assert.deepEqual(p.model.dump(), foldUpTo(events, s), `at ${s} s`);
    assert.equal(p.now(T0 + 999999), T0 + s * 1000, 'the views\' "now" is the replayed moment, not the wall clock');
  }
  p.seek(11000);
  assert.equal(p.model.robotState('develop:developer', p.now()), 'reading');
  assert.equal(p.model.state.code_review.status, 'pending');
  assert.equal(p.model.cost(), 0, 'a turn\'s cost arrives when it ends');
  assert.equal(p.model.live, true, 'the replayed moment is a running run');
  assert.equal(p.head.finished, true, 'the head is untouched by a seek');
  assert.equal(p.model.layout(), p.head.layout(), 'a replayed moment stands on the floor of the whole run');
});

test('seek on a long run: from the state kept at the last step boundary, never the whole run again', () => {
  seq = 0;
  const events = [
    ev(0, 'workflow.started', { workflow: 'w', steps: STEPS, groups: [] }),
    ev(0, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
  ];
  // 12 visits of develop, each a turn of 1000 stream items: 12 000 events
  for (let v = 0; v < 12; v++) {
    const s = 10 + v * 1000;
    events.push(ev(s, 'step.started', { step_id: 'develop', visit: v + 1 }), ev(s, 'session.message_sent', { session_id: 's-dev', step_id: 'develop' }));
    for (let i = 0; i < 1000; i++) events.push(ev(s + 1 + i * 0.9, 'session.stream', { session_id: 's-dev', item: i % 2 ? { kind: 'tool_result' } : { kind: 'tool_call', name: 'Read', input: { file_path: `f${i}.js` } } }));
    events.push(ev(s + 950, 'session.message_received', { session_id: 's-dev', step_id: 'develop', cost_usd: 0.1 }), ev(s + 960, 'step.finished', { step_id: 'develop', visit: v + 1 }));
  }
  const p = player(events);
  assert.equal(p.snaps.length, 12, 'a state kept at each step.started');
  let applied = 0;
  const apply = p.past.apply.bind(p.past);
  p.past.apply = (e) => { applied++; return apply(e); };
  p.seek(11500 * 1000);
  assert.ok(applied < 1100, `${applied} events folded for a seek near the end of ${events.length}`);
  assert.deepEqual(p.model.dump(), foldUpTo(events, 11500));
  applied = 0;
  p.seek(11501 * 1000);
  assert.ok(applied <= 2, 'a small move forward folds only what is new');
  applied = 0;
  p.seek(11400 * 1000);
  assert.ok(applied < 1100, 'a move back starts from the kept state of that step');
  assert.deepEqual(p.model.dump(), foldUpTo(events, 11400));

  // a step with thousands of events gets a kept state every SNAPSHOT_EVERY events too
  seq = 0;
  const one = [ev(0, 'workflow.started', { workflow: 'w', steps: STEPS, groups: [] }), ev(0, 'session.opened', { session_id: 's-dev', session: { agent: 'developer' } }),
    ev(1, 'step.started', { step_id: 'develop', visit: 1 }), ev(1, 'session.message_sent', { session_id: 's-dev', step_id: 'develop' })];
  for (let i = 0; i < 5000; i++) one.push(ev(2 + i, 'session.stream', { session_id: 's-dev', item: { kind: 'thinking' } }));
  const q = player(one);
  assert.equal(q.snaps.length, 3, 'one at the step\'s start, two more along its 5000 events');
});

test('play advances with the clock and the speed; pause stops it; the end of a finished run is its final state', () => {
  const events = run(), p = player(events);
  let heard = 0;
  p.subscribe(() => { heard++; });
  assert.equal(p.play(), true, 'play from the end: from the beginning');
  assert.equal(p.atHead, false);
  assert.equal(p.t, 0);
  assert.equal(p.moving, true);
  assert.equal(p.speed, 16);
  assert.deepEqual(p.model.dump(), foldUpTo(events, 0));
  p.tick(1000);
  assert.equal(p.t, 16000, 'one second at 16×: sixteen seconds of the run');
  assert.deepEqual(p.model.dump(), foldUpTo(events, 16));
  assert.equal(p.setSpeed(64), true);
  assert.equal(p.setSpeed(5), false, 'only the offered speeds');
  p.tick(500);
  assert.equal(p.t, 48000);
  assert.deepEqual(p.model.dump(), foldUpTo(events, 48));
  assert.equal(p.model.state.code_review.status, 'running');
  p.pause();
  assert.equal(p.moving, false);
  p.tick(5000);
  assert.equal(p.t, 48000, 'a paused replay does not move');
  p.toggle();
  p.setSpeed(1);
  const before = heard;
  for (let i = 0; i < 10; i++) p.tick(16);
  assert.equal(p.t, 48160);
  assert.equal(heard - before, 1, 'the views hear a playing replay about ten times a second, not on every frame');
  p.setSpeed(64);
  p.tick(1000);
  assert.equal(p.atHead, true, 'past the end: the head');
  assert.equal(p.moving, false);
  assert.equal(p.model, p.head);
  assert.equal(p.model.finished, true);
  assert.equal(p.tick(1000), false);
});

test('a live run opens live; seeking leaves live mode, the live events are kept and shown after "Live"', () => {
  const events = run({ finished: false }), p = player(events);
  assert.equal(p.live, true);
  assert.equal(p.moving, true, 'a live head moves by itself');
  assert.equal(p.play(), false, 'nothing to start: it is live');
  let heard = 0;
  p.subscribe(() => { heard++; });

  p.seek(11000);
  assert.equal(p.live, false);
  assert.equal(p.atHead, false);
  assert.equal(p.moving, false, 'a seek from live shows that moment, paused');
  const shown = p.model.dump();
  heard = 0;
  const later = [
    ev(85, 'step.started', { step_id: 'approve_merge', visit: 1, step_type: 'human_approval' }),
    ev(85, 'approval.requested', { approval_id: 'ap-1', step_id: 'approve_merge', message: 'Merge?' }),
  ];
  assert.equal(p.add(later), true, 'the head took them');
  assert.equal(heard, 0, 'the replayed moment did not change: the views are not told');
  assert.deepEqual(p.model.dump(), shown, 'the scene still shows the replayed moment');
  assert.equal(p.head.state.approve_merge.status, 'waiting');
  assert.deepEqual(p.behind(T0 + 120000), { events: events.length + 2 - p.n, ms: 109000 }, 'how far behind the live run: events, and time up to now');

  assert.equal(p.toHead(), true);
  assert.equal(p.live, true);
  assert.equal(p.model, p.head);
  assert.equal(p.model.state.approve_merge.status, 'waiting');
  assert.deepEqual(p.model.dump(), foldUpTo([...events, ...later], 85));
  assert.deepEqual(p.behind(T0 + 120000), { events: 0, ms: 0 });
  assert.equal(p.add([later[0]]), false, 'an event already taken (recorded + live overlap) is taken once');
});

test('a live run: pause freezes this moment while the run goes on; play catches up and is live again', () => {
  const events = run({ finished: false }), p = player(events);
  assert.equal(p.pause(), true);
  assert.equal(p.atHead, false);
  assert.equal(p.t, p.duration);
  assert.deepEqual(p.model.dump(), p.head.dump(), 'frozen on the head\'s moment');
  const epoch = p.epoch;
  p.add([ev(90, 'worktree.merged', { branch: 'multiagent/run-1', base: 'main', commit: 'abc' })]);
  assert.equal(p.model.merged, null, 'what happens meanwhile is not shown');
  assert.notEqual(p.head.merged, null);
  assert.equal(p.epoch, epoch, 'no jump: the cart stays where it is');
  p.setSpeed(4);
  p.play();
  p.tick(1000);
  assert.equal(p.atHead, false, '4 s of the 10 s it is behind');
  p.tick(2000);
  assert.equal(p.live, true, 'caught up: live again');
  assert.notEqual(p.model.merged, null);
});

test('the long waits for the owner are cut short in a replay (and only there): over a minute becomes 45 s', () => {
  seq = 0;
  const events = [
    ev(0, 'workflow.started', { workflow: 'w', steps: STEPS, groups: [] }),
    ev(10, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(20, 'approval.requested', { approval_id: 'short', step_id: 'develop:context_limit', message: 'Continue?' }),
    ev(70, 'approval.resolved', { approval_id: 'short', approved: true }),
    ev(100, 'step.finished', { step_id: 'develop', visit: 1 }),
    ev(100, 'step.started', { step_id: 'approve_merge', visit: 1, step_type: 'human_approval' }),
    ev(100, 'approval.requested', { approval_id: 'long', step_id: 'approve_merge', message: 'Merge?' }),
    ev(3700, 'approval.resolved', { approval_id: 'long', choice: 'approve', wait_ms: 3600000 }),
    ev(3700, 'step.finished', { step_id: 'approve_merge', visit: 1 }),
    ev(3710, 'step.started', { step_id: 'suite', visit: 1, step_type: 'suite' }),
  ];
  const live = player(events);
  // live: real time, nothing cut
  const real = live.strip(T0 + 3720000);
  assert.equal(real.live, true);
  assert.equal(real.span, 3720000);
  assert.deepEqual(real.cuts, []);
  assert.equal(real.at, null, 'no playhead on a live strip');
  assert.equal(real.visits[1].ms, 3600000);
  assert.ok(real.visits[1].width > 0.96, 'the hour of waiting is most of the live strip');
  assert.equal(real.visits[2].open, true);

  const p = player([...events, ev(3720, 'step.finished', { step_id: 'suite', visit: 1 }), ev(3730, 'workflow.finished', { status: 'success' })]);
  assert.deepEqual(p.waitCuts(), [{ from: T0 + 145000, to: T0 + 3700000 }], 'the 50 s wait is whole, the hour keeps 45 s');
  assert.equal(p.duration, 3730000 - 3555000);
  assert.equal(p.replayOf(T0 + 120000), 120000);
  assert.equal(p.replayOf(T0 + 2000000), 145000, 'any moment of the cut is its start');
  assert.equal(p.replayOf(T0 + 3710000), 155000);
  assert.equal(p.realOf(144999), T0 + 144999);
  assert.equal(p.realOf(145000), T0 + 3700000, 'at the cut the replay is at the answer');
  assert.equal(p.realOf(155000), T0 + 3710000);
  assert.deepEqual(p.clock(), { at: 3730000, total: 3730000, cut: 3555000 }, 'the clock stays in the run\'s real time and says what is skipped');

  const strip = p.strip();
  assert.equal(strip.live, false);
  assert.equal(strip.span, 175000);
  assert.equal(strip.at, 1, 'the playhead at the end of a finished run');
  assert.deepEqual(strip.cuts.map((c) => [Math.round(c.at * 1000) / 1000, c.ms]), [[0.829, 3555000]], 'where the wait was cut, and how much');
  assert.equal(strip.visits[1].ms, 3600000, 'a visit keeps its real length in its tooltip');
  assert.ok(Math.abs(strip.visits[1].width - 45000 / 175000) < 1e-9, 'and takes 45 s of the strip');

  p.seek(144000);
  assert.equal(p.model.state.approve_merge.status, 'waiting');
  assert.equal(p.model.elapsed(p.now()), 144000);
  assert.deepEqual(p.strip().visits.map((v) => v.todo), [false, false, true], 'what comes after the shown moment is dimmed');
  p.setSpeed(1);
  p.play();
  p.tick(1000);
  assert.equal(p.model.state.approve_merge.status, 'done', 'one second later the hour is over');
  assert.equal(p.model.elapsed(p.now()), 3700000, 'the elapsed time jumps over what was cut');
  assert.equal(p.clock().at, 3700000);

  // seeking on the strip: a point of what is drawn
  p.seekStrip(0.5);
  assert.equal(p.t, 87500);
  live.seekStrip(0.5, T0 + 3720000);
  assert.equal(live.atHead, false);
  assert.equal(live.t, 145000, 'the middle of a live strip is in the hour of waiting: the cut, in replay time');
  assert.equal(live.model.state.approve_merge.status, 'done', 'at the cut the gate is answered');
});

test('a wait still open is cut too (a run that waits now, or that ended without an answer)', () => {
  seq = 0;
  const p = player([
    ev(0, 'workflow.started', { workflow: 'w', steps: STEPS, groups: [] }),
    ev(10, 'step.started', { step_id: 'approve_merge', visit: 1, step_type: 'human_approval' }),
    ev(10, 'approval.requested', { approval_id: 'ap', step_id: 'approve_merge', message: 'Merge?' }),
    ev(900, 'log', { level: 'warn', message: 'Still waiting' }),
  ]);
  assert.deepEqual(p.waitCuts(), [{ from: T0 + 55000, to: T0 + 900000 }]);
  assert.equal(p.duration, 55000);
  p.interrupt();
  assert.equal(p.head.run.final, 'interrupted');
  assert.equal(p.duration, 55000);
  p.play();
  assert.equal(p.model.live, true, 'the replay of an interrupted run runs');
  p.setSpeed(64);
  p.tick(1000);
  assert.equal(p.atHead, true);
  assert.equal(p.model.run.final, 'interrupted', 'and ends on the interrupted run');
});

test('the start of a replay always has the floor, even when the first events are recorded out of order', () => {
  seq = 0;
  const p = player([
    ev(3, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(0, 'workflow.started', { workflow: 'w', steps: STEPS, groups: [] }),
    ev(10, 'step.started', { step_id: 'develop', visit: 1 }),
    ev(20, 'step.finished', { step_id: 'develop', visit: 1 }),
    ev(30, 'workflow.finished', { status: 'success' }),
  ]);
  p.play();
  assert.equal(p.t, 0);
  assert.equal(p.model.steps.length, STEPS.length, 'the floor is there at the very start');
  assert.equal(p.model.state.develop.status, 'pending');
});

test('step: Left / Right go to the start of the previous / next step visit; past the last one, the head', () => {
  const p = player(run());
  assert.deepEqual(p.marks(), [0, 2000, 41000, 71000]);
  assert.equal(p.step(1), false, 'nothing after the end');
  p.step(-1);
  assert.equal(p.t, 71000);
  assert.equal(p.moving, false, 'stepping from the end of a finished run shows the moment, paused');
  assert.equal(p.model.state.suite.status, 'running');
  p.step(-1);
  assert.equal(p.t, 41000);
  p.step(-1); p.step(-1); p.step(-1);
  assert.equal(p.t, 0);
  p.step(1);
  assert.equal(p.t, 2000);
  p.seek(50000);
  p.step(-1);
  assert.equal(p.t, 41000, 'from inside a step: its start');
  p.seek(41500);
  p.play();
  p.step(-1);
  assert.equal(p.t, 2000, 'while it plays, back within a second of a start goes to the one before');
  assert.equal(p.moving, true, 'a step keeps a playing replay playing');
  p.pause();
  p.seek(80000);
  assert.equal(p.step(1), true);
  assert.equal(p.atHead, true, 'past the last step: the end');
  p.nudge(-0.1);
  assert.equal(p.t, 90000, 'a nudge moves by a part of the timeline');
  p.nudge(0.5);
  assert.equal(p.atHead, true);
});

test('a jump of the shown moment says so (epoch): the cart is put there, not driven; playing does not jump', () => {
  const p = player(run());
  const e0 = p.epoch;
  p.seek(50000);
  assert.equal(p.epoch, e0 + 1);
  p.play();
  p.tick(100);
  assert.equal(p.epoch, e0 + 1, 'a playing replay drives the cart');
  p.toHead();
  assert.equal(p.epoch, e0 + 2);
});

test('a replay knows when a running visit ends (its bar fills); the head does not', () => {
  const p = player(run());
  assert.equal(p.progress('develop'), null);
  p.seek(21000);
  assert.equal(p.progress('develop'), 0.5, '19 s of the 38 s of the visit');
  assert.equal(p.progress('code_review'), null, 'not started');
  p.seek(60000);
  assert.equal(p.progress('develop'), null, 'ended');
});

test('robot states at the shown moment: `done` stays visible at the replay\'s speed', () => {
  const p = player(run());
  p.setSpeed(1);
  p.seek(39000);
  assert.equal(p.robotState('develop:developer', T0), 'done', '1 s after its turn');
  p.seek(60000);
  assert.equal(p.robotState('develop:developer', T0), 'idle', '22 s after its turn at 1×');
  p.setSpeed(16);
  assert.equal(p.robotState('develop:developer', T0), 'done', 'at 16× the 5 s of `done` are 80 s of the run');
  p.toHead();
  assert.equal(p.robotState('develop:developer', T0 + 3600000), 'idle', 'at the head: the wall clock');
});

test('keys of the replay: Space toggles, Left / Right step, Shift nudges; a field or a keyboard-focused button keeps its keys', () => {
  assert.equal(R.keyAction(' '), 'toggle');
  assert.equal(R.keyAction('ArrowLeft'), 'back');
  assert.equal(R.keyAction('ArrowRight'), 'forward');
  assert.equal(R.keyAction('ArrowLeft', { shift: true }), 'nudge-back');
  assert.equal(R.keyAction('ArrowRight', { shift: true }), 'nudge-forward');
  assert.equal(R.keyAction(' ', { field: true }), null, 'typing a space in the search');
  assert.equal(R.keyAction('ArrowLeft', { field: true }), null);
  assert.equal(R.keyAction(' ', { pressable: true }), null, 'Space presses the focused button');
  assert.equal(R.keyAction('ArrowRight', { pressable: true }), 'forward');
  assert.equal(R.keyAction(' ', { modifier: true }), null);
  assert.equal(R.keyAction('a'), null);
});

test('subscribers: once per batch at the head, on each seek, on the clock\'s notify', () => {
  const p = new R.Run3DPlayer();
  let n = 0;
  const off = p.subscribe(() => { n++; });
  p.add(run());
  assert.equal(n, 1);
  p.seek(1000);
  assert.equal(n, 2);
  p.notify();
  assert.equal(n, 3);
  off();
  p.toHead();
  assert.equal(n, 3);
  assert.equal(new R.Run3DPlayer().play(), false, 'a run with no events has nothing to replay');
});
