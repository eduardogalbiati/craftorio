// #41 (review, iteration 2): a run's step names resolved at draw time.
// - WorkflowInputs.stepNamesOf(recorded, wf): the workflow's names in the interface language replace a
//   recorded name only when it is the workflow's current English one (or none was recorded); a past
//   version's own name stays (#245);
// - WorkflowInputs.runStepNames(run, workflows): the run's workflow from the list, else its project's
//   repository workflows (api.listWorkflows({ projectId, repositoryOnly: true }), read once, then a redraw).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = (dir, file, origin) => {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, dir, file));
  return { ...wf, name: wf.metadata?.name || file, file, origin };
};

test.afterEach(() => {
  I18n.setLanguage('en');
  delete globalThis.api;
  delete globalThis.scheduleRender;
});

test('#41 stepNamesOf: the recorded English name gives way to the pt-BR one', () => {
  I18n.setLanguage('pt-BR');
  const wf = load('workflows', 'feature.yaml', 'default');
  const english = wf.steps.find((s) => s.id === 'red_check').display;
  const names = WorkflowInputs.stepNamesOf({ red_check: english }, wf);
  assert.notEqual(names.red_check, english);
});

test('#41 stepNamesOf: a name of a past version of the workflow stays', () => {
  I18n.setLanguage('pt-BR');
  const wf = load('workflows', 'feature.yaml', 'default');
  const names = WorkflowInputs.stepNamesOf({ red_check: 'Old red check' }, wf);
  assert.equal(names.red_check, 'Old red check');
});

test('#41 stepNamesOf: in English the recorded names are unchanged', () => {
  const wf = load('workflows', 'feature.yaml', 'default');
  assert.equal(WorkflowInputs.stepNamesOf({ red_check: 'Old red check' }, wf).red_check, 'Old red check');
});

test('#41 runStepNames: a repository workflow is read once for its project, then names the steps', async () => {
  I18n.setLanguage('pt-BR');
  const hero = load(path.join('.craftorio', 'workflows'), 'ai-development-local-hero.yaml', 'repository');
  const english = hero.steps.find((s) => s.id === 'develop').display;
  let calls = 0;
  let redraws = 0;
  globalThis.api = { listWorkflows: async (q) => { calls += 1; assert.deepEqual(q, { projectId: 'p-41', repositoryOnly: true }); return [hero]; } };
  globalThis.scheduleRender = () => { redraws += 1; };
  const run = { workflow: hero.file, projectId: 'p-41', stepNames: { develop: english } };
  assert.equal(WorkflowInputs.runStepNames(run, []).develop, english, 'before the list arrives: the recorded name');
  await new Promise((r) => setImmediate(r));
  assert.equal(redraws, 1);
  assert.notEqual(WorkflowInputs.runStepNames(run, []).develop, english);
  assert.equal(calls, 1);
});

test('#41 runStepNames: no run gives null; a run without a project keeps its recorded names', () => {
  assert.equal(WorkflowInputs.runStepNames(null, []), null);
  assert.deepEqual(WorkflowInputs.runStepNames({ workflow: 'gone.yaml', stepNames: { a: 'A' } }, []), { a: 'A' });
});
