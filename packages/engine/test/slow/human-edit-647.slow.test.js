// #647 Write doc phase 1 (docs/work/write-doc/spec.md R9, R10): a whole simulated run through a
// `type: human_edit` gate. The public seam pinned here: `run.requestEdit(approvalId, text)` sends the
// person's request to the waiting human_edit gate; it becomes a turn of the step's agent (a
// session.message_sent of the step with the text in its prompt) and returns a promise that resolves
// when that turn ends. A request never ends the step: the gate stays pending. Only the person's
// answer (resolveApproval with the choice send_to_review, by 'user') moves the run on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { tempWorkflow, until } = require('../engine-helpers');

const YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: human-edit-run-647 }
agents:
  writer: { provider: claude, model: m, session: persistent }
steps:
  - id: draft
    agent: writer
    prompt: "Write the draft."
  - id: edit
    type: human_edit
    agent: writer
    message: "Edit the draft with the writer."
    choices:
      - { id: send_to_review, label: "Send to review" }
    transitions:
      - when: "choice == 'send_to_review'"
        goto: review
  - id: review
    agent: writer
    prompt: "Review the draft."
`;

function newRun(t) {
  const { file } = tempWorkflow(t, YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-647-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  let done = false;
  const started = run.start().finally(() => { done = true; });
  // a test that fails while the run waits at its gate stops it, so nothing is left running
  t.after(async () => { if (!done) { run.stop(); await started.catch(() => {}); } });
  return { run, events, started };
}

test('#647 a run reaching a human_edit step waits at a gate of that step; an edit request is a writer turn that does not end it', async (t) => {
  const { run, events } = newRun(t);
  await until(() => events.some((e) => e.type === 'approval.requested'));
  const gate = events.find((e) => e.type === 'approval.requested');
  assert.equal(gate.step_id, 'edit');

  await run.requestEdit(gate.approval_id, 'Shorten R2 to one sentence.');

  const turns = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'edit');
  assert.equal(turns.length, 1);
  assert.equal(String(turns[0].prompt).includes('Shorten R2 to one sentence.'), true);
  assert.deepEqual(run.pendingGates().map((g) => g.step_id), ['edit']);
  assert.equal(events.some((e) => e.type === 'step.finished' && e.step_id === 'edit'), false);
});

test('#647 only the person\'s Send to review ends the human_edit step and the run goes on to the review', async (t) => {
  const { run, events, started } = newRun(t);
  await until(() => events.some((e) => e.type === 'approval.requested'));
  const gate = events.find((e) => e.type === 'approval.requested');
  await run.requestEdit(gate.approval_id, 'Add an open question about the colour.');

  assert.equal(run.resolveApproval(gate.approval_id, 'send_to_review', 'user'), true);
  await started;

  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  assert.equal(transitions.includes('edit>review'), true, transitions.join(', '));
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
});
