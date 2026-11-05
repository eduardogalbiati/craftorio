// #785: an old item's `mode: validated` is the validation toggle's value: it never counts as a saved
// value that differs from the project's run mode, so "Use the project's values" leaves it.
const test = require('node:test');
const assert = require('node:assert/strict');
const WorkflowInputs = require('../workflow-inputs');

const DEFS = {
  mode: { enum: ['local', 'remote', 'fork'], default: 'local' },
  validation: { enum: ['auto', 'validated'], default: 'auto' },
};

test('#785 differing: an old validated mode is not a difference', () => {
  assert.deepEqual(WorkflowInputs.differing(DEFS, { mode: 'validated' }, { mode: 'fork' }), []);
});

test('#785 differing: a real run mode against the project\'s still is', () => {
  assert.deepEqual(WorkflowInputs.differing(DEFS, { mode: 'local' }, { mode: 'fork' }), ['mode']);
});

test('#785 differing: without a validation input, mode is an ordinary input', () => {
  assert.deepEqual(WorkflowInputs.differing({ mode: { enum: ['auto', 'validated'] } }, { mode: 'validated' }, { mode: 'auto' }), ['mode']);
});
