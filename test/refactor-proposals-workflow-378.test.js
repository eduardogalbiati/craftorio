// workflows/refactor-proposals.yaml (#378): the Refactor proposals workflow (a monitor run that turns
// the architecture analysis since a tag or commit into Refactor tab proposals, ranks them and files
// the top ones as `refactor` issues), checked without a whole run: the definition, its inputs, steps
// and outputs, release.yaml's new outputs, the bundled pipeline release-then-refactors.yaml and the
// docs. Whole simulated runs are in test/slow/refactor-proposals-378.slow.test.js. Every file the
// change creates is loaded inside each test (tests first).
// Contract assumed by these tests:
// - inputs `project_path` (required), `since` (optional), `limit` (default 5) and `mode`
//   (auto | validated, as workflows/issue-tracker.yaml names it);
// - steps facts, analyze (an agent), propose, prioritize, gate (human_approval), file, in this order;
// - outputs `issues` (what src/shared/chain-model.js producedIssues reads) and `report`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../src/engine/workflow');
const pipelines = require('../src/domains/workflow/pipelines');

const root = path.join(__dirname, '..');
const WORKFLOW = path.join(root, 'workflows', 'refactor-proposals.yaml');
const PIPELINE = path.join(root, 'pipelines', 'release-then-refactors.yaml');
const load = () => loadWorkflow(WORKFLOW);
const workflowOf = (file) => loadWorkflow(path.join(root, 'workflows', file));
const loadPipeline = (text, file) => pipelines.loadPipelineText(text, file, workflowOf);
const categoryOf = (wf) => wf.category || wf.metadata?.category;

test('refactor proposals workflow: the bundled workflow loads as a monitor workflow with project_path, since, limit and mode inputs', () => {
  const wf = load();
  assert.equal(categoryOf(wf), 'monitor');
  assert.ok(wf.inputs.project_path, 'input "project_path"');
  assert.equal(wf.inputs.project_path.required, true, 'project_path is required');
  assert.ok(wf.inputs.since, 'input "since" (a tag or a commit)');
  assert.notEqual(wf.inputs.since.required, true, 'since is optional');
  assert.ok(wf.inputs.limit, 'input "limit"');
  assert.equal(Number(wf.inputs.limit.default), 5, 'limit defaults to 5');
  assert.ok(wf.inputs.mode, 'input "mode" (as issue-tracker.yaml names it)');
  for (const mode of ['auto', 'validated']) assert.ok((wf.inputs.mode.enum || []).includes(mode), `mode ${mode}`);
});

test('refactor proposals workflow: steps facts, analyze, propose, prioritize, gate and file come in this order; the gate is human, the analysis an agent', () => {
  const wf = load();
  const ids = wf.steps.map((s) => s.id);
  const order = ['facts', 'analyze', 'propose', 'prioritize', 'gate', 'file'];
  for (const id of order) assert.ok(ids.includes(id), `step "${id}" in ${ids.join(', ')}`);
  for (let i = 1; i < order.length; i++) assert.ok(ids.indexOf(order[i - 1]) < ids.indexOf(order[i]), `${order[i - 1]} before ${order[i]} in ${ids.join(', ')}`);
  const step = (id) => wf.steps.find((s) => s.id === id);
  assert.equal(step('gate').type, 'human_approval');
  const analyze = step('analyze');
  assert.ok(analyze.agent, 'analyze is an agent step');
  assert.ok(wf.agents[analyze.agent], `agent "${analyze.agent}" declared`);
});

test('refactor proposals workflow: declares the issues it filed and the analysis report as outputs', () => {
  const outputs = Object.keys(load().outputs || {});
  for (const name of ['issues', 'report']) assert.ok(outputs.includes(name), `output "${name}" in ${outputs.join(', ')}`);
});

test('release workflow: declares previous_version and commit as outputs, besides version, unit_status and e2e_status', () => {
  const outputs = Object.keys(workflowOf('release.yaml').outputs || {});
  for (const name of ['previous_version', 'commit', 'version', 'unit_status', 'e2e_status']) assert.ok(outputs.includes(name), `output "${name}" in ${outputs.join(', ')}`);
});

test('release-then-refactors pipeline: a release, then refactor proposals since the previous version, then the Product Owner; its description warns of the model cost', () => {
  const text = fs.readFileSync(PIPELINE, 'utf8');
  const p = loadPipeline(text, 'release-then-refactors.yaml');
  assert.equal(p.stages[0].workflow, 'release.yaml');
  assert.equal(p.stages[1].workflow, 'refactor-proposals.yaml');
  assert.equal(p.stages[1].map.since, 'previous_version');
  assert.equal(p.stages[p.stages.length - 1].target, 'product_owner');
  assert.match(p.description, /real model/i);
  assert.match(p.description, /\$\s?\d|estimat/i, 'a cost estimate');
});

test('release-then-refactors pipeline: the refactor stage gets since from the release\'s previous_version and the release\'s folder as project_path', () => {
  const chain = require('../src/shared/chain-model');
  const p = loadPipeline(fs.readFileSync(PIPELINE, 'utf8'), 'release-then-refactors.yaml');
  const then = pipelines.pipelineThen(p, 1);
  assert.equal(then.workflow, 'refactor-proposals.yaml');
  assert.equal(then.then?.action, 'product_owner', 'then the Product Owner places the filed issues');
  const release = { inputs: { repo_path: 'C:/projects/app', version: '1.11.0' }, outputs: { version: '1.11.0', previous_version: 'v1.10.0', commit: 'abc1234', unit_status: 'pass', e2e_status: 'pass' } };
  const inputs = chain.nextInputs(then, release, load().inputs);
  assert.equal(inputs.since, 'v1.10.0');
  assert.equal(inputs.project_path, 'C:/projects/app');
});

test('refactor proposals workflow: its issues feed a queue of the Refactor workflow', () => {
  const text = [
    'name: Refactor proposals then queue',
    'stages:',
    '  - workflow: refactor-proposals.yaml',
    '  - target: queue',
    '    workflow: refactor.yaml',
    '',
  ].join('\n');
  const p = loadPipeline(text, 'proposals-to-queue.yaml');
  assert.equal(p.stages[1].target, 'queue');
  assert.equal(p.stages[1].workflow, 'refactor.yaml');
});

test('a pipeline mapping since from an output release.yaml does not declare is refused', () => {
  load(); // the workflow exists: the refusal is the mapping's, not a missing file's
  const text = [
    'name: Broken mapping',
    'stages:',
    '  - workflow: release.yaml',
    '  - workflow: refactor-proposals.yaml',
    '    map:',
    '      since: nonexistent',
    '',
  ].join('\n');
  assert.throws(() => loadPipeline(text, 'broken.yaml'), /"nonexistent"/);
});

test('refactor proposals: the README documents the workflow and the pipeline, decisions.md records #378', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /refactor-proposals\.yaml/);
  assert.match(readme, /release-then-refactors/);
  assert.match(fs.readFileSync(path.join(root, 'docs', 'agents', 'decisions.md'), 'utf8'), /#378/);
});
