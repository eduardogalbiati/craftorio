// #10 (acceptance tests, written before the code): a run rebuilt from its events (#607, `recover:`)
// keeps the time it already waited at human gates. #416 subtracts the gate clock from the run's
// wall clock in checkLimits(); the recovered run restarts from its original workflow.started time,
// so its gate clock must come back from the log too: the answered gates (approval.resolved,
// wait_ms) plus the gate still open, counted from its approval.requested time.
// Seam: a WorkflowRun built with `recover: { runId, events, worktree }` and never started; its start
// time is the one start() takes (run.recovered.startedAt, the log's workflow.started); its limits
// are checked through checkLimits() as the run does before every step, its gates asked and answered
// through requestApproval / resolveApproval (a recovery asks the open gate again under a new id), and
// its timing read through timingSummary() (the summary's `timing`). The clock is faked (node:test mock
// timers, Date only).
// Assumption: the gate clock is restored when the run is built from its events (with the rest of the
// recovered state), so the very first checkLimits() of the recovered run, before its gate step is
// asked again, already sees it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const H = 3600e3;
const M = 60e3;
const T0 = Date.parse('2026-11-15T13:58:24Z');
const FIXTURE = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-recovered-gate-clock-10 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p"] }
orchestrator:
  limits:
    max_total_duration: 8h
    max_total_cost_usd: 5
agents:
  dev: { provider: claude, model: claude-opus-5-5, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "Implement it."
  - id: test_failed
    type: human_approval
    message: "The tests failed. Continue?"
`;

// a log written by hand: [msFromT0, type, fields], numbered and timestamped
function log(entries) {
  return entries.map(([at, type, fields = {}], i) => ({ seq: i + 1, type, ts: new Date(T0 + at).toISOString(), ...fields }));
}

const started = () => [0, 'workflow.started', { mock: true }];
const stepStarted = (at, id, visit = 1) => [at, 'step.started', { step_id: id, visit }];
const stepFinished = (at, id, visit = 1) => [at, 'step.finished', { step_id: id, visit, output: { text: 'done' } }];
const asked = (at, id) => [at, 'approval.requested', { approval_id: id, step_id: 'test_failed', message: 'The tests failed. Continue?' }];
const answered = (at, id, waitMs) => [at, 'approval.resolved', { approval_id: id, step_id: 'test_failed', approved: true, by: 'user', wait_ms: waitMs }];

// the run rebuilt from `events` at `now` (ms after T0), as the app does after a restart
function recovered(t, events, now) {
  t.mock.timers.enable({ apis: ['Date'], now: T0 + now });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovered-gate-clock-10-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], recover: { runId: 'r10', events, worktree: null } });
  run.orchestrator = { id: 'orchestrator' };
  // what start() does for a recovered run: the run's original start, from its workflow.started
  run.startedAt = run.recovered.startedAt;
  const emitted = [];
  run.on('event', (ev) => emitted.push(ev));
  return { run, emitted };
}

const work = (t, ms) => t.mock.timers.tick(ms);
const exceeded = (emitted) => emitted.find((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_duration');

// the recovered run asks its open gate again (a new id) and the owner answers it right away
function answerAskedAgain(run, emitted) {
  run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'The tests failed. Continue?' }).catch(() => {});
  const ask = emitted.filter((e) => e.type === 'approval.requested').at(-1);
  assert.ok(ask, 'the gate was asked again');
  assert.equal(run.resolveApproval(ask.approval_id, true, 'owner'), true);
}

// 2h of work, then the test_failed gate opened and left open (the app restarted while it waited)
const OPEN_GATE_AFTER_2H = () => log([started(), stepStarted(0, 'develop'), stepFinished(2 * H, 'develop'), stepStarted(2 * H, 'test_failed'), asked(2 * H, 'a1')]);

test('#10 a run recovered 12h into an open gate after 2h of work is not over max_total_duration (8h)', (t) => {
  const { run, emitted } = recovered(t, OPEN_GATE_AFTER_2H(), 14 * H);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 2h of 8h: the 12h at the open gate are not work');
  assert.equal(exceeded(emitted), undefined, 'no limit.exceeded');
});

test('#10 answering the gate a recovered run asked again never trips the limit by itself: the open gate counts from its approval.requested', (t) => {
  const { run, emitted } = recovered(t, OPEN_GATE_AFTER_2H(), 14 * H);
  answerAskedAgain(run, emitted);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 2h, 12h at the gate');
  assert.equal(exceeded(emitted), undefined);
  assert.equal(run.timingSummary().gate_wait_ms, 12 * H, 'the summary\'s timing keeps the 12h waited before the recovery');
});

test('#10 a recovered run whose work alone passes the limit is still stopped; limit.exceeded carries the restored gate time', (t) => {
  const { run, emitted } = recovered(t, OPEN_GATE_AFTER_2H(), 14 * H);
  answerAskedAgain(run, emitted);
  work(t, 7 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const ev = exceeded(emitted);
  assert.equal(ev?.worked_ms, 9 * H);
  assert.equal(ev?.gate_wait_ms, 12 * H);
});

test('#10 a run recovered at an open gate after 9h of work is over the limit at once, with the open gate\'s 3h as gate time', (t) => {
  const events = log([started(), stepStarted(0, 'develop'), stepFinished(9 * H, 'develop'), stepStarted(9 * H, 'test_failed'), asked(9 * H, 'a1')]);
  const { run, emitted } = recovered(t, events, 12 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const ev = exceeded(emitted);
  assert.equal(ev?.worked_ms, 9 * H);
  assert.equal(ev?.gate_wait_ms, 3 * H);
});

// two answered gates of 5h each between 5h of work in all; the app restarted 2h into the third develop
const TWO_ANSWERED_GATES = () => log([
  started(),
  stepStarted(0, 'develop'), stepFinished(H, 'develop'),
  stepStarted(H, 'test_failed'), asked(H, 'a1'), answered(6 * H, 'a1', 5 * H), stepFinished(6 * H, 'test_failed'),
  stepStarted(6 * H, 'develop', 2), stepFinished(8 * H, 'develop', 2),
  stepStarted(8 * H, 'test_failed', 2), asked(8 * H, 'a2'), answered(13 * H, 'a2', 5 * H), stepFinished(13 * H, 'test_failed', 2),
  stepStarted(13 * H, 'develop', 3),
]);

test('#10 a run recovered after two answered gates (10h waited) does not count them as work', (t) => {
  const { run, emitted } = recovered(t, TWO_ANSWERED_GATES(), 15 * H);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 5h of 8h, 15h wall clock');
  assert.equal(exceeded(emitted), undefined);
});

test('#10 the summary\'s timing of a run recovered after two answered gates matches the events', (t) => {
  const { run } = recovered(t, TWO_ANSWERED_GATES(), 15 * H);
  const timing = run.timingSummary();
  assert.equal(timing.gate_wait_ms, 10 * H);
  assert.deepEqual(timing.gates.test_failed, { waits: 2, wait_ms: 10 * H });
});

test('#10 after two answered gates, the work past the limit still stops the recovered run with the gate time in limit.exceeded', (t) => {
  const { run, emitted } = recovered(t, TWO_ANSWERED_GATES(), 15 * H);
  work(t, 4 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const ev = exceeded(emitted);
  assert.equal(ev?.worked_ms, 9 * H);
  assert.equal(ev?.gate_wait_ms, 10 * H);
});

test('#10 the release run of the issue: 67 min at regression_failed, then Ship open overnight; recovered when the owner answers, it is not over the limit', (t) => {
  const regression = 4037218; // the approval.resolved wait_ms of 20261115-135824-d4e9fef8
  // 6h20 of work in all before Ship opens; Ship open from 23:24Z to 09:57Z (10h33m)
  const shipAt = 3 * H + regression + 3 * H + 20 * M;
  const answeredAt = shipAt + (Date.parse('2026-11-16T09:57:00Z') - Date.parse('2026-11-15T23:24:00Z'));
  const events = log([
    started(), stepStarted(0, 'develop'), stepFinished(3 * H, 'develop'),
    stepStarted(3 * H, 'test_failed'), asked(3 * H, 'a1'), answered(3 * H + regression, 'a1', regression), stepFinished(3 * H + regression, 'test_failed'),
    stepStarted(3 * H + regression, 'develop', 2), stepFinished(shipAt, 'develop', 2),
    stepStarted(shipAt, 'test_failed', 2), asked(shipAt, 'a2'),
  ]);
  const { run, emitted } = recovered(t, events, answeredAt);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 6h20 of 8h; about 11h40 at the two gates');
  answerAskedAgain(run, emitted);
  assert.doesNotThrow(() => run.checkLimits());
  assert.equal(exceeded(emitted), undefined);
  assert.equal(run.timingSummary().gate_wait_ms, regression + (answeredAt - shipAt));
});

test('#10 a run recovered with no gate in its log is unchanged: 7h of work passes, 9h is over the limit with no gate time', (t) => {
  const events = log([started(), stepStarted(0, 'develop')]);
  const { run, emitted } = recovered(t, events, 7 * H);
  assert.doesNotThrow(() => run.checkLimits());
  assert.equal(run.timingSummary().gate_wait_ms, 0);
  work(t, 2 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const ev = exceeded(emitted);
  assert.equal(ev?.worked_ms, 9 * H);
  assert.equal(ev?.gate_wait_ms, 0);
});

test('#10 a gate withdrawn before the recovery stops counting at its withdrawal', (t) => {
  // 1h of work, a gate open 3h then withdrawn (approval.resolved withdrawn: true, no wait_ms), 6h of work since
  const events = log([
    started(), stepStarted(0, 'develop'), stepFinished(H, 'develop'), stepStarted(H, 'test_failed'), asked(H, 'a1'),
    [4 * H, 'approval.resolved', { approval_id: 'a1', withdrawn: true, by: 'check', reason: 'closed: merged by another run' }],
    stepStarted(4 * H, 'develop', 2),
  ]);
  const { run } = recovered(t, events, 10 * H);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 7h of 8h, 3h at the withdrawn gate');
  work(t, 2 * H - M);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded/);
});

// the review's follow-ups: later visits and a second recovery

test('#10 a later visit to the gate after the recovery is a new wait: it does not inherit the time the gate was first asked', (t) => {
  const { run, emitted } = recovered(t, OPEN_GATE_AFTER_2H(), 14 * H);
  answerAskedAgain(run, emitted); // the recovered visit: 12h
  work(t, H);
  run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'The tests failed. Continue?' }).catch(() => {});
  const again = emitted.filter((e) => e.type === 'approval.requested').at(-1);
  t.mock.timers.tick(H);
  assert.equal(run.resolveApproval(again.approval_id, true, 'owner'), true);
  const resolved = emitted.filter((e) => e.type === 'approval.resolved');
  assert.deepEqual(resolved.map((e) => e.wait_ms), [12 * H, H], 'the second answer waited 1h, not 14h');
  assert.deepEqual(run.timingSummary().gates.test_failed, { waits: 2, wait_ms: 13 * H });
  assert.doesNotThrow(() => run.checkLimits(), 'worked 3h, 13h at the gate');
});

// the log of a run already recovered once at its open gate (2h of work, 12h at the gate), as the
// engine writes it: run.recovered, the gate asked again (a2) and answered a minute later with its
// whole wait, then develop again
const RECOVERED_ONCE = () => [
  started(), stepStarted(0, 'develop'), stepFinished(2 * H, 'develop'), stepStarted(2 * H, 'test_failed'), asked(2 * H, 'a1'),
  [14 * H, 'run.recovered', { step_id: 'test_failed', after_seq: 5, gate: true, lost_turns: [] }],
  stepStarted(14 * H, 'test_failed'), asked(14 * H, 'a2'), answered(14 * H + M, 'a2', 12 * H + M), stepFinished(14 * H + M, 'test_failed'),
  stepStarted(14 * H + M, 'develop', 2),
];

test('#10 a second recovery replays the first one\'s gate time once: the work past the limit stops the run with the same gate time', (t) => {
  const { run, emitted } = recovered(t, log(RECOVERED_ONCE()), 19 * H + M);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 7h, 12h01 at the gate');
  assert.deepEqual(run.timingSummary().gates.test_failed, { waits: 1, wait_ms: 12 * H + M });
  work(t, 2 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const ev = exceeded(emitted);
  assert.equal(ev?.worked_ms, 9 * H);
  assert.equal(ev?.gate_wait_ms, 12 * H + M);
});

test('#10 a second recovery at a gate asked in a later visit counts that gate from its own request, not from the first recovery\'s', (t) => {
  // after the first recovery: 1h of develop, then test_failed asked again (a3) and left open 2h when the app died again
  const events = log([...RECOVERED_ONCE(), stepFinished(15 * H + M, 'develop', 2), stepStarted(15 * H + M, 'test_failed', 2), asked(15 * H + M, 'a3')]);
  const { run, emitted } = recovered(t, events, 17 * H + M);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 3h, 14h01 at gates');
  answerAskedAgain(run, emitted);
  const resolved = emitted.filter((e) => e.type === 'approval.resolved').at(-1);
  assert.equal(resolved?.wait_ms, 2 * H, 'the gate asked in the later visit waited 2h');
  assert.equal(run.timingSummary().gate_wait_ms, 14 * H + M);
  work(t, 6 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  assert.equal(exceeded(emitted)?.gate_wait_ms, 14 * H + M);
});
