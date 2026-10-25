// workflows/issue-tracker.yaml: mode (#133) — validated (default) stops at the review gate as
// before; auto files the first draft straight away unless the writer found a duplicate, creates no
// missing label without a person, and never queues assign_workflow. Full flow in mock mode, the
// way test/engine.test.js's software-development mode tests do.
// Moved from test/issue-tracker.test.js by #306: its tests are whole mock runs of a bundled workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..', '..', '..', '..');

// Gates get `answers[step]` (default: the first choice), like --auto-approve.
async function runIssueTracker({ mockSequences, answers = {}, feedback = {}, inputs = {} } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'The run chat hides the gate when the window is small', project_path: root, ...inputs },
    mock: true,
    runsDir,
    mockSequences,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const a = answers[ev.step_id];
      const answer = Array.isArray(a) ? a.shift() ?? ev.choices[0].id : a ?? ev.choices[0].id;
      const f = feedback[ev.step_id];
      const text = Array.isArray(f) ? f.shift() : f;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', text));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompt = (stepId) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === stepId).map((e) => e.prompt).at(-1);
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished, transitions, prompt };
}

test('mode: validated (the default) still stops at the review gate exactly as before', { timeout: 60000 }, async () => {
  const { finished, transitions, events } = await runIssueTracker();
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['analyze>write', 'write>review', 'review>file', 'file>end']);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'review');
  assert.ok(gate);
  assert.deepEqual(gate.choices.map((c) => c.id), ['create', 'create_assign', 'revise', 'add_to', 'discard']);
  assert.doesNotMatch(gate.message, /Automatic mode stopped here/);
});

test('mode: auto files the first draft straight away: analyze -> write -> file, no gate, "Do: create"', { timeout: 60000 }, async () => {
  const { finished, transitions, events, prompt } = await runIssueTracker({ inputs: { mode: 'auto' } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['analyze>write', 'write>file', 'file>end']);
  assert.ok(!events.some((e) => e.type === 'approval.requested'), 'no human gate in auto mode');
  const filePrompt = prompt('file');
  assert.match(filePrompt, /Do: create\./);
  assert.doesNotMatch(filePrompt, /The owner chose:/);
});

test('mode: auto, but the writer found a possible duplicate (existing_issue != 0): stops at review instead of filing', { timeout: 60000 }, async () => {
  const { finished, transitions, events } = await runIssueTracker({
    inputs: { mode: 'auto' }, mockSequences: { existing_issue: [7] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['analyze>write', 'write>review', 'review>file', 'file>end']);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'review');
  assert.ok(gate);
  assert.match(gate.message, /Automatic mode stopped here: the writer found an existing issue \(#7\)/);
});

test('mode: auto creates no missing label (files with the existing ones, lists the rest as skipped)', { timeout: 60000 }, async () => {
  const { finished, prompt } = await runIssueTracker({ inputs: { mode: 'auto' } });
  assert.equal(finished.status, 'success', finished.error);
  const filePrompt = prompt('file');
  assert.match(filePrompt, /Create no label: nobody confirmed creating new ones\./);
  assert.doesNotMatch(filePrompt, /The owner confirmed creating/);
});

test('mode: validated creates the missing labels once the owner chose at the gate', { timeout: 60000 }, async () => {
  const { finished, prompt } = await runIssueTracker(); // mode defaults to validated; default answer: create
  assert.equal(finished.status, 'success', finished.error);
  const filePrompt = prompt('file');
  assert.match(filePrompt, /The owner confirmed creating these missing labels/);
  assert.doesNotMatch(filePrompt, /Create no label/);
});

test('mode: auto, a duplicate stops at review; revising sends it back to the writer, and the later draft is reviewed again even without a duplicate', { timeout: 60000 }, async () => {
  const { finished, transitions, events } = await runIssueTracker({
    inputs: { mode: 'auto' },
    mockSequences: { existing_issue: [7, 0] },
    answers: { review: ['revise', 'create'] },
    feedback: { review: ['Split the UI fix from the backend one.'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  // once the owner has seen a draft (visited review), every later draft is reviewed too (not refiled straight away)
  assert.deepEqual(transitions, ['analyze>write', 'write>review', 'review>write', 'write>review', 'review>file', 'file>end']);
  const reviewVisits = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'review');
  assert.equal(reviewVisits.length, 2);
  assert.match(reviewVisits[0].message, /Automatic mode stopped here/);
  assert.doesNotMatch(reviewVisits[1].message, /Automatic mode stopped here/); // the second visit has no duplicate
});
