// #99 (scoped re-check after a local merge conflict) and #69 (merge conflicts: re-check before
// merging and go back in the flow), through mock runs. Split from test/merge-recovery.test.js
// (#305). Covers:
// - packages/engine/engine/workflow.js: `check:` / `precheck:` gates, the recovery route of a failed action
//   or check (recoverFromActionError / superviseActionError), and the merge queue's cross-run
//   withdrawal of an open gate.
// workflows/feature.yaml's scoped re-check after resolve_merge is in merge-recovery-local-hero.slow.test.js
// (#737: split so no integration file takes over about 30 s).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');
const { runUntilStall } = require('../helpers/run-watch');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = process.env.CRAFTORIO_MOCK_DELAY_SCALE || '0.05';
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'merge-race.yaml');
// #737: a run with no event for this long fails at once, naming its step (helpers/run-watch.js)
const STALL_MS = 10000;

// ---- packages/engine/engine/workflow.js: `check:`/`precheck:` gates and their recovery route (fixture) -----

// Runs test/fixtures/merge-race.yaml; gates get `answers[step]` (default: approve / first choice).
async function runMergeRace(t, { prUrl, mockSequences, answers = {} } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  // "blocked" defaults to true (the mock provider's default for an unconstrained boolean): every
  // scenario here is the developer resolving the conflict, so pin it to false unless overridden.
  const seqs = { blocked: [false], ...mockSequences };
  const run = new WorkflowRun({ file: FIXTURE, inputs: { pr_url: prUrl }, mock: true, runsDir, mockSequences: seqs });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices ? ev.choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer));
    }
  });
  await runUntilStall(run, { stallMs: STALL_MS });
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  return { run, events, finished, transitions };
}

// #737: the runs are independent (each its own runsDir, no worktree): they run concurrently
describe('merge recovery runs (fixture)', { concurrency: true }, () => {
  test('check: a conflict found before the gate opens never asks for approval; the supervisor sends it to the recovery step', { timeout: 30000 }, async (t) => {
    const { events, finished, transitions } = await runMergeRace(t, {
      prUrl: 'https://github.com/acme/app/pull/101',
      mockSequences: { probes: { 'gate:check': ['conflict', 'passed'] } },
    });
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(transitions, ['gate>resolve', 'resolve>gate', 'gate>end']);
    // never asked for approval on a PR/MR the check already found not mergeable
    const gateApprovals = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'gate');
    assert.equal(gateApprovals.length, 1, 'only the second (mergeable) attempt asks for approval');
    const probe = events.find((e) => e.type === 'step.probe' && e.action === 'check');
    assert.equal(probe.state, 'conflict');
    assert.ok(events.some((e) => e.type === 'supervisor.started' && e.kind === 'action_error' && e.step_id === 'gate'));
    const decision = events.find((e) => e.type === 'supervisor.decision' && e.kind === 'action_error');
    assert.deepEqual([decision.action, decision.goto], ['goto', 'resolve']);
    assert.match(decision.record, /went back to resolve at \d\d:\d\d UTC because/);
    const resolvePrompt = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'resolve').prompt;
    assert.match(resolvePrompt, /could not be merged: .*cannot be merged \(conflict\): .*The approval was not asked/);
    assert.match(resolvePrompt, /State: conflict/);
    assert.match(resolvePrompt, /Supervisor: /);
  });

  test('check.on_fail without recover escalates straight to the gate, with no supervisor call', { timeout: 30000 }, async (t) => {
    // the fixture is CRLF in the working tree (docs/agents/windows-gotchas.md): normalize before the
    // literal replace, or it silently no-ops and leaves `recover:` in place.
    const yaml = fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n').replace('      on_fail: resolve\n      recover: [resolve]\n', '      on_fail: resolve\n');
    const file = path.join(os.tmpdir(), `merge-race-noRecover-${process.pid}.yaml`);
    fs.writeFileSync(file, yaml);
    t.after(() => fs.unlinkSync(file));
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
    const run = new WorkflowRun({
      file, inputs: { pr_url: 'https://github.com/acme/app/pull/102' }, mock: true, runsDir,
      // always a conflict: the recovery step never gets a mergeable PR/MR back, so every round
      // escalates straight to "resolve" again with no supervisor call at any point
      mockSequences: { probes: { 'gate:check': ['conflict'] } },
    });
    const events = [];
    run.on('event', (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
    });
    await runUntilStall(run, { stallMs: STALL_MS });
    const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
    assert.equal(transitions[0], 'gate>resolve');
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'gate'), 'the gate is never opened for a PR/MR the check found not mergeable');
    assert.ok(!events.some((e) => e.type === 'supervisor.started'), 'no recover: list, no supervisor call');
  });

  test('precheck: the merge action itself failing (not the check) still goes through the recovery route, never ends the run as failed', { timeout: 30000 }, async (t) => {
    const { events, finished, transitions } = await runMergeRace(t, {
      prUrl: 'https://github.com/acme/app/pull/103',
      mockSequences: { action_errors: { gate: 1 } },
    });
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(transitions, ['gate>resolve', 'resolve>gate', 'gate>end']);
    const gateApprovals = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'gate');
    assert.equal(gateApprovals.length, 2, 'approved once, the merge failed, approved again after the resolution');
    const err = events.find((e) => e.type === 'step.transition' && e.from === 'gate' && e.to === 'resolve');
    assert.ok(err);
    assert.ok(!events.some((e) => e.type === 'log' && /ended as failed/.test(e.message)));
  });

  test('a conflict that keeps recurring is capped at max_visits rounds, then reaches a human gate instead of looping or failing silently', { timeout: 30000 }, async (t) => {
    const { events, finished, transitions } = await runMergeRace(t, {
      prUrl: 'https://github.com/acme/app/pull/104',
      mockSequences: { probes: { 'gate:check': ['conflict', 'conflict', 'conflict'] } },
      answers: { blocked: false },
    });
    // 2 recovery rounds (max_visits: 2 on resolve>gate); the 3rd escalation is exhausted → "blocked"
    assert.deepEqual(transitions, ['gate>resolve', 'resolve>gate', 'gate>resolve', 'resolve>gate', 'gate>resolve', 'resolve>blocked', 'blocked>end']);
    assert.ok(events.some((e) => e.type === 'approval.requested' && e.step_id === 'blocked'));
    assert.equal(finished.status, 'failed');
  });

  // ---- cross-run: one merge at a time, the other run's open gate is withdrawn and recovers -------

  test('two runs racing for the same PR/MR: the second merges first, the first is withdrawn and recovers, then asks again', { timeout: 30000 }, async (t) => {
    const prUrl = 'https://github.com/acme/app/pull/105'; // same target: same merge-queue key for both runs
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));

    const runA = new WorkflowRun({
      file: FIXTURE, inputs: { pr_url: prUrl }, mock: true, runsDir,
      mockSequences: { blocked: [false], probes: { 'gate:check': ['passed', 'conflict', 'passed'] } },
    });
    const runB = new WorkflowRun({
      file: FIXTURE, inputs: { pr_url: prUrl }, mock: true, runsDir,
      mockSequences: { blocked: [false], probes: { 'gate:check': ['passed'] } },
    });

    const eventsA = [];
    const eventsB = [];
    // A's gate opens and stays open (no auto-approval) until B has merged and withdrawn it once;
    // its second approval request (after the resolution) is answered normally.
    let aGateOpens = 0;
    let resolveGateOpen;
    const gateOpen = new Promise((resolve) => { resolveGateOpen = resolve; });
    runA.on('event', (ev) => {
      eventsA.push(ev);
      if (ev.type === 'approval.requested' && ev.step_id === 'gate') {
        aGateOpens++;
        if (aGateOpens === 1) resolveGateOpen();
        else setImmediate(() => runA.resolveApproval(ev.approval_id, true));
      }
    });
    runB.on('event', (ev) => {
      eventsB.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => runB.resolveApproval(ev.approval_id, true));
    });

    const doneA = runA.start();
    await gateOpen; // A's gate is open (and its merge-queue listener registered) before B merges
    await runB.start();
    await doneA;

    const transitionsA = eventsA.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
    assert.deepEqual(transitionsA, ['gate>resolve', 'resolve>gate', 'gate>end']);
    const withdrawn = eventsA.find((e) => e.type === 'approval.resolved' && e.withdrawn);
    assert.ok(withdrawn, 'A\'s open approval was withdrawn once B merged');
    assert.match(withdrawn.reason, /conflict/);
    assert.equal(eventsA.filter((e) => e.type === 'approval.requested' && e.step_id === 'gate').length, 2);
    assert.equal(eventsA.find((e) => e.type === 'workflow.finished').status, 'success');
    assert.equal(eventsB.find((e) => e.type === 'workflow.finished').status, 'success');
  });
});
