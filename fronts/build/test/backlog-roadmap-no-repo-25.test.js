// #25: the Backlog and the Roadmap (fronts/build/views/backlog/backlog.js) of a project created without a remote,
// in English and Português (Brasil). With the decision "add a repository" these screens keep saying up front that
// the project has no repository and how to add one, with Sync and New issue off, and never try a sync. Through the
// whole page (agent-chat-page-harness, as renderer-backlog-issues-disabled-845.test.js). Strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const NO_REPO = [{ id: 'p1', name: 'receitas da vo', folder: 'C:/ws/projects/receitas-da-vo', repo: null }];

async function screen(view, lang) {
  const page = await loadPage({
    api: {
      listProjects: async () => JSON.parse(JSON.stringify(NO_REPO)), listPipelines: async () => [], listWorkflows: async () => [],
      getBacklog: async () => null, syncBacklog: async () => null,
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
    test(`#25 ${view}, ${lang}: a project with no repository says so and how to add one`, async () => {
      const page = await screen(view, lang);
      const text = listText(page);
      const c = catalog(lang);
      assert.equal(text.includes(c['backlog.this_project_has_no_repository']), true, text);
      assert.equal(text.includes(c['backlog.add_a_repository_url_to_the'].replace(/…$/, '')), true, text);
      assert.equal(page.errors.length, 0);
    });
  }

  test(`#25 ${view}: a project with no repository has Sync and New issue off and is never synced`, async () => {
    const page = await screen(view, 'en');
    assert.equal(page.$('#btn-bl-sync').disabled, true);
    assert.equal(page.$('#btn-bl-new-issue').disabled, true);
    assert.equal(page.callsTo('syncBacklog').length, 0);
  });
}
