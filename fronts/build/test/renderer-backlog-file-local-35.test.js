// #35: a project that got a repository after it had local issues. Its Backlog (fronts/build/views/backlog/backlog.js)
// shows an info alert "File on <platform>…" (data-testid backlog-file-local); its click shows backlog:file-local's
// preview (each issue and its command) in the confirm modal, and files only on the owner's Yes: Cancel files nothing.
// Through the whole page (agent-chat-page-harness), the real confirm modal. Strings and call lists only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');

const REPO = 'https://github.com/o/receitas';
const issue = (number, title, extra = {}) => ({ number, title, state: 'open', labels: [], assignees: [], body: '', tasks: { done: 0, total: 0 }, updatedAt: '2026-11-20T10:00:00Z', ...extra });
const backlogWith = (issues) => ({ projectId: 'p1', platform: 'github', repo: REPO, syncedAt: '2026-11-23T10:00:00Z', issues });
const LOCAL_OPEN = backlogWith([
  issue(7, 'Bolo de fubá', { url: null, local: true }),
  issue(1, 'Platform issue', { url: `${REPO}/issues/1` }),
]);
const PREVIEW = { preview: true, issues: [{ number: 7, title: 'Bolo de fubá', command: 'gh issue create --repo o/receitas --title "Bolo de fubá"' }] };

async function screen(data) {
  const page = await loadPage({
    api: {
      listProjects: async () => [{ id: 'p1', name: 'receitas', folder: 'C:/ws/projects/receitas', repo: REPO }],
      listPipelines: async () => [], listWorkflows: async () => [],
      getBacklog: async () => JSON.parse(JSON.stringify(data)), syncBacklog: async () => JSON.parse(JSON.stringify(data)),
      getSettings: async () => ({ language: { interface: 'en' } }),
      fileLocalIssues: async (_id, preview) => (preview ? JSON.parse(JSON.stringify(PREVIEW)) : { issues: [{ number: 7, filed: 12 }], backlog: backlogWith([issue(12, 'Bolo de fubá', { url: `${REPO}/issues/12` })]) }),
    },
  });
  page.run("showView('backlog')");
  await settle(30);
  return page;
}

const fileButton = (page) => page.$('[data-testid="backlog-file-local"]');
const fileCalls = (page) => JSON.stringify(page.callsTo('fileLocalIssues').map((a) => [String(a[0]), a[1]]));

test('#35 a Backlog with a repository and open local issues offers to file them on the platform', async () => {
  const page = await screen(LOCAL_OPEN);
  assert.equal(fileButton(page) === null, false, 'the File on GitHub… button');
  assert.equal(String(textOf(fileButton(page))).includes('GitHub'), true, String(textOf(fileButton(page))));
  assert.equal(fileCalls(page), '[]', 'nothing filed, not even previewed, before the click');
  assert.equal(page.errors.length, 0);
});

test('#35 a Backlog with no local issue left shows no File on <platform> alert', async () => {
  const page = await screen(backlogWith([issue(1, 'Platform issue', { url: `${REPO}/issues/1` })]));
  assert.equal(fileButton(page) === null, true);
});

test('#35 File on <platform>… lists each local issue with its command, and Cancel files nothing', async () => {
  const page = await screen(LOCAL_OPEN);
  fileButton(page).click();
  await settle(20);
  const details = String(textOf(page.$('#confirm-details')) || '');
  assert.equal(details.includes('#7'), true, details);
  assert.equal(details.includes('Bolo de fubá'), true, details);
  assert.equal(details.includes('gh issue create'), true, details);
  page.$('#btn-confirm-no').click();
  await settle(20);
  assert.equal(fileCalls(page), JSON.stringify([['p1', true]]), 'only the preview');
});

test('#35 File on <platform>… files the local issues only on Yes', async () => {
  const page = await screen(LOCAL_OPEN);
  fileButton(page).click();
  await settle(20);
  page.$('#btn-confirm-yes').click();
  await settle(20);
  assert.equal(fileCalls(page), JSON.stringify([['p1', true], ['p1', false]]));
  assert.equal(page.errors.length, 0);
});
