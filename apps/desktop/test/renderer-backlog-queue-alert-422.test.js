// #422 The queue-paused alert gets a Resume action. Acceptance tests written before the code.
//
// Backlog page (backlog.js renderAlerts): the queue's error alert ({ id: 'queue:<projectId>', level
// 'error', title 'Queue', text: the queue's error, dismissible: false }) gains the action
// { label: 'Resume', primary: true, onClick }: it calls api.pauseQueue(projectId, false) (the button
// disabled while it runs), asks keptWorkDialog when the answer has `kept` ('scratch' → pauseQueue(
// projectId, false, true), as the Queue panel's own Resume does), sets the answer as the page's data
// and renders: once the queue is paused: false, error: null the alert is gone. A refused call shows
// its message on the page's error line (#bl-error, bl.error = errMsg(err)). Still no × on it.
//
// The whole page in the app harness (test/renderer-app-harness.js) with window.api faked at the
// boundary, as test/renderer-alerts-270.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp, text } = require('@multiagent/ui-kit/test/renderer-app-harness');

const QUEUE_ERROR = 'Run run-7 failed: 2 tests failed';
const issue = (number) => ({
  number, title: `Issue ${number}`, state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
  url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  tasks: { total: 0, done: 0 }, runs: [], pullRequests: [],
});
// only the queue's alert: nothing unpushed, no refresh due, no roadmap
function backlogData(queue = { paused: true, error: QUEUE_ERROR, items: [] }) {
  return {
    platform: 'github',
    syncedAt: '2026-10-04T00:00:00Z',
    issues: [issue(1)],
    epics: [],
    local: { ahead: 0, behind: 0, base: 'main', issues: [], commits: [] },
    queue,
  };
}
const RESUMED = () => backlogData({ paused: false, error: null, items: [] });

async function backlog(data, api = {}) {
  const app = loadApp({
    storage: { 'multiagent.backlogProject': 'p1', 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => data,
      syncBacklog: async () => data,
      ...api,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-mode', { dataset: { mode: 'kanban' } });
  return app;
}
const alertsBox = (app) => app.el('#bl-alerts').innerHTML;
const queueAlert = (app) => H.findEl(alertsBox(app), (e) => e.attrs['data-testid'] === 'page-alert' && /Queue/.test(H.visibleText(e.inner)));
const resumeIn = (html) => H.findEl(html, (e) => e.name === 'button' && 'data-alert-action' in e.attrs && H.visibleText(e.inner) === 'Resume');
// clicks the alert's Resume: its data-* attributes go on the fake target, the click bubbles to #bl-alerts
async function clickResume(app) {
  const el = resumeIn(alertsBox(app));
  assert.ok(el, 'a Resume button in the queue alert');
  const dataset = {};
  for (const [k, v] of Object.entries(el.attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = v;
  return app.click(`[data-resume-${Math.random().toString(36).slice(2)}]`, { dataset, within: ['#bl-alerts'] });
}

test('#422 the queue\'s error alert has a primary Resume button and no ×', async () => {
  const app = await backlog(backlogData());
  const el = queueAlert(app);
  assert.ok(el, 'the queue alert is shown');
  assert.ok(text(el.outer).includes(QUEUE_ERROR), 'it tells the queue\'s error');
  const resume = resumeIn(el.outer);
  assert.deepEqual([!!resume, /\bprimary\b/.test(resume?.attrs.class || ''), !!H.findEl(el.outer, (e) => 'data-alert-dismiss' in e.attrs)], [true, true, false]);
});

test('#422 Resume calls api.pauseQueue(projectId, false); once the queue resumed the alert is gone', async () => {
  const app = await backlog(backlogData(), { pauseQueue: async () => RESUMED() });
  await clickResume(app);
  await app.settle(10);
  assert.deepEqual(app.callsTo('pauseQueue'), [['p1', false]]);
  assert.equal(queueAlert(app), null, 'no queue alert after the resume');
});

test('#422 the Resume button is disabled while the call runs', async () => {
  let finish;
  const app = await backlog(backlogData(), { pauseQueue: () => new Promise((r) => { finish = r; }) });
  const target = await clickResume(app);
  const button = resumeIn(alertsBox(app));
  const disabled = target.disabled === true || (!!button && 'disabled' in button.attrs);
  finish(RESUMED());
  await app.settle(10);
  assert.equal(disabled, true);
});

test('#422 Resume on kept work asks keptWorkDialog; "scratch" calls pauseQueue(projectId, false, true)', async () => {
  let n = 0;
  const app = await backlog(backlogData(), {
    pauseQueue: async () => { n += 1; return n === 1 ? { kept: { runId: 'run-7', branch: 'issue-1' } } : RESUMED(); },
  });
  app.run("window.__asked = 0; window.keptWorkDialog = async () => { window.__asked += 1; return 'scratch'; };");
  await clickResume(app);
  await app.settle(10);
  assert.equal(app.run('window.__asked'), 1);
  assert.deepEqual(app.callsTo('pauseQueue'), [['p1', false], ['p1', false, true]]);
});

test('#422 a refused Resume shows its error on the page', async () => {
  const app = await backlog(backlogData(), { pauseQueue: async () => { throw new Error('The queue is locked by another run'); } });
  await clickResume(app);
  await app.settle(10);
  assert.match(String(app.el('#bl-error').textContent), /The queue is locked by another run/);
});
