// #647 Write doc phase 1 (docs/work/write-doc/spec.md R9, R10): the engine's `type: human_edit` step, a
// human gate that takes the person's edit requests (each a turn of its named agent) while it waits;
// only the person ends it. It is a machine step type and one of the protected gates (FieldRules.GATE,
// exported), and the loader treats it as a gate: it takes `choices`, `recover:` cannot send the run
// back to it, and `kind: escalation` (the supervisor on call answers first) is refused on it.
// The whole simulated run is in test/slow/human-edit-647.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const FieldRules = require('../engine/run/field-rules');
const { loadWorkflow } = require('../engine/workflow');
const { tempWorkflow } = require('./engine-helpers');

const AGENTS = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: human-edit-647 }
agents:
  writer: { provider: claude, model: m, session: persistent }
steps:
`;

const EDIT_STEP = `  - id: edit
    type: human_edit
    agent: writer
    message: "Edit the draft with the writer."
    choices:
      - { id: send_to_review, label: "Send to review" }
    transitions:
      - when: "choice == 'send_to_review'"
        goto: approve
`;

const FLOW = `${AGENTS}  - id: draft
    agent: writer
    prompt: "Write the draft."
${EDIT_STEP}  - id: approve
    type: human_approval
    message: "Accept the document?"
`;

test('#647 human_edit is a machine step type', () => {
  assert.equal(FieldRules.MACHINE_STEP_TYPES.includes('human_edit'), true);
});

test('#647 the protected gates are human_approval and human_edit', () => {
  assert.equal(Array.isArray(FieldRules.GATE), true, 'FieldRules exports GATE');
  assert.deepEqual(['human_approval', 'human_edit'].map((type) => FieldRules.GATE.includes(type)), [true, true]);
});

test('#647 a workflow with an agent step, a human_edit step with choices and a human_approval loads', (t) => {
  const { file } = tempWorkflow(t, FLOW);
  const wf = loadWorkflow(file);
  assert.deepEqual(wf.steps.map((s) => s.type || 'agent'), ['agent', 'human_edit', 'human_approval']);
  assert.equal(wf.steps[1].agent, 'writer');
});

test('#647 recover cannot send the run back to a human_edit step, which is a gate and not an agent step', (t) => {
  const yaml = `${AGENTS}  - id: merge
    type: human_approval
    message: x
    check: { probe: pr_mergeable, target: "x", on_fail: edit, recover: [edit] }
    transitions: [{ when: approved, goto: end }]
  - id: edit
    type: human_edit
    agent: writer
    message: "Edit with the writer."
`;
  const { file } = tempWorkflow(t, yaml);
  assert.throws(() => loadWorkflow(file), /check\.recover must list agent steps \("edit" is not one\)/);
});

test('#647 a human_edit step cannot be an escalation gate the supervisor on call answers first', (t) => {
  const yaml = FLOW.replace('    message: "Edit the draft with the writer."\n', '    message: "Edit the draft with the writer."\n    kind: escalation\n');
  const { file } = tempWorkflow(t, yaml);
  assert.throws(() => loadWorkflow(file), /human_edit/);
});
