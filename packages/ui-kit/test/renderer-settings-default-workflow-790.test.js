// #790: Settings › General › Backlog no longer shows "Default development workflow". Acceptance test,
// written before the code, on the whole page (agent-chat-page-harness.js): Settings opened, the Backlog
// block drawn, its neighbour control still there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

async function settings() {
  const page = await loadPage({ api: { listWorkflows: async () => [{ file: 'feature.yaml', name: 'feature', inputs: { task: {} } }] } });
  page.run("showView('settings')");
  await settle(20);
  assert.equal(page.$('#set-backlog-group') === null, false, 'the Backlog block is drawn');
  return page;
}

test('#790 Settings has no default workflow control', { timeout: 30000 }, async () => {
  const page = await settings();
  assert.equal(page.$('[data-testid="settings-default-workflow"]') === null, true);
});

test('#790 Settings no longer says "Default development workflow"', { timeout: 30000 }, async () => {
  const page = await settings();
  assert.equal(textOf(page.document.body).includes('Default development workflow'), false);
});
