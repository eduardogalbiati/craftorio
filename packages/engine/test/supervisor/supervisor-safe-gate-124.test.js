// #124 acceptance tests (written before the code): the supervisor on call answers an escalation gate by
// itself only with a safe answer.
// The bug: at feature's test_failed gate (recommend: stop), the supervisor routed `continue` ("the
// failures are preexisting", trusting another agent's report) and the run merged into main unverified.
// The rule these tests pin:
//   - safe answers only: the supervisor's own answer is applied without asking only when it is the gate's
//     recommended choice, or a choice that does not lead to a merge or push (stop, retry). Any other
//     choice (continue at test_failed against a `stop` recommendation) opens the gate for the owner
//     (approval.requested), with the supervisor's recommendation and reason on it; nothing merges;
//   - evidence, not a report: "the failures are preexisting" lets the supervisor answer alone only when
//     the engine itself confirmed every failure on the base (#211: the suite step's base check, its
//     `preexisting_failures`); another agent's claim, or a base check that confirmed only part of them,
//     is not enough;
//   - unchanged: `on_call: false` never calls the supervisor (the gate opens straight away).
// Seams: a WorkflowRun of a small inline workflow shaped like feature.yaml's suite → test_failed →
// verify (`merge: local`) path, the mock provider's simulated suite (mockSequences.suite: fail | mixed |
// base, packages/engine/engine/suite-step.js mockSuite) and the supervisor's answers scripted as in
// supervisor-on-call.test.js / supervisor-gate-answers-117.test.js (sendToAgent replaced). "Nothing
// merges" is read from the events: no `action.executed` with command `merge: local` (the simulated
// merge, run/transitions.js mergeWorktreeLocally), no `worktree.merged`, and the verify step never ran.
// Assumptions (loose, so the developer has latitude):
//   - a held-back supervisor answer still emits supervisor.decision (any action) before the gate opens;
//   - the gate's approval.requested event carries the supervisor's reason somewhere in its payload (the
//     message, `supervisor`, or `brief.recommendation`): asserted on the JSON of the whole event;
//   - the preexisting claim is read from the supervisor's explanation text (no new schema field needed;
//     a design that ignores the reason and only checks the engine's base confirmation passes too).
// Guards (may already be green): (b) the recommended answer, (c) a non-merging answer, (d) a preexisting
// claim the engine confirmed, and (f) on_call: false.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = process.env.CRAFTORIO_MOCK_DELAY_SCALE || '0.05';

const ONCALL = 'enabled: true, on_call: true, max_interventions: 2, max_total: 10';

// suite → test_failed (escalation, recommend: stop) → verify → merge: local, as in feature.yaml.
// `toGate` is the suite transition that leads to the gate (default: a red suite).
function wf({ supervisor = ONCALL, recommend = "stop: the change is not tested green; look at the failures, then resume the run.", toGate = "output.status == 'fail'" } = {}) {
  return `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-safe-gate-124 }
orchestrator:
  worktree: { repo: ".", base: main, remote: false }
  supervisor: { ${supervisor} }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "develop"
    output_schema:
      type: object
      required: [status]
      properties: { status: { type: string, enum: [success] } }
    transitions:
      - { when: "output.status == 'success'", goto: suite }
  - id: suite
    type: suite
    command: "npm test"
    transitions:
      - when: "${toGate}"
        goto: test_failed
      - when: "true"
        goto: verify
  - id: test_failed
    type: human_approval
    kind: escalation
    message: |
      The project's test suite still fails:
      {{ steps.suite.output | suite_failures }}
    recommend: "${recommend}"
    choices:
      - { id: continue, label: "Continue to the build anyway" }
      - { id: stop, label: "Stop the run" }
    transitions:
      - when: "choice == 'continue'"
        goto: verify
        set: { tested: "not green" }
      - when: "choice == 'stop'"
        goto: end
        status: failed
  - id: verify
    agent: a
    prompt: "verify"
    output_schema:
      type: object
      required: [verdict]
      properties: { verdict: { type: string, enum: [verified] } }
    transitions:
      - when: "output.verdict == 'verified'"
        merge: local
        goto: end
`;
}

// A gate whose recommended answer is retry, and whose other answer (stop) merges nothing.
const RETRY_GATE_WF = `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-safe-gate-retry-124 }
orchestrator:
  supervisor: { ${ONCALL} }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "develop"
    output_schema:
      type: object
      required: [status]
      properties: { status: { type: string, enum: [success, blocked] } }
    transitions:
      - { when: "output.status == 'success'", goto: end }
      - { when: "output.status == 'blocked'", goto: merge_blocked }
  - id: merge_blocked
    type: human_approval
    kind: escalation
    message: "Branch feature-124 could not be merged into the local main: the main checkout has uncommitted changes."
    recommend: "retry: commit or stash the changes in the main checkout, then retry the merge."
    choices:
      - { id: retry, label: "Retry the merge" }
      - { id: stop, label: "Stop the run as failed (branch kept to resume)" }
    transitions:
      - { when: "choice == 'retry'", goto: develop }
      - { when: "choice == 'stop'", goto: end, status: failed }
`;

// Runs `yaml` with the agents' answers and the supervisor's decisions scripted; any gate that opens is
// answered `answer` by the owner. Returns the events, the supervisor's prompts and the end.
async function runWith(t, yaml, { decisions = [], agents = {}, suite = ['fail'], answer = 'stop' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-gate-124-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  const r = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), mockSequences: { suite: { suite } } });
  const queue = [...decisions];
  const outs = { develop: [...(agents.develop || [{ status: 'success' }])], verify: [{ verdict: 'verified' }] };
  const prompts = [];
  r.sendToAgent = async (agent, prompt, opts = {}) => {
    if (agent === 'supervisor') {
      prompts.push(prompt);
      return { text: '```json\n' + JSON.stringify(queue.shift() || { explanation: 'give up', action: 'escalate' }) + '\n```' };
    }
    const list = String(opts.stepId || '').startsWith('verify') ? outs.verify : outs.develop;
    const out = list.length > 1 ? list.shift() : list[0];
    return { text: '```json\n' + JSON.stringify(out) + '\n```' };
  };
  const events = [];
  r.on('event', (e) => {
    events.push(e);
    if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, answer));
  });
  await r.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.ok(finished, 'the run finishes');
  return { events, prompts, finished };
}

const gateOf = (events, step = 'test_failed') => events.find((e) => e.type === 'approval.requested' && e.step_id === step) || null;
const merged = (events) => events.some((e) => (e.type === 'action.executed' && e.command === 'merge: local') || e.type === 'worktree.merged');
const verifyRan = (events) => events.some((e) => e.type === 'step.started' && e.step_id === 'verify');
const supervisorAsked = (events, step = 'test_failed') => events.some((e) => e.type === 'supervisor.started' && e.step_id === step);
const gateFinished = (events, step = 'test_failed') => events.find((e) => e.type === 'step.finished' && e.step_id === step) || null;

const CONTINUE_REASON = 'The failures look unrelated to the change; the build can go on.';
const PREEXISTING_REASON = 'The failures are preexisting: the test writer reported they fail on main too.';

// ---- (a) a merging answer against the gate's recommendation ---------------------------------------

test('#124 (a) test_failed recommends stop, the supervisor routes continue: the gate opens for the owner instead', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, wf(), {
    suite: ['fail'],
    decisions: [{ explanation: CONTINUE_REASON, action: 'route', route: 'continue', recommend: 'continue', recommendation: 'Continue: the failures are not about this change.' }],
  });
  assert.equal(supervisorAsked(events), true, 'the supervisor on call is asked first');
  const gate = gateOf(events);
  assert.ok(gate, 'approval.requested is emitted for test_failed: the owner is asked');
  const answered = gateFinished(events);
  assert.notEqual(answered?.output?.by, 'supervisor', `the gate is not answered by the supervisor: ${JSON.stringify(answered?.output)}`);
});

test('#124 (a) the gate the supervisor could not cross carries its recommendation and its reason', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, wf(), {
    suite: ['fail'],
    decisions: [{ explanation: CONTINUE_REASON, action: 'route', route: 'continue', recommend: 'continue', recommendation: 'Continue: the failures are not about this change.' }],
  });
  const gate = gateOf(events);
  assert.ok(gate, 'the gate opens');
  const payload = JSON.stringify(gate);
  assert.equal(payload.includes('The failures look unrelated to the change'), true, `the supervisor's reason is on the gate: ${payload.slice(0, 600)}`);
  assert.match(payload, /continue/, 'the supervisor\'s recommended answer is on the gate');
});

test('#124 (a) nothing merges when the supervisor routes continue at test_failed and the owner stops', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runWith(t, wf(), {
    suite: ['fail'],
    answer: 'stop',
    decisions: [{ explanation: CONTINUE_REASON, action: 'route', route: 'continue' }],
  });
  assert.equal(merged(events), false, 'no merge: local, no worktree.merged');
  assert.equal(verifyRan(events), false, 'the run never reaches the step that merges');
  assert.equal(finished.status, 'failed');
});

// ---- (b) the recommended answer: applied alone, and recorded ---------------------------------------

test('#124 (b) the supervisor routes the recommended stop: applied without asking, recorded as the supervisor\'s with its reason', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runWith(t, wf(), {
    suite: ['fail'],
    decisions: [{ explanation: 'The change breaks its own test; it needs the owner\'s look.', action: 'route', route: 'stop' }],
  });
  assert.equal(gateOf(events), null, 'no approval.requested');
  const answered = gateFinished(events);
  assert.equal(answered?.output?.choice, 'stop');
  assert.equal(answered?.output?.by, 'supervisor');
  const decision = events.find((e) => e.type === 'supervisor.decision' && e.step_id === 'test_failed');
  assert.equal(decision?.route, 'stop');
  assert.match(decision?.explanation || '', /breaks its own test/);
  assert.equal(merged(events), false);
  assert.equal(finished.status, 'failed');
});

test('#124 (b) a recommended answer that merges is still the supervisor\'s to take', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, wf({ recommend: 'continue: the failures are outside the change.' }), {
    suite: ['fail'],
    decisions: [{ explanation: 'As the gate recommends, the failures are outside the change.', action: 'route', route: 'continue' }],
  });
  assert.equal(gateOf(events), null, 'no approval.requested');
  assert.equal(gateFinished(events)?.output?.by, 'supervisor');
  assert.equal(verifyRan(events), true);
});

// ---- (c) a non-merging answer that is not the recommended one --------------------------------------

test('#124 (c) the gate recommends retry, the supervisor routes stop (merges nothing): applied alone', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runWith(t, RETRY_GATE_WF, {
    agents: { develop: [{ status: 'blocked' }] },
    decisions: [{ explanation: 'The checkout keeps uncommitted changes nobody can clear tonight.', action: 'route', route: 'stop' }],
  });
  assert.equal(gateOf(events, 'merge_blocked'), null, 'no approval.requested');
  assert.equal(gateFinished(events, 'merge_blocked')?.output?.by, 'supervisor');
  assert.equal(finished.status, 'failed');
});

test('#124 (c) at test_failed, the supervisor\'s retry (back to an agent step) is still applied alone', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, wf(), {
    suite: ['fail', 'pass'],
    decisions: [{ explanation: 'One more round of fixes should do it.', action: 'retry', instruction: 'Fix the failing test.' }],
  });
  const transition = events.find((e) => e.type === 'step.transition' && e.from === 'test_failed' && /supervisor on call: retry/.test(e.when || ''));
  assert.ok(transition, 'the run goes back to an agent step on the supervisor\'s word');
  assert.equal(gateOf(events), null, 'no approval.requested');
});

// ---- (d)/(e) "the failures are preexisting": evidence, not a report --------------------------------

test('#124 (d) "preexisting" with every failure confirmed on the base by the engine (#211): continue is applied alone', { timeout: 60000 }, async (t) => {
  // the simulated suite's `base` result: its failure fails on the simulated base too, so the engine
  // lists it in preexisting_failures and counts no failure of the run; the fixture still sends it to
  // the gate, to give the supervisor a red it can wave through with the engine's evidence
  const { events } = await runWith(t, wf({ toGate: "output.status == 'fail' or (output.preexisting_failures | length) > 0" }), {
    suite: ['base'],
    decisions: [{ explanation: 'The failures are preexisting: the engine\'s base check found them failing on main.', action: 'route', route: 'continue' }],
  });
  const suite = events.find((e) => e.type === 'step.finished' && e.step_id === 'suite');
  assert.equal((suite?.output?.preexisting_failures || []).length > 0, true, `the engine confirmed the failures on the base: ${JSON.stringify(suite?.output)}`);
  assert.equal(supervisorAsked(events), true, 'the gate is reached and the supervisor asked');
  assert.equal(gateOf(events), null, 'no approval.requested');
  assert.equal(gateFinished(events)?.output?.by, 'supervisor');
  assert.equal(verifyRan(events), true);
});

test('#124 (e) "preexisting" claimed by another agent, the engine confirmed only part of the failures: the gate opens', { timeout: 60000 }, async (t) => {
  // `mixed`: two failures, one confirmed on the base by the engine, one only red on the branch
  const { events, finished } = await runWith(t, wf(), {
    suite: ['mixed'],
    answer: 'stop',
    decisions: [{ explanation: PREEXISTING_REASON, action: 'route', route: 'continue', recommend: 'continue', recommendation: 'Continue: the failures are preexisting.' }],
  });
  const suite = events.find((e) => e.type === 'step.finished' && e.step_id === 'suite');
  assert.equal(suite?.output?.status, 'fail', 'one failure is the run\'s own');
  assert.ok(gateOf(events), 'approval.requested: the owner decides');
  assert.equal(gateFinished(events)?.output?.by === 'supervisor', false);
  assert.equal(merged(events), false);
  assert.equal(finished.status, 'failed');
});

test('#124 (e) "preexisting" with no failure confirmed on the base: the gate opens with the supervisor\'s claim on it', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, wf(), {
    suite: ['fail'],
    decisions: [{ explanation: PREEXISTING_REASON, action: 'route', route: 'continue' }],
  });
  const gate = gateOf(events);
  assert.ok(gate, 'approval.requested: the owner decides');
  assert.equal(JSON.stringify(gate).includes('the test writer reported they fail on main too'), true, 'the supervisor\'s reason is on the gate');
  assert.equal(verifyRan(events), false);
});

// ---- (f) on_call: false (guard) ---------------------------------------------------------------------

test('#124 (f) on_call: false: the supervisor is never asked at test_failed; the gate opens straight away', { timeout: 60000 }, async (t) => {
  const { events, prompts } = await runWith(t, wf({ supervisor: 'enabled: true, on_call: false' }), {
    suite: ['fail'],
    decisions: [{ explanation: CONTINUE_REASON, action: 'route', route: 'continue' }],
  });
  assert.equal(prompts.length, 0, 'no supervisor prompt');
  assert.equal(supervisorAsked(events), false);
  assert.ok(gateOf(events), 'approval.requested');
  assert.equal(merged(events), false);
});
