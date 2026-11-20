// #845: the Backlog screen (fronts/build/views/backlog/backlog.js) of a repository with Issues turned off. The
// engine's sync (window.api.syncBacklog) and its cache (getBacklog) answer { issues: [], issuesDisabled: true, repo }:
// the screen says "Issues are turned off in this repository" instead of a sync error. A network failure still
// shows its reason in the sync error line (#bl-error). Through the whole page (agent-chat-page-harness, as
// renderer-backlog-sync-failed-797.test.js). Assertions compare strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');

const OFF_TEXT = 'Issues are turned off in this repository';
const NETWORK = 'gh issue list failed: error connecting to api.github.com';
const PROJECTS = [{ id: 'p1', name: 'demo', folder: 'C:/demo', repo: 'https://github.com/o/r' }];
const OFF = { projectId: 'p1', platform: 'github', repo: 'https://github.com/o/r', syncedAt: '2026-11-20T10:00:00.000Z', issues: [], epics: [], issuesDisabled: true };

async function backlogPage({ getBacklog, syncBacklog }) {
  const page = await loadPage({
    api: { listProjects: async () => PROJECTS, listPipelines: async () => [], listWorkflows: async () => [], getBacklog, syncBacklog },
  });
  page.run("showView('backlog')");
  await settle(30);
  return page;
}

const screenText = (page) => String(textOf(page.$('#view-backlog')) || '');
const syncError = (page) => String(page.$('#bl-error')?.textContent || '');

test('#845 Issues turned off: the Backlog screen says so after a sync, with no sync error', async () => {
  const page = await backlogPage({ getBacklog: async () => null, syncBacklog: async () => JSON.parse(JSON.stringify(OFF)) });
  assert.equal(page.callsTo('syncBacklog').length > 0, true, 'the screen synced');
  assert.equal(screenText(page).includes(OFF_TEXT), true, screenText(page));
  assert.equal(syncError(page), '');
  assert.equal(screenText(page).includes('disabled issues'), false);
  assert.equal(page.errors.length, 0);
});

test('#845 Issues turned off, read from the cache: the same words, no sync error', async () => {
  const page = await backlogPage({ getBacklog: async () => JSON.parse(JSON.stringify(OFF)), syncBacklog: async () => JSON.parse(JSON.stringify(OFF)) });
  assert.equal(screenText(page).includes(OFF_TEXT), true, screenText(page));
  assert.equal(syncError(page), '');
});

test('#845 a network failure still shows its reason in the sync error, not the issues-disabled words', async () => {
  const page = await backlogPage({ getBacklog: async () => null, syncBacklog: async () => { throw new Error(NETWORK); } });
  assert.equal(syncError(page).includes('error connecting to api.github.com'), true, syncError(page));
  assert.equal(screenText(page).includes(OFF_TEXT), false);
  assert.equal(page.$('#btn-bl-sync')?.disabled, false, 'the Sync can be tried again');
});
