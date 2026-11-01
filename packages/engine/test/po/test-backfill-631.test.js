// #631: test-batch is renamed test-backfill. The Product Owner's Cost step (Economy) adds its after-stage
// item with test-backfill.yaml (packages/engine/domains/po/product-owner.js normalizeAnswer), and the
// roadmap treats a test-backfill item, and an old test-batch one, as testing the issues before it
// (packages/engine/domains/roadmap/roadmap.js testsLater).
const test = require('node:test');
const assert = require('node:assert/strict');
const productOwner = require('../../domains/po/product-owner');
const roadmap = require('../../domains/roadmap/roadmap');

const SW_DEV = 'software-development-local-hero.yaml';
const TEST_INPUTS = {
  unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run' },
  e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'write_and_run' },
  screenshots: { enum: ['off', 'changed', 'all'], default: 'all' },
};
const WORKFLOWS = [
  { file: SW_DEV, name: 'software-development-local-hero', inputs: { task: {}, ...TEST_INPUTS } },
  { file: 'test-backfill.yaml', name: 'test-backfill', inputs: { task: {} } },
];
const ISSUES = [{ number: 1, state: 'open', title: 'Login page', labels: [{ name: 'complexity:2' }], body: 'x'.repeat(200) }];
const ECONOMY = 1;

test('#631 the Cost step (Economy) follows the untested issues with a test-backfill.yaml item', () => {
  const raw = { summary: 'ok', groups: [{ name: 'One', issues: [1], workflow: SW_DEV, reason: 'r', stage: 1 }] };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: WORKFLOWS, workflow: SW_DEV, cost: ECONOMY });
  const files = out.groups.map((g) => g.workflow);
  assert.equal(files.includes('test-backfill.yaml'), true, `the groups' workflows: ${JSON.stringify(files)}`);
  assert.equal(files.includes('test-batch.yaml'), false);
});

test('#631 a test-backfill item tests the issues before it, and an old test-batch item still does', () => {
  assert.equal(roadmap.testsLater({ workflow: 'test-backfill.yaml' }), true);
  assert.equal(roadmap.testsLater({ workflow: 'workflows/test-backfill.yaml' }), true);
  assert.equal(roadmap.testsLater({ workflow: 'test-batch.yaml' }), true, 'a roadmap saved before the rename keeps working');
  assert.equal(roadmap.testsLater({ workflow: 'feature.yaml' }), false);
});
