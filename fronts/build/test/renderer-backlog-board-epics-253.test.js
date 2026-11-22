// #253 Backlog Board: epics only in the Epics view. An issue the sync marks `isEpic` (a GitHub issue
// labelled epic, a GitLab issue labelled epic) is left out of the list and of every kanban column
// whatever the filters, and out of the column and filter counts; the Epics view still lists the
// epics with their progress and members, an issue's epic badge still filters by its epic and the
// epic select still names them. An epic cannot be selected, assigned to a workflow (the Product
// Owner's proposed group included), or added to a roadmap stage.
// The Backlog is the real screen (fronts/build/views/backlog/backlog.js and its modules, loaded with
// the whole page by test/renderer-app-harness.js) fed a synced backlog through the fake api.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const issue = (number, extra = {}) => ({
  number, title: `Issue ${number}`, state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
  url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: `2026-09-${String(10 + (number % 20)).padStart(2, '0')}T00:00:00Z`,
  tasks: { total: 0, done: 0 }, runs: [], pullRequests: [], ...extra,
});
const epicIssue = (number, title) => issue(number, { title, labels: [{ name: 'epic' }], isEpic: true });

// two epics (GitHub: issues labelled epic) and three issues, members of them
const GITHUB = {
  platform: 'github',
  syncedAt: '2026-10-01T00:00:00Z',
  issues: [issue(1, { epic: '#10' }), issue(2, { epic: '#10' }), issue(3, { epic: '#11' }), epicIssue(10, 'Epic Alpha'), epicIssue(11, 'Epic Beta')],
  epics: [
    { id: '#10', title: 'Epic Alpha', kind: 'issue', state: 'open', url: 'https://github.com/o/r/issues/10', members: [1, 2] },
    { id: '#11', title: 'Epic Beta', kind: 'issue', state: 'open', url: 'https://github.com/o/r/issues/11', members: [3] },
  ],
};
// GitLab: a group epic (&5, not an issue) and an issue labelled epic (#12)
const GITLAB = {
  platform: 'gitlab',
  syncedAt: '2026-10-01T00:00:00Z',
  issues: [issue(1, { epic: '&5' }), issue(2, { epic: '#12' }), issue(3), epicIssue(12, 'Epic Gamma')],
  epics: [
    { id: '&5', title: 'Group Epic', kind: 'group', state: 'open', url: 'https://gitlab.com/groups/g/-/epics/5', members: [1] },
    { id: '#12', title: 'Epic Gamma', kind: 'issue', state: 'open', url: 'https://gitlab.com/g/r/-/issues/12', members: [2] },
  ],
};

async function backlog(data = GITHUB, { saved } = {}) {
  const app = loadApp({
    storage: { 'craftorio.backlogProject': 'p1', 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => data,
      syncBacklog: async () => data,
      saveRoadmap: async (_id, stages) => { saved?.push(stages); return { ...data, roadmap: { state: 'planned', stages } }; },
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  return app;
}
const setMode = (app, mode) => app.click('#bl-mode', { dataset: { mode } });
const setTab = (app, tab) => app.click('#bl-tabs', { dataset: { blTab: tab } });
const numbers = (html) => [...String(html).matchAll(/data-n="(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
const list = (app) => app.el('#bl-list').innerHTML;

test('the list shows the three issues and neither epic, under the Open chip and under All', async () => {
  const app = await backlog();
  await setMode(app, 'list');
  assert.deepEqual(numbers(list(app)), [1, 2, 3]);
  await app.click('#bl-filters', { dataset: { f: 'all' } });
  assert.deepEqual(numbers(list(app)), [1, 2, 3]);
});

test('the kanban shows the three issues and neither epic; To do counts 3', async () => {
  const app = await backlog();
  await setMode(app, 'kanban');
  assert.deepEqual(numbers(list(app)), [1, 2, 3]);
  const todo = /To do\s*<span[^>]*>(\d+)</.exec(list(app));
  assert.ok(todo, 'no To do column');
  assert.equal(Number(todo[1]), 3);
});

test('the issue count and the state chips\' counts leave the epics out', async () => {
  const app = await backlog();
  await setMode(app, 'list');
  assert.equal(app.el('#bl-count').textContent, '3 issues');
  const open = /data-f="open"[^>]*>\s*Open\s*<span[^>]*>(\d+)</.exec(app.el('#bl-filters').innerHTML);
  assert.ok(open, 'no Open chip');
  assert.equal(Number(open[1]), 3);
});

test('GitLab: neither the group epic nor the issue labelled epic shows on the board', async () => {
  const app = await backlog(GITLAB);
  await setMode(app, 'list');
  assert.deepEqual(numbers(list(app)), [1, 2, 3]);
  await setMode(app, 'kanban');
  assert.deepEqual(numbers(list(app)), [1, 2, 3]);
});

test('the Epics view still lists both epics, with their progress and members', async () => {
  const app = await backlog();
  await setTab(app, 'epics');
  const html = list(app);
  assert.match(html, /data-epic="#10"/);
  assert.match(html, /data-epic="#11"/);
  assert.match(text(html), /Epic Alpha/);
  assert.match(text(html), /Epic Beta/);
  assert.match(text(html), /0\/2/); // Epic Alpha: 0 of its 2 members done
  assert.match(html, /#1<\/span>/);
});

test('an issue\'s epic badge still filters by its epic, and the epic select still names both epics', async () => {
  const app = await backlog();
  await setMode(app, 'list');
  assert.match(list(app), /data-epic-filter="#10"/);
  const select = text(app.el('#bl-epic').innerHTML);
  assert.match(select, /Epic Alpha/);
  assert.match(select, /Epic Beta/);
});

test('an epic cannot be selected: it has no checkbox, and a click on one selects nothing', async () => {
  const app = await backlog();
  for (const mode of ['list', 'kanban']) {
    await setMode(app, mode);
    assert.doesNotMatch(list(app), /data-sel="1[01]"/, `${mode}: an epic has a checkbox`);
  }
  await setMode(app, 'list');
  await app.click('#bl-list', { dataset: { sel: '10' }, checked: true });
  assert.equal(app.el('#btn-bl-assign').classList.contains('hidden'), true, 'the epic was selected (Assign workflow… shows)');
});

test('an epic in a Product Owner\'s proposed group is left out of the assignment (returned as skipped)', async () => {
  const app = await backlog();
  const skipped = await app.run('window.BacklogActions.assignGroup({ issues: [10], workflow: "software-development.yaml", inputs: {} })');
  assert.deepEqual([...skipped], [10]);
});

test('a Product Owner\'s "Add to the roadmap" (roadmapGroup) plans the issues and returns the epics as skipped', async () => {
  const saved = [];
  const app = await backlog(GITHUB, { saved });
  const skipped = await app.run('window.BacklogActions.roadmapGroup({ issues: [10, 1, 2], workflow: "software-development.yaml", inputs: {} })');
  assert.deepEqual([...skipped], [10]);
  const planned = saved.flat().flatMap((stage) => stage.items || []).flatMap((item) => item.issues || [])
    .map((x) => (typeof x === 'object' ? x.number : x));
  assert.deepEqual([...new Set(planned)].sort(), [1, 2]);
});

test('a roadmapGroup of epics alone saves no stage', async () => {
  const saved = [];
  const app = await backlog(GITHUB, { saved });
  const skipped = await app.run('window.BacklogActions.roadmapGroup({ issues: [10, 11], workflow: "software-development.yaml", inputs: {} })');
  assert.deepEqual([...skipped], [10, 11]);
  assert.deepEqual(saved, []);
});

test('an epic is never added to a roadmap stage', async () => {
  const saved = [];
  const app = await backlog(GITHUB, { saved });
  app.sandbox.__issues = [GITHUB.issues.find((i) => i.number === 10), GITHUB.issues.find((i) => i.number === 1)];
  app.sandbox.__data = GITHUB;
  await app.run(`window.BacklogRoadmap.addStage({ projectId: 'p1', setData() {}, render() {}, setError() {} }, __data,
    { issues: __issues, workflow: 'software-development.yaml', workflowName: 'Software development', inputs: {}, mock: true, group: false })`);
  const planned = saved.flat().flatMap((stage) => stage.items || []).flatMap((item) => item.issues || [])
    .map((x) => (typeof x === 'object' ? x.number : x));
  assert.ok(planned.includes(1), 'the issue was not planned');
  assert.ok(!planned.includes(10), 'the epic was added to the roadmap stage');
});
