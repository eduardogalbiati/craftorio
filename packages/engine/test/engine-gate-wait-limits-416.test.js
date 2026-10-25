// #416 (acceptance tests, written before the code): time waiting for the owner at a human gate is not
// run time; max_total_duration (and tonight's duration, #337) measures the work. A WorkflowRun built
// and never started; its gates are opened and answered through requestApproval / resolveApproval and
// its limits checked through checkLimits(), the way a run does before every step. The clock is faked
// (node:test mock timers, Date only).
// The behaviour these tests pin down:
//   - checkLimits() compares the run's elapsed time minus the time spent at its human gates with the limit;
//   - past it, the error (and so the run's end message) says "worked X of Y", e.g.
//     "Maximum duration exceeded (worked 9h of 8h)."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const H = 3600e3;
const M = 60e3;
const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-gate-wait-limits-416 }
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

function newRun(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T21:00:00Z') });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-gate-wait-limits-416-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  run.orchestrator = { id: 'orchestrator' };
  run.startedAt = Date.now();
  const events = [];
  run.on('event', (ev) => events.push(ev));
  return { run, events };
}

const work = (t, ms) => t.mock.timers.tick(ms);

// the run waits `ms` at the test_failed gate, then the owner answers it
function waitAtGate(t, run, events, ms) {
  run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'The tests failed. Continue?' }).catch(() => {});
  const asked = events.filter((e) => e.type === 'approval.requested').at(-1);
  t.mock.timers.tick(ms);
  assert.equal(run.resolveApproval(asked.approval_id, true, 'owner'), true);
}

test('#416 a 10h wait at a human gate does not count toward max_total_duration: the run worked 45 min', (t) => {
  const { run, events } = newRun(t);
  work(t, 30 * M);
  waitAtGate(t, run, events, 10 * H + 37 * M);
  work(t, 15 * M);
  assert.doesNotThrow(() => run.checkLimits());
  assert.equal(events.some((e) => e.type === 'limit.exceeded'), false);
});

test('#416 work time past max_total_duration still stops the run, gate waits or not', (t) => {
  const { run, events } = newRun(t);
  work(t, 4 * H);
  waitAtGate(t, run, events, 10 * H);
  work(t, 4 * H + 15 * M);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded/);
  const exceeded = events.find((e) => e.type === 'limit.exceeded');
  assert.equal(exceeded?.limit, 'max_total_duration');
});

test('#416 a run with no gate is still stopped by its wall-clock work past the limit', (t) => {
  const { run } = newRun(t);
  work(t, 9 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded/);
});

test('#416 the duration limit\'s message says how long the run worked out of the limit ("worked X of Y")', (t) => {
  const { run, events } = newRun(t);
  work(t, 5 * H);
  waitAtGate(t, run, events, 6 * H);
  work(t, 4 * H);
  // worked 9h (wall clock 15h): the message names the work, not the wall clock
  assert.throws(() => run.checkLimits(), (e) => /worked 9(\.0)?\s?h\b.*\bof 8\s?h/i.test(e.message) && !/15(\.0)?\s?h/.test(e.message));
});

test('#416 several gate waits add up: none of them counts', (t) => {
  const { run, events } = newRun(t);
  work(t, 2 * H);
  waitAtGate(t, run, events, 5 * H);
  work(t, 2 * H);
  waitAtGate(t, run, events, 5 * H);
  work(t, 2 * H);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 6h of 8h, 16h wall clock');
});

test('#416 a gate still open does not count either: a check while the owner has not answered yet', (t) => {
  const { run, events } = newRun(t);
  work(t, H);
  run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'Continue?' }).catch(() => {});
  assert.equal(events.some((e) => e.type === 'approval.requested'), true);
  t.mock.timers.tick(12 * H);
  assert.doesNotThrow(() => run.checkLimits());
});

test('#416 tonight\'s duration (Night watch, through dayLimits) measures the work too', (t) => {
  const { run, events } = newRun(t, { nightLimits: () => ({ multiplier: 2 }) });
  work(t, 6 * H);
  waitAtGate(t, run, events, 20 * H);
  work(t, 6 * H);
  assert.doesNotThrow(() => run.checkLimits(), 'worked 12h of tonight\'s 16h, 32h wall clock');
  work(t, 5 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded/);
});

test('#416 the summary\'s timing keeps the wall-clock time at gates apart (gate_wait_ms)', (t) => {
  const { run, events } = newRun(t);
  work(t, H);
  waitAtGate(t, run, events, 10 * H);
  const timing = run.timingSummary();
  assert.equal(timing.gate_wait_ms, 10 * H);
  assert.deepEqual(timing.gates.test_failed, { waits: 1, wait_ms: 10 * H });
});

// the id of the gate the run opened last
const lastAsked = (events) => events.filter((e) => e.type === 'approval.requested').at(-1).approval_id;

test('#416 two gates open at the same time count once; limit.exceeded carries the work and the gate time', (t) => {
  const { run, events } = newRun(t);
  work(t, 5 * H);
  run.requestApproval({ id: 'dev:context_limit', raw: true, message: 'Continue?' }).catch(() => {});
  const first = lastAsked(events);
  t.mock.timers.tick(2 * H);
  run.requestApproval({ id: 'qa:context_limit', raw: true, message: 'Continue?' }).catch(() => {});
  const second = lastAsked(events);
  t.mock.timers.tick(3 * H);
  run.resolveApproval(first, 'continue', 'owner');
  t.mock.timers.tick(H);
  run.resolveApproval(second, 'continue', 'owner');
  work(t, 4 * H);
  // wall clock 15h, at least one gate open 6h (not 2h + 3h + 3h + 1h = 9h): worked 9h of 8h
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
  const exceeded = events.find((e) => e.type === 'limit.exceeded');
  assert.equal(exceeded.worked_ms, 9 * H);
  assert.equal(exceeded.gate_wait_ms, 6 * H);
});

test('#416 a gate withdrawn by its PR check stops the gate clock: the work after it counts', (t) => {
  const { run, events } = newRun(t);
  run.requestApproval({ id: 'approve_merge', type: 'human_approval', message: 'Merge?' }).catch(() => {});
  t.mock.timers.tick(3 * H);
  run.withdrawApproval(lastAsked(events), { state: 'closed', detail: 'merged by another run' });
  work(t, 9 * H);
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded \(worked 9h of 8h\)/);
});

test('#416 a gate answered by its timeout while the run is over the cost limit stops the run at the gate: no answer taken, no wait recorded', async (t) => {
  const { run, events } = newRun(t);
  const asked = run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'Continue?', timeout: '30ms', choices: [{ id: 'continue', label: 'Continue' }, { id: 'stop', label: 'Stop' }] });
  run.sessions.set('s1', { id: 's1', agent: 'dev', costUsd: 50, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } });
  await assert.rejects(asked, /Maximum cost exceeded/);
  assert.equal(events.some((e) => e.type === 'approval.resolved'), false, 'no approval.resolved');
  assert.equal(events.find((e) => e.type === 'limit.exceeded')?.limit, 'max_total_cost_usd');
  assert.equal(run.pendingGates().length, 0, 'the gate is closed: the run ends at it');
  assert.deepEqual(run.timingSummary().gates, {}, 'an answer that was not taken adds no wait to timing.gates');
});

test('#416 an owner\'s answer over the cost limit is received (resolveApproval returns true) and the gate rejects with the reason', async (t) => {
  const { run, events } = newRun(t);
  const asked = run.requestApproval({ id: 'test_failed', type: 'human_approval', message: 'Continue?' });
  t.mock.timers.tick(10 * H);
  run.sessions.set('s1', { id: 's1', agent: 'dev', costUsd: 50, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } });
  assert.equal(run.resolveApproval(lastAsked(events), true, 'owner'), true);
  await assert.rejects(asked, /Maximum cost exceeded \(US\$ 5\)/);
  assert.equal(events.some((e) => e.type === 'approval.resolved'), false);
  assert.equal(events.some((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_duration'), false, 'the 10h wait did not trip the duration');
});
