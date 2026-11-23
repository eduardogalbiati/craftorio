// #29 acceptance, written before the code: the backlog's Assign dialog (fronts/build/views/backlog/backlog.js
// renderAssignInputs, #assign-wf-desc) describes what the project's feature variant runs. A project whose
// feature variant is local-code runs code first (the developer codes, the test writer writes the acceptance
// tests after the code): its summary never says "Tests first" nor that the tests come "before any code".
// A local-e2e project still reads tests first. Driven on the real page as renderer-projects-workflows-486 does.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

// the bundled feature workflow as api.listWorkflows gives it (its real description and inputs)
function featureEntry() {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'));
  return { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', description: wf.metadata?.description, inputs: wf.inputs || {} };
}
const BACKLOG = {
  platform: 'github',
  syncedAt: '2026-10-01T00:00:00Z',
  epics: [],
  issues: [{ number: 1, title: 'Issue 1', state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '', url: 'https://github.com/o/r/issues/1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', tasks: { total: 0, done: 0 }, runs: [], pullRequests: [] }],
};

// The Backlog of p1 (its feature workflow on this variant), issue #1 selected, the Assign dialog opened on feature
async function assignDesc(variant) {
  const project = { id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', workflows: [{ name: 'feature', origin: 'bundled', category: 'build', variant }], defaultWorkflow: 'feature' };
  const app = loadApp({
    storage: { 'craftorio.backlogProject': 'p1', 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [project],
      listWorkflows: async () => [featureEntry()],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => BACKLOG,
      syncBacklog: async () => BACKLOG,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-list', { dataset: { sel: '1' }, checked: true });
  await app.click('#btn-bl-assign');
  await app.settle(10);
  const value = String(app.el('#assign-workflow').value);
  const desc = app.el('#assign-wf-desc');
  return { value, text: String(desc.textContent || ''), title: String(desc.title || '') };
}

const TESTS_FIRST = /tests first|before any code/i;

test('#29 Assign dialog: a local-code project\'s feature summary does not say "Tests first" nor "before any code"', { timeout: 20000 }, async () => {
  const { value, text, title } = await assignDesc('local-code');
  assert.equal(value, 'feature.yaml', 'the feature workflow is selected');
  assert.equal(text.trim() !== '', true, 'the summary is shown');
  assert.equal(TESTS_FIRST.test(text), false, `the summary: "${text}"`);
  assert.equal(TESTS_FIRST.test(title), false, `the summary's tooltip: "${title}"`);
});

test('#29 Assign dialog (unchanged): a local-e2e project\'s feature summary still describes tests first', { timeout: 20000 }, async () => {
  const { value, text } = await assignDesc('local-e2e');
  assert.equal(value, 'feature.yaml', 'the feature workflow is selected');
  assert.equal(/tests first|before (any|the) code/i.test(text), true, `the summary: "${text}"`);
});
