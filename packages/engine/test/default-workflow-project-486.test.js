// #486: packages/shared/default-workflow.js's project rules: firstBuild (the default of a project's set,
// shared by packages/engine/domains/project/projects.js and the Overview), and in the renderer the header project's own default
// and set first in the pickers (current, projectFirst), run in a vm with window.CurrentProject and state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'default-workflow.js'), 'utf8');
const WORKFLOWS = [
  { file: 'feature.yaml', name: 'Local hero' },
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

test('#486 current(): the header project\'s default wins', () => {
  const DW = renderer({ project: { id: 'p', defaultWorkflow: 'fixture-other' }, defaultWorkflow: 'software-development.yaml' });
  assert.equal(DW.current().file, 'fixture-other.yaml');
});

test('#486 #790 current(): a project default that no longer exists falls back to feature, never to the setting', () => {
  const DW = renderer({ project: { id: 'p', defaultWorkflow: 'gone' }, defaultWorkflow: 'software-development.yaml' });
  assert.equal(DW.current().file, 'feature.yaml');
});

test('#486 projectFirst: the header project\'s set first, the list unchanged without one', () => {
  const DW = renderer({ project: { id: 'p', workflows: [{ name: 'fixture-other', origin: 'workspace' }] } });
  // the vm's arrays are of another realm: copied before comparing
  assert.deepEqual([...DW.projectFirst(WORKFLOWS)].map((w) => w.file), ['fixture-other.yaml', 'feature.yaml', 'software-development.yaml']);
  const none = renderer({ project: null });
  assert.deepEqual([...none.projectFirst(WORKFLOWS)].map((w) => w.file), WORKFLOWS.map((w) => w.file));
});
