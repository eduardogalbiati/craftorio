// #106: Settings › General › Workspace folder › Change… with a folder the host refuses (one holding
// another project's files): the General tab shows the host's reason and keeps the current workspace.
// On the whole page (agent-chat-page-harness.js), changeWorkspace rejecting the way an IPC handler's
// thrown Error arrives in the renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const CURRENT = { root: '/home/me/craftorio-workspace', runs: '/r', repos: '/p', projects: '/pr', skills: '/s', agents: '/a', workflows: '/w', registry: 'reg' };
const REASON = 'This folder holds other files: pick an empty folder or a Craftorio workspace.';

async function settings(changeWorkspace) {
  const page = await loadPage({ api: { getWorkspace: async () => CURRENT, changeWorkspace } });
  page.run("showView('settings')");
  await settle(20);
  return page;
}

test('#106 a refused folder: the General tab shows why and keeps the current workspace path', { timeout: 30000 }, async () => {
  let asked = 0;
  const page = await settings(async () => { asked++; throw new Error(`Error invoking remote method 'workspace:change': Error: ${REASON}`); });
  assert.equal(textOf(page.$('#set-ws-path')), CURRENT.root);
  page.$('#btn-ws-change').onclick();
  await settle(20);
  assert.equal(asked, 1);
  assert.equal(textOf(page.$('#ws-error')), REASON);
  assert.equal(textOf(page.$('#set-ws-path')), CURRENT.root);
});
