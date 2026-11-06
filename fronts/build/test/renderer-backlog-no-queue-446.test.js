// Acceptance tests for #605 / #446 (written before the code): the Backlog screen has no plain queue
// any more. Even when the Backlog answer still carries a `queue` (an engine of an older version), the
// page draws no queue bar (#bl-queue, data-testid="queue-bar"), no "Queue" alert, and the Roadmap
// has no "N runs in the plain queue" line nor its "Move into the roadmap" button (data-rm="from-queue").
// Seams: the whole page in the app harness (as renderer-backlog-queue-alert-422.test.js) and
// BacklogRoadmap.html(data, rerender) in a vm sandbox (as renderer-backlog-roadmap-view.test.js);
// only strings are compared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const QUEUE_ERROR = 'Run run-7 failed: 2 tests failed';
const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const issue = (number) => ({
  ...ref(number), state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z', tasks: { total: 0, done: 0 }, runs: [], pullRequests: [],
});
const QUEUE = { paused: true, error: QUEUE_ERROR, inputs: {}, items: [{ ...ref(2), workflow: 'feature.yaml', workflowName: 'feature', mock: true }], skipped: [{ number: 3, title: 'Issue 3', url: ref(3).url, reason: 'closed on the platform' }] };

function backlogData() {
  return {
    platform: 'github',
    syncedAt: '2026-10-04T00:00:00Z',
    issues: [issue(1), issue(2), issue(3)],
    epics: [],
    local: { ahead: 0, behind: 0, base: 'main', issues: [], commits: [] },
    queue: QUEUE,
  };
}

async function backlogPage(data) {
  const app = loadApp({
    storage: { 'multiagent.backlogProject': 'p1', 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => data,
      syncBacklog: async () => data,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-mode', { dataset: { mode: 'kanban' } });
  return app;
}

test('#446 Backlog page: no queue bar and no queue alert, although the answer still has a queue', async () => {
  const app = await backlogPage(backlogData());
  const bar = String(app.el('#bl-queue').innerHTML || '');
  assert.equal(bar.trim(), '', 'no queue bar is drawn');
  const alerts = String(app.el('#bl-alerts').innerHTML || '');
  assert.equal(alerts.includes(QUEUE_ERROR), false, 'no queue alert');
  assert.equal(/>\s*Queue\s*</.test(alerts), false, 'no alert titled Queue');
});

// ---- the Roadmap tab ---------------------------------------------------------------------------

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadRoadmap() {
  const store = new Map();
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: { listWorkflows: async () => [] },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-inputs.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('menu.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

test('#446 Roadmap tab: no plain-queue line and no "Move into the roadmap", although the answer still has a queue', () => {
  const data = {
    roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [{ id: 'i1', status: 'planned', workflow: 'feature.yaml', inputs: {}, issues: [ref(1)] }] }] },
    issues: [{ number: 1, title: 'Issue 1', labels: [] }],
    epics: [],
    queue: QUEUE,
  };
  const html = String(loadRoadmap().html(data, () => {}));
  assert.ok(html.includes('data-testid="roadmap-bar"'), 'the roadmap was drawn');
  assert.equal(html.includes('data-rm="from-queue"'), false, 'no Move into the roadmap button');
  assert.equal(/Move into the roadmap/.test(html), false);
  assert.equal(/plain queue/i.test(html), false, 'no plain-queue line');
});
