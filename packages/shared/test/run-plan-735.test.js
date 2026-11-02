// #735: RunPlan (packages/shared/run-plan.js): a step's agents and the steps/agents that don't apply,
// on the workflow file's shape (agent_when) and on the app's describe() shape (`agents` list).
const test = require('node:test');
const assert = require('node:assert/strict');
const { agentsOf, stepsThatDontApply } = require('../run-plan');

const INPUTS = {
  ui_folders: { type: 'array', default: ['src/renderer/'] },
  screenshots: { type: 'string', default: 'all' },
  e2e_tests: { type: 'string', default: 'write_and_run' },
};

test('#735 agentsOf reads a step\'s agent_when keys', () => {
  assert.deepEqual(agentsOf({ id: 'code_review', agent_when: { ui_reviewer: 'x', security: 'y' } }), ['ui_reviewer', 'security']);
});

test('#735 agentsOf reads the agents list of describe()', () => {
  assert.deepEqual(agentsOf({ id: 'code_review', agents: ['reviewer', 'ui_reviewer'] }), ['reviewer', 'ui_reviewer']);
});

test('#735 agentsOf merges agent_when and agents without duplicates', () => {
  assert.deepEqual(agentsOf({ agent_when: { ui_reviewer: 'x' }, agents: ['reviewer', 'ui_reviewer'] }), ['ui_reviewer', 'reviewer']);
});

test('#735 agentsOf of a step without agents is empty', () => {
  assert.deepEqual([agentsOf({ id: 'develop' }).length, agentsOf(null).length], [0, 0]);
});

test('#735 on the describe() shape a backend run dims the UI reviewer with the no-UI reason', () => {
  const described = { inputs: INPUTS, steps: [{ id: 'develop' }, { id: 'code_review', agents: ['reviewer', 'ui_reviewer'] }] };
  const out = stepsThatDontApply(described, { ui_folders: [] });
  assert.deepEqual(out.map((s) => `${s.id}:${s.reason}`), ['ui_reviewer:run.doesnt_apply_no_ui']);
});

test('#735 with UI folders the UI reviewer applies', () => {
  const described = { inputs: INPUTS, steps: [{ id: 'code_review', agents: ['reviewer', 'ui_reviewer'] }] };
  assert.equal(stepsThatDontApply(described, { ui_folders: ['web/'] }).length, 0);
});

test('#735 an input turned off dims its step with the off reason (screenshots off, E2E write only)', () => {
  const wf = { inputs: INPUTS, steps: [{ id: 'developer_screenshots' }, { id: 'e2e' }, { id: 'testid_check' }] };
  const out = stepsThatDontApply(wf, { ui_folders: ['web/'], screenshots: 'off', e2e_tests: 'write' });
  assert.deepEqual(out.map((s) => `${s.id}:${s.reason}`), ['developer_screenshots:run.doesnt_apply_off', 'e2e:run.doesnt_apply_off']);
});
