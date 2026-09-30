// #99 (scoped re-check after a local merge conflict) and #69 (merge conflicts at approve_merge:
// re-check before merging and go back in the flow). Covers:
// - src/engine/merge-queue.js: one merge at a time per repository, the `merged` notification.
// - src/engine/probes.js: mergeableState (the `pr_mergeable` probe behind `check:`/`precheck:`).
// - src/engine/workflow.js: `check:` / `precheck:` gates, the recovery route of a failed action
//   or check (recoverFromActionError / superviseActionError), and the merge queue's cross-run
//   withdrawal of an open gate.
// - workflows/software-development-local-hero.yaml: the scoped re-check after resolve_merge.
// - workflows/software-development.yaml: the recovery path after approve_merge / merge_failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
const mergeQueue = require('../src/engine/merge-queue');
const { mergeableState } = require('../src/engine/probes');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.05';
const root = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'merge-race.yaml');
const LOCAL_HERO = path.join(root, 'workflows', 'software-development-local-hero.yaml');
const SOFTWARE_DEV = path.join(root, 'workflows', 'software-development.yaml');

// ---- src/engine/merge-queue.js: the seam a `check:`/`precheck:` merge goes through -------------

test('merge-queue: serialize() runs tasks for the same key one after another; different keys run concurrently', async () => {
  const order = [];
  const step = (key, label, ms) => mergeQueue.serialize(key, async () => {
    order.push(`${label}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${label}:end`);
    return label;
  });
  const sameKey = Promise.all([step('repo/a', 'a1', 30), step('repo/a', 'a2', 5)]);
  const otherKey = step('repo/b', 'b1', 5);
  const [[a1, a2], b1] = await Promise.all([sameKey, otherKey]);
  assert.deepEqual([a1, a2], ['a1', 'a2']);
  assert.equal(b1, 'b1');
  // a2 only starts once a1 finished, even though a1 is the slower task
  assert.deepEqual(order.filter((x) => x.startsWith('a')), ['a1:start', 'a1:end', 'a2:start', 'a2:end']);
  // the other key's task was not held up by repo/a's queue
  assert.ok(order.indexOf('b1:start') < order.indexOf('a1:end'));
});

test('merge-queue: a failed merge does not block the next one queued for the same key', async () => {
  const key = 'repo/failing';
  await assert.rejects(mergeQueue.serialize(key, async () => { throw new Error('boom'); }), /boom/);
  const result = await mergeQueue.serialize(key, async () => 'ok');
  assert.equal(result, 'ok');
});

test('merge-queue: onMerged notifies listeners of the same key only, and the unsubscribe works', () => {
  const seenA = [];
  const seenB = [];
  const offA = mergeQueue.onMerged((m) => seenA.push(m));
  const offB = mergeQueue.onMerged((m) => seenB.push(m));
  offB();
  mergeQueue.notifyMerged({ key: 'repo/x', runId: 'r1' });
  mergeQueue.notifyMerged({ key: 'repo/y', runId: 'r2' });
  assert.deepEqual(seenA, [{ key: 'repo/x', runId: 'r1' }, { key: 'repo/y', runId: 'r2' }]);
  assert.deepEqual(seenB, []);
  offA();
  mergeQueue.notifyMerged({ key: 'repo/z', runId: 'r3' });
  assert.deepEqual(seenA, [{ key: 'repo/x', runId: 'r1' }, { key: 'repo/y', runId: 'r2' }]);
});

// ---- src/engine/probes.js: mergeableState, the deterministic check behind pr_mergeable ---------

test('mergeableState: a conflict or a failed/pending/merged/closed state passes through unchanged', () => {
  assert.equal(mergeableState({ state: 'conflict', detail: 'x', head: 'h' }).state, 'conflict');
  for (const state of ['merged', 'closed', 'failed', 'pending']) {
    assert.deepEqual(mergeableState({ state, detail: 'd', head: 'h' }), { state, detail: 'd', head: 'h' });
  }
});

test('mergeableState: GitHub mergeStateStatus decides behind/blocked/pending on an otherwise open PR', () => {
  const open = { state: 'none', detail: 'no check registered on the head commit yet', head: 'h' };
  assert.equal(mergeableState(open, { mergeState: 'BEHIND' }).state, 'behind');
  assert.equal(mergeableState(open, { mergeState: 'BLOCKED' }).state, 'blocked');
  assert.equal(mergeableState(open, { mergeState: 'UNKNOWN' }).state, 'pending');
  const passed = mergeableState(open, { mergeState: 'CLEAN' });
  assert.equal(passed.state, 'passed');
  assert.match(passed.detail, /mergeable, no check registered/);
});

test('mergeableState: GitLab detailed_merge_status decides behind/blocked/pending the same way', () => {
  const open = { state: 'none', detail: 'no pipeline registered on the head commit yet', head: 'h' };
  assert.equal(mergeableState(open, { glStatus: 'need_rebase' }).state, 'behind');
  assert.equal(mergeableState(open, { glStatus: 'not_approved' }).state, 'blocked');
  assert.equal(mergeableState(open, { glStatus: 'discussions_not_resolved' }).state, 'blocked');
  assert.equal(mergeableState(open, { glStatus: 'checking' }).state, 'pending');
  assert.equal(mergeableState(open, { glStatus: 'mergeable' }).state, 'passed');
});

// ---- loadWorkflow validates check: / precheck: / recover: --------------------------------------

test('loadWorkflow validates check:, precheck: and recover:', () => {
  const tmp = path.join(os.tmpdir(), `wf-check-${process.pid}.yaml`);
  const base = (extra) => `agents: { a: { provider: claude, model: m } }\nsteps:\n${extra}`;
  const write = (yaml) => fs.writeFileSync(tmp, yaml);
  try {
    // check: only on a human_approval step
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    check: { probe: pr_mergeable, target: "x" }\n'));
    assert.throws(() => loadWorkflow(tmp), /check is only valid for human_approval/);

    // check: needs a known probe and a target
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: nope, target: "x" }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check needs a probe .* and a target/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check needs a probe .* and a target/);

    // check.on_fail points to a real step
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: nope }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /points to unknown step "nope"/);

    // check.recover: a non-empty list, only with a failure route, only agent steps
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", recover: [] }\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover must be a non-empty list of steps/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    agent: a\n    prompt: x\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover needs a failure route/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: fix, recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /check.recover must list agent steps \("fix" is not one\)/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x", on_fail: fix, recover: [fix] }\n    transitions: [{ when: approved, goto: end }]\n  - id: fix\n    agent: a\n    prompt: x\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));

    // precheck: true reuses the step's own check
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, precheck: true, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /precheck: true reuses the step's check, which it does not have/);
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    check: { probe: pr_mergeable, target: "x" }\n    transitions: [{ when: approved, precheck: true, goto: end }]\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));

    // precheck: an object needs a probe and a target, same as check:
    write(base('  - id: s1\n    type: human_approval\n    message: x\n    transitions: [{ when: approved, precheck: { probe: pr_mergeable }, goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /precheck needs a probe .* and a target/);

    // a transition's recover: same rules as check.recover, against on_error
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    transitions: [{ when: "true", action: x, recover: [s1], goto: end }]\n'));
    assert.throws(() => loadWorkflow(tmp), /transition.recover needs a failure route/);
    write(base('  - id: s1\n    agent: a\n    prompt: x\n    transitions: [{ when: "true", action: x, on_error: s1, recover: [s1], goto: end }]\n'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ---- src/engine/workflow.js: `check:`/`precheck:` gates and their recovery route (fixture) -----

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
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  return { run, events, finished, transitions };
}

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
  await run.start();
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

// ---- #99: workflows/software-development-local-hero.yaml, the scoped re-check (real prompts) --

// Runs the real local-hero workflow up to and including a failed local merge; gates get
// `answers[step]` (default: approve / first choice). `patchAgent` can replace a step's answer
// (e.g. to control an array-length field the generic mock can't vary).
async function runLocalHero(t, { mockSequences, answers = {}, patchAgent } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: LOCAL_HERO, inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir, mockSequences });
  if (patchAgent) {
    const original = run.sendToAgent.bind(run);
    run.sendToAgent = (agentName, prompt, opts) => patchAgent(agentName, prompt, opts, original);
  }
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices ? ev.choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompt = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  return { run, events, finished, transitions, prompt };
}

// The slice of `transitions` from the failed merge onward (the happy path up to it is covered by
// test/engine.test.js's own local-hero test).
const sinceMerge = (transitions) => transitions.slice(transitions.indexOf('verify_change>resolve_merge'));

test('local-hero: a merge conflict re-checks only the resolution (review, tests, verify), then merges', { timeout: 60000 }, async (t) => {
  const { finished, transitions, prompt } = await runLocalHero(t, {
    mockSequences: { action_errors: { verify_change: 1 }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceMerge(transitions), [
    'verify_change>resolve_merge', 'resolve_merge>code_review', 'code_review>test', 'test>build', 'build>verify_change', 'verify_change>end',
  ]);

  const scopedReview = prompt('code_review').at(-1);
  assert.match(scopedReview, /Review the RESOLUTION of a merge conflict on branch/);
  assert.match(scopedReview, /already reviewed, tested and verified at commit `\(simulated\) previous_head`/);
  assert.match(scopedReview, /rebased the branch onto it\s*\n\s*\(now `\(simulated\) head`\)/);
  assert.match(scopedReview, /git range-diff .*\(simulated\) previous_head/);
  assert.doesNotMatch(scopedReview, /This run implements/); // the per-issue instructions are skipped when scoped

  const scopedTest = prompt('test').at(-1);
  assert.match(scopedTest, /Run only the tests related to those files/);
  assert.match(scopedTest, /plus a fast smoke check/);
  assert.doesNotMatch(scopedTest, /Write the tests the change needs/);

  const scopedVerify = prompt('verify_change').at(-1);
  assert.match(scopedVerify, /You already verified this change:/);
  assert.match(scopedVerify, /Re-check only the claims \(issues\) whose evidence depends on those files/);
});

test('local-hero: a resolution touching many files runs the full suite, not a targeted one', { timeout: 60000 }, async (t) => {
  const manyFiles = Array.from({ length: 6 }, (_, i) => `src/file${i}.js`);
  const { finished, prompt } = await runLocalHero(t, {
    mockSequences: { action_errors: { verify_change: 1 } },
    patchAgent: (agentName, p, opts, original) => {
      if (opts.stepId !== 'resolve_merge') return original(agentName, p, opts);
      const out = { resolved: true, blocked: false, summary: 'Resolved a wide conflict.', files_changed: manyFiles, behaviour_changed: false, previous_head: 'abc0001', head: 'def0002' };
      return Promise.resolve({ text: `\`\`\`json\n${JSON.stringify(out)}\n\`\`\`` });
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const scopedTest = prompt('test').at(-1);
  assert.match(scopedTest, /touched many files/);
  assert.match(scopedTest, /Run the full suite once/);
  assert.doesNotMatch(scopedTest, /Run only the tests related to those files/);
});

test('local-hero: a resolution that changes behaviour goes through the full review, tests and verification again', { timeout: 60000 }, async (t) => {
  const { finished, transitions, prompt } = await runLocalHero(t, {
    // behaviour_changed left at its default (true): the merge is not just combining both sides
    mockSequences: { action_errors: { verify_change: 1 }, blocked: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceMerge(transitions), [
    'verify_change>resolve_merge', 'resolve_merge>code_review', 'code_review>test', 'test>build', 'build>evidence', 'evidence>verify_change', 'verify_change>end',
  ]);
  const fullReview = prompt('code_review').at(-1);
  assert.doesNotMatch(fullReview, /Review the RESOLUTION of a merge conflict/);
  assert.match(fullReview, /Review the changes on branch/);
  const fullTest = prompt('test').at(-1);
  assert.doesNotMatch(fullTest, /Run only the tests related to those files/);
  assert.doesNotMatch(fullTest, /Run the full suite once\./);
  assert.match(fullTest, /Write the tests the change needs/);
  const fullVerify = prompt('verify_change').at(-1);
  assert.doesNotMatch(fullVerify, /Re-check only the claims/);
});

test('local-hero: conflicts that keep recurring stop at merge_blocked after 3 rounds, never merged automatically', { timeout: 90000 }, async (t) => {
  const { finished, transitions, events } = await runLocalHero(t, {
    mockSequences: { action_errors: { verify_change: 4 }, blocked: [false], behaviour_changed: [false] },
    answers: { merge_blocked: 'stop' },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "merge_blocked"/);
  assert.equal(sinceMerge(transitions).filter((x) => x === 'resolve_merge>code_review').length, 3, 'max_visits: 3 successful rounds back to code_review');
  assert.deepEqual(sinceMerge(transitions).slice(-3), ['verify_change>resolve_merge', 'resolve_merge>merge_blocked', 'merge_blocked>end']);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'merge_blocked');
  assert.deepEqual(gate.choices.map((c) => c.id), ['retry', 'stop']);
  // the gate is a real human_approval: the run only ends once it is answered, never bypassed
  assert.ok(events.indexOf(gate) < events.indexOf(finished));
});

// ---- #69: workflows/software-development.yaml, the recovery path around approve_merge ----------

// Runs the real software-development workflow; gates get `answers[step]` (default: approve /
// first choice). `patchAgent` can replace a step's answer, as in runLocalHero.
async function runSoftwareDev(t, { mockSequences, answers = {}, patchAgent } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: SOFTWARE_DEV, inputs: { task: 'Engine test', repo_path: root },
    mock: true, runsDir, mockSequences: { preview_status: ['success'], ...mockSequences },
  });
  if (patchAgent) {
    const original = run.sendToAgent.bind(run);
    run.sendToAgent = (agentName, prompt, opts) => patchAgent(agentName, prompt, opts, original);
  }
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices ? ev.choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompt = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  return { run, events, finished, transitions, prompt };
}

const sinceApprove = (transitions) => transitions.slice(transitions.findIndex((x) => x.startsWith('deploy_test>')));

test('software-development: approve_merge shows the PR state and when it was checked, and says it checks again on approval', { timeout: 180000 }, async (t) => {
  const { finished, events } = await runSoftwareDev(t, {
    mockSequences: { behaviour_changed: [false] }, // no conflict: the default probe state is "passed"
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge');
  assert.match(gate.message, /CI green and mergeable \(\(simulated\) pr_mergeable: passed\)/);
  assert.match(gate.message, /checked at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(gate.message, /It is checked again when you approve/);
});

test('software-development: a conflict found right before approve_merge opens recovers through resolve_conflict, then asks for approval again', { timeout: 180000 }, async (t) => {
  const { finished, transitions, prompt, events } = await runSoftwareDev(t, {
    mockSequences: { probes: { 'approve_merge:check': ['conflict', 'passed'] }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceApprove(transitions), [
    'deploy_test>approve_merge', 'approve_merge>resolve_conflict', 'resolve_conflict>code_review',
    'code_review>test', 'test>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge', 'approve_merge>deploy_prod',
    'deploy_prod>deploy_prod', 'deploy_prod>end',
  ]);
  // never asked for approval on a PR/MR the check already found not mergeable
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').length, 1);
  assert.ok(events.some((e) => e.type === 'supervisor.started' && e.kind === 'action_error' && e.step_id === 'approve_merge'));
  const decision = events.find((e) => e.type === 'supervisor.decision' && e.kind === 'action_error');
  assert.deepEqual([decision.action, decision.goto], ['goto', 'resolve_conflict']);

  const resolvePrompt = prompt('resolve_conflict').at(-1);
  assert.match(resolvePrompt, /was not merged into `main`/);
  assert.match(resolvePrompt, /State checked by the orchestrator at .*: conflict/);
  assert.match(resolvePrompt, /git merge origin\/main/);

  const scopedReview = prompt('code_review').at(-1);
  assert.match(scopedReview, /Review the RESOLUTION of a merge conflict on branch/);
  assert.match(scopedReview, /git show --remerge-diff \(simulated\) merge_commit/);
  assert.match(scopedReview, /git log --oneline \(simulated\) merge_commit\.\./);
  assert.doesNotMatch(scopedReview, /This run implements/);

  const scopedTest = prompt('test').at(-1);
  assert.match(scopedTest, /Your tests already passed on this change/);
  assert.match(scopedTest, /Check out the branch \(pull it: the developer pushed\) and run the full suite once/);
  assert.doesNotMatch(scopedTest, /Write the tests the change needs/);

  // the second approval shows the branch changed since the last one
  const secondGate = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').at(-1);
  assert.match(secondGate.message, /The branch changed after your last approval: a merge conflict with main was resolved/);

  // deploy_test retriggers the preview publication (it was reached via pr_babysitter, not straight after itself)
  const deployPrompts = prompt('deploy_test');
  assert.match(deployPrompts.at(-1), /Trigger the preview publication/);
});

test('software-development: the merge action itself failing (not the check) still recovers, never ends the run as failed', { timeout: 180000 }, async (t) => {
  const { finished, transitions, events } = await runSoftwareDev(t, {
    mockSequences: { action_errors: { approve_merge: 1 }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceApprove(transitions), [
    'deploy_test>approve_merge', 'approve_merge>resolve_conflict', 'resolve_conflict>code_review',
    'code_review>test', 'test>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge', 'approve_merge>deploy_prod',
    'deploy_prod>deploy_prod', 'deploy_prod>end',
  ]);
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').length, 2, 'approved once, the merge failed, approved again after the resolution');
  assert.ok(!events.some((e) => e.type === 'log' && /ended as failed/.test(e.message)));
});

test('software-development: 2 resolution rounds that stay conflicted reach the merge_failed gate, never merged automatically', { timeout: 180000 }, async (t) => {
  const { finished, transitions, events } = await runSoftwareDev(t, {
    mockSequences: { probes: { 'approve_merge:check': ['conflict'] }, blocked: [false], behaviour_changed: [false] },
    answers: { merge_failed: 'stop' },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "merge_failed"/);
  assert.equal(sinceApprove(transitions).filter((x) => x === 'resolve_conflict>code_review').length, 2, 'max_visits: 2 on resolve_conflict');
  assert.ok(sinceApprove(transitions).slice(-2).includes('resolve_conflict>merge_failed'));
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'merge_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['retry', 'resolve', 'stop']);
});
