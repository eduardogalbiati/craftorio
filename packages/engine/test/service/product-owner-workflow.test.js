// #235: packages/engine/service/channels/product-owner.js po:ask plans for the workflow the owner chose in the
// drawer. New payload fields: `workflow` (a workflow file that takes a task) and `inputs` (the
// owner's choices for its inputs, merged into every proposed group's inputs).
// The test workspace always runs with CRAFTORIO_SIMULATION_ONLY=1 (docs/agents/testing.md): po:ask
// answers from the simulated Product Owner, whose groups use the default development workflow
// (software-development-local-hero.yaml) unless the chosen one is honoured: no model is called.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, roadmapProject } = require('./helpers');

const AI_DEV = 'feature.yaml';
const SW_DEV = 'feature.yaml';

async function setup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const files = (await api['workflows:list']()).map((w) => w.file);
  assert.ok(files.includes(AI_DEV) && files.includes(SW_DEV), 'the bundled development workflows are in the test workspace');
  const p = await roadmapProject(api, ws, t, [1, 2, 3], name);
  return { api, p };
}

test('#235 po:ask with a chosen workflow and inputs: every proposed group is on that workflow, with the chosen inputs merged into its inputs', async (t) => {
  const { api, p } = await setup(t, 'po-wf-chosen');
  const out = await api['po:ask']({
    projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true, mode: 'plan', attachments: [], issues: [],
    workflow: AI_DEV, inputs: { language: 'python', e2e_tests: 'off' },
  });
  const groups = out.message.answer?.groups || [];
  assert.ok(groups.length >= 1, 'the simulated plan has groups');
  for (const g of groups) {
    assert.equal(g.workflow, AI_DEV, `group "${g.name}" stays on the chosen workflow`);
    assert.equal(g.inputs.language, 'python');
    assert.equal(g.inputs.e2e_tests, 'off');
  }
});

test('#235 po:ask with ai-development-local-hero.yaml chosen and an Economy cost: no group carries a Cost step, no test-batch stage, and the answer names no Cost step', async (t) => {
  const { api, p } = await setup(t, 'po-wf-cost');
  const out = await api['po:ask']({
    projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true, mode: 'plan', attachments: [], issues: [],
    cost: 1, workflow: AI_DEV, inputs: {},
  });
  const groups = out.message.answer?.groups || [];
  assert.ok(groups.length >= 1);
  for (const g of groups) {
    assert.equal(g.workflow, AI_DEV, 'no test-backfill.yaml stage');
    assert.equal(g.cost, undefined, `group "${g.name}" carries no Cost step`);
  }
  assert.doesNotMatch(out.message.text, /Economy|Generous/);
});

test('#235 po:ask without a chosen workflow plans on the default development workflow as before (guard)', async (t) => {
  const { api, p } = await setup(t, 'po-wf-default');
  const out = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true, mode: 'plan', attachments: [], issues: [] });
  const groups = out.message.answer?.groups || [];
  assert.ok(groups.length >= 1);
  for (const g of groups) assert.equal(g.workflow, SW_DEV);
});
