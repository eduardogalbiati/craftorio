// #486: src/shared/default-workflow.js's project rules: firstBuild (the default of a project's set,
// shared by src/projects.js and the Overview), and in the renderer the header project's own default
// and set first in the pickers (current, projectFirst), run in a vm with window.CurrentProject and state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DefaultWorkflow = require('../src/shared/default-workflow');

const src = fs.readFileSync(path.join(__dirname, '../src/shared/default-workflow.js'), 'utf8');
const WORKFLOWS = [
  { file: 'software-development-local-hero.yaml', name: 'Local hero' },
  { file: 'software-development.yaml', name: 'Software development' },
  { file: 'fixture-other.yaml', name: 'Other' },
];

function renderer({ project, defaultWorkflow = null }) {
  const window = { CurrentProject: { get: () => project?.id || null } };
  const sandbox = { window, state: { workflows: WORKFLOWS, settings: { defaultWorkflow }, projects: project ? [project] : [] } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return window.DefaultWorkflow;
}

test('#486 firstBuild: the first solo, team or build workflow, null without one', () => {
  assert.equal(DefaultWorkflow.firstBuild([{ name: 'refresh', category: 'intake' }, { name: 'sd', category: 'build' }]), 'sd');
  assert.equal(DefaultWorkflow.firstBuild([{ name: 'a', category: 'team' }, { name: 'b', category: 'solo' }]), 'a');
  assert.equal(DefaultWorkflow.firstBuild([{ name: 'refresh', category: 'intake' }]), null);
  assert.equal(DefaultWorkflow.firstBuild(undefined), null);
});

test('#486 current(): the header project\'s default wins over Settings\', not for Settings itself', () => {
  const DW = renderer({ project: { id: 'p', defaultWorkflow: 'fixture-other' }, defaultWorkflow: 'software-development.yaml' });
  assert.equal(DW.current().file, 'fixture-other.yaml');
  assert.equal(DW.current({ project: false }).file, 'software-development.yaml');
});

test('#486 current(): a project default that no longer exists falls back to Settings\'', () => {
  const DW = renderer({ project: { id: 'p', defaultWorkflow: 'gone' }, defaultWorkflow: 'software-development.yaml' });
  assert.equal(DW.current().file, 'software-development.yaml');
});

test('#486 projectFirst: the header project\'s set first, the list unchanged without one', () => {
  const DW = renderer({ project: { id: 'p', workflows: [{ name: 'fixture-other', origin: 'workspace' }] } });
  // the vm's arrays are of another realm: copied before comparing
  assert.deepEqual([...DW.projectFirst(WORKFLOWS)].map((w) => w.file), ['fixture-other.yaml', 'software-development-local-hero.yaml', 'software-development.yaml']);
  const none = renderer({ project: null });
  assert.deepEqual([...none.projectFirst(WORKFLOWS)].map((w) => w.file), WORKFLOWS.map((w) => w.file));
});
