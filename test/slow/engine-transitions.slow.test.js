const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../src/engine/workflow');
const evidence = require('../../src/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { tempWorkflow, runWith } = require('../engine-helpers');

// #144: a `type: screenshots` step (`from` a step whose output lists the screens) never blocks the
// gate after it, whatever the list looks like. The mock provider always returns a valid entry for a
// field named exactly `screenshots` with `items.properties.args` (src/engine/providers.js), so these
// two fixtures shape develop's output_schema around that: without `args` the mock's generic object
// filler produces a name the step rejects (a bad name, not a reserved option, but the same path:
// checkEntry's error ends up in the step's `errors`); without a `screenshots` property at all,
// develop's output simply has none (a change without UI).
test('a screenshots step: an invalid entry (bad name) from the previous step still reaches the gate, with the error in the output', async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: shots-bad-entry }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: implement
    output_schema:
      type: object
      properties:
        screenshots:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              caption: { type: string }
  - id: shots
    type: screenshots
    from: develop
    folder: ui
  - id: gate
    type: human_approval
    message: "{{ steps.shots.output.message }}"
    transitions:
      - when: "approved"
        goto: end
`);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'shots');
  assert.equal(step.output.taken, 0);
  assert.equal(step.output.errors.length, 1);
  assert.match(step.output.errors[0].error, /name must be a plain file name/);
  assert.match(step.output.reason, /no valid entry in the developer's list/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'gate');
  assert.match(gate.message, /No screenshots: no valid entry in the developer's list; 1 error: .*name must be a plain file name/);
});
test('a screenshots step: an empty (no UI) list from the previous step skips the capture and still reaches the gate', async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: shots-empty }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: implement
    output_schema:
      type: object
      properties: {}
  - id: shots
    type: screenshots
    from: develop
    folder: ui
  - id: gate
    type: human_approval
    message: "{{ steps.shots.output.message }}"
    transitions:
      - when: "approved"
        goto: end
`);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'shots');
  assert.equal(step.output.taken, 0);
  assert.deepEqual(step.output.errors, []);
  assert.match(step.output.reason, /the developer listed no screens \(a change without UI\)/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'gate');
  assert.match(gate.message, /No screenshots: the developer listed no screens \(a change without UI\)/);
});
test('transition on_error: a failed action goes to the named step with action_error; without it the run fails', { timeout: 60000 }, async (t) => {
  const yaml = (onError) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: onerr }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    message: go?
    transitions:
      - when: "approved"
        action: node -e "process.exit(3)"
        goto: end
${onError ? '        on_error: fixup\n' : ''}      - when: "rejected"
        goto: end
  - id: fixup
    type: human_approval
    message: "failed: {{ action_error.message }}"
    transitions:
      - when: "approved"
        goto: end
      - when: "rejected"
        goto: end
        status: failed
`;
  const { dir, file } = tempWorkflow(t, yaml(true));
  const routed = await runWith(file, { mock: false, cwd: dir, answer: () => true });
  assert.equal(routed.finished.status, 'success', routed.finished.error);
  const fix = routed.events.find((e) => e.type === 'approval.requested' && e.step_id === 'fixup');
  assert.match(fix.message, /failed: Action failed \(exit 3\)/);
  assert.ok(routed.events.some((e) => e.type === 'step.transition' && e.from === 'gate' && e.to === 'fixup' && e.when === 'on_error'));

  fs.writeFileSync(file, yaml(false));
  const failed = await runWith(file, { mock: false, cwd: dir, answer: () => true });
  assert.equal(failed.finished.status, 'failed');
  assert.match(failed.finished.error, /Action failed \(exit 3\)/);
});
test('max_total_context: the run pauses before the next agent turn; Continue grants another block, Stop cancels', { timeout: 60000 }, async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: ctx }
inputs:
  task: { type: string }
  dir: { type: string }
orchestrator:
  limits: { max_total_context: 1k }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: one
    agent: a
    prompt: first
  - id: two
    agent: a
    prompt: second
  - id: three
    agent: a
    prompt: third
`);
  const go = await runWith(file, { mock: true, answer: () => 'continue' });
  assert.equal(go.finished.status, 'success', go.finished.error);
  const pauses = go.events.filter((e) => e.type === 'approval.requested' && /context_limit$/.test(e.step_id));
  // the first turn runs (nothing read yet); each later turn is past the allowance and asks
  assert.ok(pauses.length >= 1, 'paused at least once');
  assert.equal(pauses[0].step_id, 'two:context_limit');
  assert.match(pauses[0].message, /past its limit of 0\.0M/);
  assert.deepEqual(pauses[0].choices.map((c) => c.id), ['continue', 'stop']);
  assert.ok(go.events.some((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_context' && e.paused));

  const stop = await runWith(file, { mock: true, answer: () => 'stop' });
  assert.equal(stop.finished.status, 'cancelled');
  assert.ok(!stop.events.some((e) => e.type === 'step.started' && e.step_id === 'three'));
});
