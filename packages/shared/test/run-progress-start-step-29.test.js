// #29: startStep (the step a run starts at, from an input's `starts`), workflowStations' `start`, and the
// workflow loader's check of `starts`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startStep, workflowStations } = require('../run-progress-model');

const steps = [{ id: 'tests' }, { id: 'warm_up' }, { id: 'develop' }, { id: 'review' }];
const inputs = { test_order: { default: 'e2e_first', starts: { code_first: 'warm_up' } } };

test('#29 startStep: the value\'s step, else the first step', () => {
  assert.equal(startStep({ steps, inputs, values: { test_order: 'code_first' } }), 'warm_up');
  assert.equal(startStep({ steps, inputs, values: { test_order: 'e2e_first' } }), 'tests');
  assert.equal(startStep({ steps, inputs, values: {} }), 'tests', 'the default has no start');
  assert.equal(startStep({ steps, inputs: { o: { default: 'x', starts: { x: 'develop' } } } }), 'develop', 'the default value starts too');
  assert.equal(startStep({ steps, inputs: { o: { starts: { x: 'gone' } } }, values: { o: 'x' } }), 'tests', 'a missing step is ignored');
  assert.equal(startStep({ steps: [] }), null);
});

test('#29 workflowStations: the start step\'s group leads, the rest keep their order', () => {
  const groups = [{ name: 'Tests', steps: ['tests'] }, { name: 'Develop', steps: ['warm_up', 'develop'] }, { name: 'Review', steps: ['review'] }];
  assert.deepEqual(workflowStations({ steps, groups, start: 'warm_up' }).map((s) => s.name), ['Develop', 'Tests', 'Review']);
  assert.deepEqual(workflowStations({ steps, groups, start: 'tests' }).map((s) => s.name), ['Tests', 'Develop', 'Review']);
  assert.deepEqual(workflowStations({ steps, groups }).map((s) => s.name), ['Tests', 'Develop', 'Review']);
});

test('#29 the workflow loader refuses a `starts` that names no step', (t) => {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || require('os').tmpdir(), 'starts-29-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const feature = path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml');
  assert.equal(loadWorkflow(feature).inputs.test_order.starts.code_first, 'warm_up');
  const text = fs.readFileSync(feature, 'utf8');
  assert.ok(text.includes('starts: { code_first: warm_up }'));
  fs.writeFileSync(path.join(dir, 'feature.yaml'), text.replace('starts: { code_first: warm_up }', 'starts: { code_first: nowhere }'));
  assert.throws(() => loadWorkflow(path.join(dir, 'feature.yaml')), /starts\.code_first names the step "nowhere"/);
});
