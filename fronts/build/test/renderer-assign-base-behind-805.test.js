// #805: Assign's Run now when the local base is behind origin (fronts/build/views/backlog/backlog.js submitAssign).
// The stage stays planned and the engine answers its question with the stage's id: the dialog closes, the notice shows
// on the Roadmap and its choice starts that stage alone. The real page in the renderer harness, with a fake window.api.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const FILE = 'fixture.yaml';
const WORKFLOW = { file: FILE, name: 'Fixture', steps: [], inputs: { task: { type: 'string', required: true } } };
const ISSUE = {
  number: 1, title: 'Issue 1', state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '', url: 'https://github.com/o/r/issues/1',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z', tasks: { total: 0, done: 0 }, runs: [], pullRequests: [],
};
const DATA = { platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [ISSUE], epics: [] };
const ROADMAP = { state: 'planned', stages: [{ id: 'st9', name: 'Assigned', note: '', items: [] }] };

async function assigned(answer) {
  const app = loadApp({
    storage: { 'craftorio.backlogProject': 'p1', 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => DATA,
      syncBacklog: async () => DATA,
      listWorkflows: async () => [WORKFLOW],
      assignWorkflow: async () => answer,
      startRoadmap: async () => ({ ...DATA, roadmap: { ...ROADMAP, state: 'running' } }),
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.run(`window.BacklogActions.assignGroup({ issues: [1], workflow: '${FILE}', inputs: {} })`);
  await app.settle(10);
  app.el('#assign-run-now').checked = true;
  await app.el('#assign-form').onsubmit({ preventDefault() {} });
  await app.settle(20);
  assert.equal(app.callsTo('assignWorkflow').length, 1, 'the dialog reached api.assignWorkflow');
  return app;
}

const question = () => ({
  ...DATA, roadmap: ROADMAP, stage: 'st9',
  confirm: 'main is 16 commits behind origin/main.',
  baseCheck: { base: 'main', state: 'behind', ahead: 0, behind: 16, canUpdate: true },
});
const list = (app) => String(app.el('#bl-list').innerHTML);
const plainText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('#805 Run now answered by a question: the notice shows on the Roadmap with the count', async () => {
  const app = await assigned(question());
  assert.equal(app.callsTo('assignWorkflow')[0].at(-1), true, 'asked with Run now');
  assert.equal(list(app).includes('data-testid="roadmap-base-notice"'), true);
  assert.match(plainText(list(app)), /\b16 commits behind origin\/main/);
});

test('#805 the notice of a Run now starts that stage alone, with the choice', async () => {
  const app = await assigned(question());
  await app.click('#bl-list', { dataset: { rm: 'base-continue' }, attrs: { 'data-rm': 'base-continue' } });
  await app.settle(20);
  const starts = JSON.parse(JSON.stringify(app.callsTo('startRoadmap')));
  assert.deepEqual(starts, [['p1', false, 'st9', 'continue']]);
  assert.equal(list(app).includes('data-testid="roadmap-base-notice"'), false);
});

test('#805 Run now with no question shows no notice', async () => {
  const app = await assigned({ ...DATA, roadmap: { ...ROADMAP, state: 'running' }, stage: 'st9' });
  assert.equal(list(app).includes('data-testid="roadmap-base-notice"'), false);
});
