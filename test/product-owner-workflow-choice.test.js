// #235: the Product Owner plans for the workflow the owner chose (src/product-owner.js), never
// swapping it for another one.
// Seams: productOwner.normalizeAnswer(raw, { ..., workflow }) (the chosen workflow file, a new
// option next to defaultWorkflow) and productOwner.ask({ ..., mock: true, workflow, inputs }) (the
// simulated answer: no model call, no cost).
// - a chosen workflow is never replaced, whatever the answer proposed or the default is;
// - the Cost step (Economy ↔ Generous: unit_tests, e2e_tests, screenshots, the test-batch stage) is
//   not applied to ai-development-local-hero.yaml (tests first: its tests are always written), and
//   the plan's summary names no Cost step; software-development-local-hero.yaml keeps it as today;
// - skills/backlog-product-owner/SKILL.md says the workflow is fixed by the owner.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../src/product-owner');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const AI_DEV = 'ai-development-local-hero.yaml';
const SW_DEV = 'software-development-local-hero.yaml';
const TEST_INPUTS = {
  unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run' },
  e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'write_and_run' },
  screenshots: { enum: ['off', 'changed', 'all'], default: 'all' },
};
const WORKFLOWS = [
  { file: AI_DEV, name: 'ai-development-local-hero', inputs: { task: {}, ...TEST_INPUTS } },
  { file: SW_DEV, name: 'software-development-local-hero', inputs: { task: {}, ...TEST_INPUTS } },
  { file: 'test-batch.yaml', name: 'test-batch', inputs: { task: {} } },
];
const ISSUES = [
  { number: 1, state: 'open', title: 'Login page', labels: [{ name: 'complexity:2' }], body: 'x'.repeat(200) },
  { number: 2, state: 'open', title: 'Settings page', labels: [{ name: 'complexity:2' }], body: 'y'.repeat(200) },
];
const ECONOMY = 1;

test('#235 normalizeAnswer with a chosen workflow keeps every group on it: a group proposing another known workflow, or an unknown one, is moved to the chosen one, not to the default', () => {
  const raw = { summary: 'ok', groups: [
    { name: 'One', issues: [1], workflow: SW_DEV, reason: 'r', stage: 1 },
    { name: 'Two', issues: [2], workflow: 'nope.yaml', reason: 'r', stage: 1 },
  ] };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: WORKFLOWS, defaultWorkflow: SW_DEV, workflow: AI_DEV });
  assert.equal(out.groups.length, 2);
  assert.deepEqual(out.groups.map((g) => g.workflow), [AI_DEV, AI_DEV]);
});

test('#235 normalizeAnswer: the Cost step (Economy) is not applied to ai-development-local-hero.yaml: no cost record, inputs unchanged, no test-batch stage', () => {
  const raw = { summary: 'ok', groups: [
    { name: 'One', issues: [1], workflow: AI_DEV, inputs: { mode: 'auto' }, reason: 'r', stage: 1 },
    { name: 'Two', issues: [2], workflow: AI_DEV, inputs: { mode: 'auto' }, reason: 'r', stage: 1 },
  ] };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: WORKFLOWS, workflow: AI_DEV, cost: ECONOMY });
  assert.ok(out.groups.length >= 1);
  for (const g of out.groups) {
    assert.equal(g.workflow, AI_DEV, 'no test-batch.yaml stage is added');
    assert.equal(g.cost, undefined, `group "${g.name}" carries no Cost step`);
    assert.equal(g.inputs.unit_tests, undefined, 'the Cost step set no unit_tests');
    assert.equal(g.inputs.e2e_tests, undefined, 'the Cost step set no e2e_tests');
    assert.equal(g.inputs.screenshots, undefined, 'the Cost step set no screenshots');
    assert.equal(g.inputs.mode, 'auto');
  }
});

test('#235 normalizeAnswer: the Cost step (Economy) still applies to software-development-local-hero.yaml as today (its inputs, then a test-batch stage)', () => {
  const raw = { summary: 'ok', groups: [{ name: 'One', issues: [1], workflow: SW_DEV, reason: 'r', stage: 1 }] };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: WORKFLOWS, workflow: SW_DEV, cost: ECONOMY });
  const main = out.groups.find((g) => g.workflow === SW_DEV);
  assert.ok(main, 'the group stays on software-development-local-hero.yaml');
  assert.equal(main.cost?.name, 'Economy');
  assert.equal(main.inputs.unit_tests, 'run_existing');
  assert.equal(main.inputs.screenshots, 'off');
  assert.ok(out.groups.some((g) => g.workflow === 'test-batch.yaml'), 'a test-batch stage follows the untested issues');
});

test('#235 ask (simulated) with ai-development-local-hero.yaml chosen and an Economy cost: every group on it, and the plan\'s summary names no Cost step (no "Economy" or "Generous")', async (t) => {
  const dir = tmp(t);
  const out = await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    question: 'Analyze the backlog and propose runs',
    data: { projectId: 'demo', issues: ISSUES },
    activeRuns: [],
    runs: [],
    workflows: WORKFLOWS,
    defaultWorkflow: SW_DEV,
    mock: true,
    cost: ECONOMY,
    workflow: AI_DEV,
    inputs: {},
  });
  assert.ok(out.message.answer?.groups?.length, 'the simulated plan has groups');
  for (const g of out.message.answer.groups) assert.equal(g.workflow, AI_DEV);
  assert.doesNotMatch(out.message.text, /Economy|Generous/);
  assert.doesNotMatch(out.message.answer.summary, /Economy|Generous/);
});

test('#235 the backlog-product-owner skill says the workflow is chosen (fixed) by the owner', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'backlog-product-owner', 'SKILL.md'), 'utf8');
  assert.match(skill, /workflow[^.\n]*\b(chosen|fixed|picked)\b[^.\n]*\bowner\b|\bowner\b[^.\n]*\b(chose|chooses|chosen|picks|picked|fixes|fixed)\b[^.\n]*\bworkflow/i);
});

test('#235 normalizeAnswer: the drawer\'s options go into every group on the chosen workflow, over what the model proposed', () => {
  const raw = { summary: 'ok', groups: [{ name: 'One', issues: [1], workflow: AI_DEV, inputs: { mode: 'auto', e2e_tests: 'write' }, reason: 'r', stage: 1 }] };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: WORKFLOWS, workflow: AI_DEV, inputs: { e2e_tests: 'off', screenshots: 'changed' } });
  assert.deepEqual({ ...out.groups[0].inputs }, { mode: 'auto', e2e_tests: 'off', screenshots: 'changed' });
});

// Precedence on software-development-local-hero (reviewer): the drawer's options are applied first and
// the Cost chip's step then sets the inputs it manages; options the Cost step does not manage are kept.
test('#235 normalizeAnswer on software-development-local-hero with chosen options and an Economy cost: the Cost step sets the inputs it manages, the other chosen options are kept', () => {
  const raw = { summary: 'ok', groups: [{ name: 'One', issues: [1], workflow: SW_DEV, reason: 'r', stage: 1 }] };
  const opts = { issues: ISSUES, history: [], workflows: WORKFLOWS, workflow: SW_DEV, inputs: { unit_tests: 'off', mode: 'auto' } };
  const costed = productOwner.normalizeAnswer(raw, { ...opts, cost: ECONOMY }).groups.find((g) => g.workflow === SW_DEV);
  assert.equal(costed.inputs.unit_tests, 'run_existing');
  assert.equal(costed.inputs.mode, 'auto');
  const plain = productOwner.normalizeAnswer(raw, opts).groups.find((g) => g.workflow === SW_DEV);
  assert.equal(plain.inputs.unit_tests, 'off', 'without a Cost step the chosen option stays');
  assert.equal(plain.cost, undefined);
});

test('#235 lastWorkflow returns the workflow and options of the project\'s last plan question that chose one, null when none did', async (t) => {
  const dir = tmp(t);
  assert.equal(productOwner.lastWorkflow(dir, 'demo'), null);
  const base = { backlogDir: dir, projectId: 'demo', data: { projectId: 'demo', issues: ISSUES }, activeRuns: [], runs: [], workflows: WORKFLOWS, defaultWorkflow: SW_DEV, mock: true };
  await productOwner.ask({ ...base, question: 'Analyze the backlog and propose runs', workflow: SW_DEV, inputs: { mode: 'auto' } });
  await productOwner.ask({ ...base, question: 'Build a roadmap', workflow: AI_DEV, inputs: { e2e_tests: 'off' } });
  const last = productOwner.lastWorkflow(dir, 'demo');
  assert.equal(last.workflow, AI_DEV);
  assert.deepEqual({ ...last.inputs }, { e2e_tests: 'off' });
  assert.equal(productOwner.lastWorkflow(dir, 'other'), null, 'per project');
});
