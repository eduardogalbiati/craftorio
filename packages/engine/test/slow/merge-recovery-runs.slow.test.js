// #99 (scoped re-check after a local merge conflict) and #69 (merge conflicts: re-check before
// merging and go back in the flow), through mock runs. Split from test/merge-recovery.test.js
// (#305). Covers:
// - packages/engine/engine/workflow.js: `check:` / `precheck:` gates, the recovery route of a failed action
//   or check (recoverFromActionError / superviseActionError), and the merge queue's cross-run
//   withdrawal of an open gate.
// - workflows/feature.yaml: the scoped re-check after resolve_merge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.05';
const root = path.join(__dirname, '..', '..', '..', '..');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'merge-race.yaml');
const LOCAL_HERO = path.join(root, 'workflows', 'feature.yaml');

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

// ---- #99: workflows/feature.yaml, the scoped re-check (real prompts) --

// #826: these runs check the repository itself (repo_path: root). Two costs per run made the file
// pass the suite's 5-minute file timeout under load, none of which these tests assert on:
// - rule_check ran the project's real `npm run check` (7-10 s alone, twice per run): a trivial
//   check_command keeps the step (and its pass route) without linting the whole repository;
// - the code → tests map of the whole repository (seconds of synchronous CPU, writeTestMap) was
//   rebuilt by each run: the runs share the mock's per-folder cache, built once for the file.
const CHECK_COMMAND = 'node --version';
const sharedTestMaps = new Map();

// Runs the real local-hero workflow up to and including a failed local merge; gates get
// `answers[step]` (default: approve / first choice). `patchAgent` can replace a step's answer
// (e.g. to control an array-length field the generic mock can't vary).
async function runLocalHero(t, { mockSequences, answers = {}, patchAgent } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: LOCAL_HERO, inputs: { task: 'Engine test', repo_path: root, check_command: CHECK_COMMAND }, mock: true, runsDir, mockSequences });
  run.mockTestMaps = sharedTestMaps;
  // #380: the mock fills every optional string, so its resolve_merge answer always carries a
  // test_conflict (handed to the test writer); these scenarios are conflicts in code, not in tests
  const mocked = run.sendToAgent.bind(run);
  const original = async (agentName, prompt, opts = {}) => {
    const reply = await mocked(agentName, prompt, opts);
    if (opts.stepId !== 'resolve_merge') return reply;
    const json = /```json\s*([\s\S]*?)```/.exec(reply.text || '');
    if (!json) return reply;
    const { test_conflict: _ignored, ...out } = JSON.parse(json[1]);
    return { ...reply, text: `\`\`\`json\n${JSON.stringify(out)}\n\`\`\`` };
  };
  run.sendToAgent = patchAgent ? (agentName, prompt, opts) => patchAgent(agentName, prompt, opts, original) : original;
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
// #722: feature.yaml's whole local run (tests first, suite, e2e, push_main) took over 60 s under the
// coverage suite's load; the same budget as ai-development-test-conflict-380's runs
const RUN_TIMEOUT = 180000;

test('local-hero: a merge conflict re-checks only the resolution (review, tests, verify), then merges', { timeout: RUN_TIMEOUT }, async (t) => {
  const { finished, transitions, prompt } = await runLocalHero(t, {
    mockSequences: { action_errors: { verify_change: 1 }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceMerge(transitions), [
    'verify_change>resolve_merge', 'resolve_merge>code_review', 'code_review>test', 'test>build', 'build>verify_change', 'verify_change>push_main', 'push_main>end',
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

test('local-hero: a resolution touching many files runs the full suite, not a targeted one', { timeout: RUN_TIMEOUT }, async (t) => {
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
  assert.match(scopedTest, /the orchestrator runs the whole suite\s+next/);
  assert.doesNotMatch(scopedTest, /Run only the tests related to those files/);
});

test('local-hero: a resolution that changes behaviour goes through the full review, tests and verification again', { timeout: RUN_TIMEOUT }, async (t) => {
  const { finished, transitions, prompt } = await runLocalHero(t, {
    // behaviour_changed left at its default (true): the merge is not just combining both sides
    mockSequences: { action_errors: { verify_change: 1 }, blocked: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceMerge(transitions), [
    'verify_change>resolve_merge', 'resolve_merge>code_review', 'code_review>test', 'test>suite', 'suite>e2e', 'e2e>build', 'build>evidence', 'evidence>verify_change', 'verify_change>push_main', 'push_main>end',
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

test('local-hero: conflicts that keep recurring stop at merge_blocked after 3 rounds, never merged automatically', { timeout: 2 * RUN_TIMEOUT }, async (t) => {
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

