// #792: DefaultWorkflow.runEnding reads the same mode the run gets (backlog.runInputs, then aliasInputs
// and the engine's resolveInputs), and RunProgress.groupName is the one translation of the PR station.
const test = require('node:test');
const assert = require('node:assert/strict');
const { aliasOf, runEnding } = require('../default-workflow');
const { resolveRunInputs } = require('../run-inputs');
const { OPEN_PR, groupName } = require('../run-progress-model');

const feature = { merge: 'local', inputs: { mode: { enum: ['local', 'remote', 'fork'], default: 'local' }, validation: { enum: ['auto', 'validated'] } } };
const endOf = (saved, project, alias = null) => runEnding(feature, resolveRunInputs({ roadmap: saved, project, workflow: feature }), alias);

test('#792 an old `mode: auto` is the item\'s value: it hides the project\'s mode and the run takes the workflow\'s default', () => {
  assert.equal(endOf({ mode: 'auto' }, { mode: 'remote' }), 'local');
});

test('#792 a blank mode hides nothing: the project\'s mode decides', () => {
  assert.equal(endOf({ mode: '' }, { mode: 'remote' }), 'pr');
  assert.equal(endOf({ mode: '  ' }, { mode: 'fork' }), 'fork');
});

test('#792 the item\'s own mode wins over the project\'s, and a project mode the workflow does not take is no mode', () => {
  assert.equal(endOf({ mode: 'local' }, { mode: 'remote' }), 'local');
  assert.equal(endOf({}, { mode: 'nope' }), 'local');
  assert.equal(endOf({}, null), 'local');
});

test('#792 an old workflow name: its alias goes under the project\'s mode and over the workflow\'s default', () => {
  const alias = aliasOf('software-development.yaml');
  assert.equal(endOf({}, {}, alias), 'pr');
  assert.equal(endOf({ mode: 'validated' }, { mode: 'local' }, alias), 'pr');
  assert.equal(endOf({}, { mode: 'local' }, alias), 'local');
});

test('#792 a workflow without a mode input ends by its merge, and an unknown one ends in nothing', () => {
  const remote = { merge: 'remote', inputs: {} };
  assert.equal(runEnding(remote, resolveRunInputs({ project: { mode: 'local' }, workflow: remote })), 'pr');
  assert.equal(runEnding(undefined, resolveRunInputs({})), null);
});

test('#792 groupName translates the PR station only', () => {
  const t = (key) => `<${key}>`;
  assert.equal(groupName(OPEN_PR, t), '<run_list.open_pr>');
  assert.equal(groupName('Review', t), 'Review');
  assert.equal(groupName('Merge', t), 'Merge');
});
