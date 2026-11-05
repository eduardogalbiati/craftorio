// #785: the rules of a run's inputs the engine and the screens share (packages/shared/run-inputs.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { chosen, fits, projectValue, resolveRunInputs, sameValue, shownDefault } = require('../run-inputs');

const LANGUAGE = { enum: ['js', 'rust'], multiple: true, default: 'js' };

test('#785 fits: a multiple input fits with each of its values, spaces or not', () => {
  assert.deepEqual([fits(LANGUAGE, 'rust,js'), fits(LANGUAGE, 'rust, js'), fits(LANGUAGE, 'rust,go')], [true, true, false]);
});

test('#785 fits: an enum of numbers takes their text; a blank value is not in an enum', () => {
  assert.deepEqual([fits({ enum: [1, 2] }, '2'), fits({ enum: ['a'] }, ''), fits({}, 'free')], [true, false, true]);
});

test('#785 sameValue: a list and its text, a boolean and its word are one value', () => {
  assert.deepEqual([sameValue(['a', 'b'], 'a,b'), sameValue(false, 'false'), sameValue('a', 'b')], [true, true, false]);
});

test('#785 projectValue: release.yaml\'s own names take the project\'s values', () => {
  const project = { test_command: 'cargo test', e2e_tests: 'off' };
  assert.deepEqual([projectValue('unit_command', {}, project), projectValue('e2e_suite', { enum: ['run', 'skip'] }, project)], ['cargo test', 'skip']);
});

test('#785 shownDefault: a project value outside the enum shows the workflow\'s default', () => {
  assert.equal(shownDefault('mode', { enum: ['local'], default: 'local' }, { mode: 'fork' }), 'local');
});

test('#785 chosen: only what differs from the shown value stays, an undeclared input too', () => {
  const defs = { mode: { default: 'local' }, e2e_tests: { default: 'write_and_run' } };
  assert.deepEqual(chosen({ mode: 'fork', e2e_tests: 'off', other: 'x', blank: ' ' }, defs, { mode: 'fork' }), { e2e_tests: 'off', other: 'x' });
});

test('#785 resolveRunInputs: a blank saved value does not hide the project\'s', () => {
  const { values, sources } = resolveRunInputs({ roadmap: { test_command: '' }, project: { test_command: 'cargo test' }, workflow: { inputs: { test_command: { default: '' } } } });
  assert.deepEqual([values.test_command, sources.test_command], ['cargo test', 'project']);
});
