// #25, revised by #35: the Backlog and the Roadmap (fronts/build/views/backlog/backlog.js) of a project created
// without a remote, in English and Português (Brasil). #25 said "This project has no repository" with Sync and New
// issue off. #35's decision: "a project with no remote gets a local backlog": the screens list its local issues
// (api.getBacklog answers them, no repo, no platform), New issue is enabled, and Sync (nothing to sync with) is
// hidden or says why in its tooltip. Through the whole page (agent-chat-page-harness, as
// renderer-backlog-issues-disabled-845.test.js). Strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const NO_REPO = [{ id: 'p1', name: 'receitas da vo', folder: 'C:/ws/projects/receitas-da-vo', repo: null }];
// the local backlog as the engine answers it: its issues, no repository and no platform
const LOCAL = {
  projectId: 'p1',
  issues: [{ number: 1, title: 'Escrever a receita do bolo de fubá', state: 'open', labels: [], assignees: [], body: '', tasks: { done: 0, total: 0 }, updatedAt: '2026-11-20T10:00:00Z' }],
};

async function screen(view, lang) {
  const page = await loadPage({
    api: {
      listProjects: async () => JSON.parse(JSON.stringify(NO_REPO)), listPipelines: async () => [], listWorkflows: async () => [],
      getBacklog: async () => JSON.parse(JSON.stringify(LOCAL)), syncBacklog: async () => JSON.parse(JSON.stringify(LOCAL)),
      getSettings: async () => ({ language: { interface: lang } }),
    },
  });
  page.run(`showView('${view}')`);
  await settle(30);
  return page;
}

const listText = (page) => String(textOf(page.$('#bl-list')) || '');

for (const view of ['backlog', 'roadmap']) {
  for (const lang of ['en', 'pt-BR']) {
    test(`#35 ${view}, ${lang}: a project with no repository no longer says it has none`, async () => {
      const page = await screen(view, lang);
      const text = listText(page);
      assert.equal(text.includes(catalog(lang)['backlog.this_project_has_no_repository'] || '(no such text)'), false, text);
      assert.equal(page.errors.length, 0);
    });
  }

  test(`#35 ${view}: a project with no repository has New issue enabled`, async () => {
    const page = await screen(view, 'en');
    assert.equal(page.$('#btn-bl-new-issue').disabled, false);
  });

  test(`#35 ${view}: a project with no repository hides Sync or says why in its tooltip`, async () => {
    const page = await screen(view, 'en');
    const sync = page.$('#btn-bl-sync');
    const hidden = !sync || sync.hidden === true || sync.classList.contains('hidden');
    assert.equal(hidden || String(sync.title || '').trim() !== '', true, `Sync: hidden ${hidden}, title "${sync?.title}"`);
  });
}

test('#35 backlog: a project with no repository lists its local issue', async () => {
  const page = await screen('backlog', 'pt-BR');
  assert.equal(listText(page).includes('Escrever a receita do bolo de fubá'), true, listText(page));
});
