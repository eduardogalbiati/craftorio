// #738 (with #735): a Fork + PR project's runs default to mode fork
// (packages/engine/domains/project/project-run-defaults.js). Acceptance tests, written before the code.
// The interface these tests assume: runDefaultsWith keeps a profile's mode 'fork', and the wizard's pick
// of a fork-* workflow variant gives mode fork too.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/project/project-run-defaults');

test('#738 a fork profile makes the project\'s runs default to mode fork', () => {
  assert.equal(load().runDefaultsWith({ project: { id: 'widgets' }, profile: { mode: 'fork', ci: 'pr+release', tests: 'unit' } }).mode, 'fork');
});

test('#738 the wizard\'s fork variant makes the project\'s runs default to mode fork', () => {
  const project = { id: 'widgets', workflows: [{ id: 'feature', variant: 'fork-code' }] };
  assert.equal(load().runDefaultsWith({ project, profile: { mode: 'remote', ci: 'pr+release', tests: 'unit' } }).mode, 'fork');
});
