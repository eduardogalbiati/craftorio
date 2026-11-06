// #797: a Sync that fails never reaches the read of the roadmap's PRs, so the screen reads the backlog once
// more (fronts/build/views/backlog/backlog.js sync): that read checks the PRs and its answer draws the reason
// on the card. Through the whole page (agent-chat-page-harness), like renderer-workflows-acceptance-indicator-794.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle, deferred } = require('@multiagent/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');

const READ_FAILED = 'could not read the PR: gh is not installed';
const PROJECTS = [{ id: 'p1', name: 'demo', folder: 'C:/demo', repo: true }];
const WAIT_LINE = '[data-testid="roadmap-item-merge-wait"]';

const pr = (over = {}) => ({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'open', detail: 'open', checkedAt: null, ...over });
const backlogWith = (itemPr) => ({
  issues: [],
  roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [{ id: 'a', workflow: 'feature.yaml', number: 1, title: 'Login page', status: 'waiting_merge', runId: 'run-42', runs: ['run-42'], error: null, pr: itemPr }] }] },
});

// `net`, mutable: what the backlog holds, and what a Sync answers (a function, or an Error to fail with)
async function roadmapPage(net) {
  const page = await loadPage({
    api: {
      listProjects: async () => PROJECTS,
      listPipelines: async () => [],
      listWorkflows: async () => [],
      getBacklog: async () => { if (net.readFails) throw new Error('the engine stopped'); return net.data; },
      syncBacklog: async () => {
        if (net.sync) return net.sync();
        if (net.offline) throw new Error('offline');
        return net.data;
      },
    },
  });
  page.run("showView('roadmap')");
  await settle(30);
  return page;
}

const reads = (page) => page.callsTo('getBacklog').length;
const line = (page) => { const el = page.$(WAIT_LINE); return el ? textOf(el) : null; };
const syncError = (page) => String(page.$('#bl-error').textContent);
async function clickSync(page) {
  page.$('#btn-bl-sync').click();
  await settle(30);
}

test('#797 a failed Sync reads the backlog again: the card says why its PR was not read, and the Sync\'s error stays', async () => {
  const net = { data: backlogWith(pr()) };
  const page = await roadmapPage(net);
  assert.equal(line(page), null, 'an open PR has no reason to show');
  const before = reads(page);

  net.offline = true;
  net.data = backlogWith(pr({ state: 'unknown', detail: READ_FAILED }));
  await clickSync(page);

  assert.equal(reads(page), before + 1);
  assert.ok(String(line(page)).includes(READ_FAILED), String(line(page)));
  assert.ok(syncError(page).includes('offline'), syncError(page));
  assert.equal(page.$('#btn-bl-sync').disabled, false, 'the Sync can be tried again');
});

test('#797 a Sync that works does not read the backlog again: its own answer is what is drawn', async () => {
  const net = { data: backlogWith(pr()) };
  const page = await roadmapPage(net);
  const before = reads(page);
  await clickSync(page);
  assert.equal(page.callsTo('syncBacklog').length > 0, true);
  assert.equal(reads(page), before);
  assert.equal(syncError(page), '');
});

test('#797 a failed Sync whose second read fails too keeps what is shown and the Sync\'s error', async () => {
  const net = { data: backlogWith(pr()) };
  const page = await roadmapPage(net);
  net.offline = true;
  net.readFails = true;
  await clickSync(page);
  assert.equal(page.errors.length, 0);
  assert.ok(syncError(page).includes('offline'), syncError(page));
  assert.equal(page.$('[data-testid="roadmap-item-pr-link"]') === null, false, 'the card is still there');
});

test('#797 a second click while a Sync runs starts nothing: the failed Sync reads the backlog once', async () => {
  const net = { data: backlogWith(pr()) };
  const page = await roadmapPage(net);
  const before = reads(page);
  const pending = deferred();
  net.sync = () => pending.promise;
  page.$('#btn-bl-sync').click();
  await settle(10);
  page.$('#btn-bl-sync').click(); // disabled while it runs: nothing starts
  await settle(10);
  pending.reject(new Error('offline'));
  await settle(30);
  assert.equal(reads(page), before + 1);
});
