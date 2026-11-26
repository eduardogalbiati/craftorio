// #40 acceptance, written before the code: the Backlog's Assign dialog (fronts/build/views/backlog/backlog.js
// openAssign, #assign-workflow) for a project whose repository workflow (its manifest's default,
// ai-development-remote-hero) waits for the owner's acceptance at the current commit: that workflow is marked as
// awaiting acceptance and is never preselected (neither as the project's default nor as the remembered pick).
// Driven on the real page as backlog-assign-code-first-29.test.js does.
//
// The contract assumed here:
// - the dialog's list comes from api.listWorkflows({ projectId }) as today; "waits for acceptance" is the existing
//   rule (packages/ui-kit/workflows-acceptance.js awaitsAcceptance): origin 'repository' and accepted === false;
// - the mark is on the workflow's <option>: data-testid="assign-workflow-awaiting-acceptance" (or its text says it
//   awaits acceptance).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PID = 'p1';
const REPO_WF = 'ai-development-remote-hero';
const task = { task: { type: 'string', required: true } };
const FEATURE = { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', inputs: task, steps: [] };
const FIX = { file: 'fix.yaml', name: 'fix', category: 'fix', origin: 'bundled', inputs: task, steps: [] };
const repoEntry = (accepted) => ({
  file: `${REPO_WF}.yaml`, name: REPO_WF, origin: 'repository', projectId: PID, commit: 'c0ffee1234567890',
  changedCommit: accepted ? null : 'c0ffee1234567890', accepted, acceptedCommit: accepted ? 'c0ffee1234567890' : null,
  trusted: accepted, steps: [], inputs: task, category: 'build',
});
const BACKLOG = {
  platform: 'github', syncedAt: '2026-10-01T00:00:00Z', epics: [],
  issues: [{ number: 1, title: 'Issue 1', state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '', url: 'https://github.com/o/r/issues/1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', tasks: { total: 0, done: 0 }, runs: [], pullRequests: [] }],
};
const PROJECT = { id: PID, name: 'Remote hero', repo: 'https://github.com/o/r', folder: 'C:/p/r', exists: true, defaultWorkflow: REPO_WF, manifest: { default: REPO_WF } };
const clone = (x) => JSON.parse(JSON.stringify(x));

async function openAssign({ accepted = false, remembered = null } = {}) {
  const app = loadApp({
    storage: { 'craftorio.backlogProject': PID, 'craftorio.currentProject': PID, ...(remembered ? { 'craftorio.backlogWorkflow': remembered } : {}) },
    api: {
      listProjects: async () => [clone(PROJECT)],
      listWorkflows: async (opts = {}) => {
        if (opts?.projectId !== PID) return clone([FEATURE, FIX]);
        return clone(opts.repositoryOnly ? [repoEntry(accepted)] : [FEATURE, FIX, repoEntry(accepted)]);
      },
      getSettings: async () => ({ lastProject: PID }),
      getBacklog: async () => clone(BACKLOG),
      syncBacklog: async () => clone(BACKLOG),
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-list', { dataset: { sel: '1' }, checked: true });
  await app.click('#btn-bl-assign');
  await app.settle(10);
  return app;
}

const selected = (app) => String(app.el('#assign-workflow').value);
const optionOf = (app, file) => H.findEl(String(app.el('#assign-workflow').innerHTML || ''), (e) => e.name === 'option' && e.attrs.value === file);
const marked = (opt) => opt.attrs['data-testid'] === 'assign-workflow-awaiting-acceptance' || /accept/i.test(H.visibleText(opt.inner)) || /accept/i.test(opt.attrs.title || '');

test('#40 Assign dialog: the repository workflow awaiting acceptance is listed and marked as such', { timeout: 20000 }, async () => {
  const app = await openAssign();
  const opt = optionOf(app, `${REPO_WF}.yaml`);
  assert.equal(opt === null, false, 'the repository workflow is still listed');
  assert.equal(marked(opt), true, opt.outer);
});

test('#40 Assign dialog: a remembered pick awaiting acceptance is not preselected', { timeout: 20000 }, async () => {
  const app = await openAssign({ remembered: `${REPO_WF}.yaml` });
  assert.notEqual(selected(app), `${REPO_WF}.yaml`);
});

test('#40 Assign dialog: the project\'s default awaiting acceptance is not preselected', { timeout: 20000 }, async () => {
  const app = await openAssign();
  assert.notEqual(selected(app), `${REPO_WF}.yaml`);
});

test('#40 unchanged: an accepted repository workflow is not marked as awaiting acceptance', { timeout: 20000 }, async () => {
  const app = await openAssign({ accepted: true });
  const opt = optionOf(app, `${REPO_WF}.yaml`);
  assert.equal(opt === null, false, 'the repository workflow is listed');
  assert.equal(marked(opt), false, opt.outer);
});

test('#40 unchanged: an accepted repository workflow remembered as the pick is preselected', { timeout: 20000 }, async () => {
  const app = await openAssign({ accepted: true, remembered: `${REPO_WF}.yaml` });
  assert.equal(selected(app), `${REPO_WF}.yaml`);
});
