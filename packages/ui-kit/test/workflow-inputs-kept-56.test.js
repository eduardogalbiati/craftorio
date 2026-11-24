// #56: the forms show a saved value that the enum no longer offers but the options still name (an earlier
// model), chosen; a new form offers the enum alone. `localized` keeps its name for the pills.
const test = require('node:test');
const assert = require('node:assert/strict');
const WorkflowInputs = require('../workflow-inputs');

const MODEL = { enum: ['m-new'], options: { 'm-new': 'New 2', 'm-old': 'Old 1' }, default: 'm-new', label: 'Model' };
const pills = (html) => [...html.matchAll(/data-wi-pill="([^"]*)" class="([^"]*)"/g)].map(([, v, c]) => [v, c]);

test('#56 pills: the saved kept value is there and chosen', () => {
  assert.deepEqual(pills(WorkflowInputs.fieldHtml('model', MODEL, { value: 'm-old' })), [['m-new', ''], ['m-old', 'active']]);
});

test('#56 pills: a new form offers the enum alone', () => {
  assert.deepEqual(pills(WorkflowInputs.fieldHtml('model', MODEL)), [['m-new', 'active']]);
});

test('#56 select: the saved kept value is selected', () => {
  const def = { ...MODEL, options: { ...MODEL.options, 'm-new': 'A label longer than a pill takes' } };
  assert.match(WorkflowInputs.fieldHtml('model', def, { value: 'm-old' }), /<option value="m-old" selected>Old 1<\/option>/);
});

test('#56 a localized workflow keeps the name of the kept value', () => {
  const wf = WorkflowInputs.localized({ file: 'x.yaml', origin: 'bundled', inputs: { model: MODEL }, steps: [] });
  assert.match(WorkflowInputs.inputPills(wf, { model: 'm-old' }), /Model: Old 1</);
});
