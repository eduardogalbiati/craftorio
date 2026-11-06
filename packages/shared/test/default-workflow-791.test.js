// #791: the kinds of work and the workflows a project offers its Product Owner. Acceptance tests,
// written before the code.
// Seams: DefaultWorkflow.KINDS and DefaultWorkflow.projectWorkflows(list, project): of `list` (workflows
// as ctx.listWorkflows gives them) those with no error and a `task` input, in the project's set or named by
// its kinds; never Plan & Design ones (category `plan`), never unrelated bundled ones.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../default-workflow');

const task = { task: { type: 'string' } };
const LIST = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', inputs: task },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'bundled', inputs: task },
  { file: 'write-doc.yaml', name: 'write-doc', category: 'plan', metadata: { category: 'plan' }, origin: 'bundled', inputs: task },
  { file: 'unrelated.yaml', name: 'unrelated', category: 'build', origin: 'bundled', inputs: task },
  { file: 'release.yaml', name: 'release', category: 'build', origin: 'bundled', inputs: {} },
  { file: 'broken.yaml', name: 'broken', category: 'build', origin: 'workspace', inputs: task, error: 'Invalid YAML' },
  { file: 'workflows/hero.yaml', name: 'hero', category: 'solo', origin: 'repository', inputs: task },
];
const offered = (project) => Array.from(load().projectWorkflows(LIST, project), (w) => w.file).sort();
const inSet = (...names) => ({ workflows: names.map((name) => ({ name })) });

test('#791 KINDS are feature, fix and refactor', () => {
  assert.deepEqual(Array.from(load().KINDS), ['feature', 'fix', 'refactor']);
});

test('#791 projectWorkflows offers the project\'s set and no unrelated bundled workflow', () => {
  assert.deepEqual(offered(inSet('feature', 'fix')), ['feature.yaml', 'fix.yaml']);
});

test('#791 projectWorkflows offers a workflow named by the project\'s kinds, repository ones included', () => {
  const project = { ...inSet('feature'), workflowKinds: { fix: { name: 'hero', inputs: {} } } };
  assert.deepEqual(offered(project), ['feature.yaml', 'workflows/hero.yaml']);
});

test('#791 projectWorkflows never offers a Plan & Design workflow, even in the project\'s set', () => {
  assert.deepEqual(offered(inSet('feature', 'write-doc')), ['feature.yaml']);
});

test('#791 projectWorkflows never offers a workflow that takes no task', () => {
  assert.deepEqual(offered(inSet('feature', 'release')), ['feature.yaml']);
});

test('#791 projectWorkflows never offers a workflow with an error', () => {
  assert.deepEqual(offered(inSet('feature', 'broken')), ['feature.yaml']);
});
