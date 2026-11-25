// #39 and #73 acceptance, written before the code: the Backlog and the Roadmap (fronts/build/views/backlog/) of a
// project with no repository, in English and Português (Brasil): a local backlog has no sync line, no platform, a
// description of its own, no platform input in New issue…'s Start drawer, no Product Owner proposal line on an empty
// roadmap (#39) and no push status alert (#73). A project with a repository keeps all of them (the guards).
// Seams: the whole page (agent-chat-page-harness, as backlog-roadmap-no-repo-25.test.js) with the engine's answers
// faked: what its header, alerts, list and Start drawer show. Expected texts come from the catalogs. Strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const LANGS = ['en', 'pt-BR'];
const catalogs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${l}.json`), 'utf8'))]));
const text = (lang, key) => {
  assert.equal(typeof catalogs[lang][key], 'string', `${lang} has ${key}`);
  return catalogs[lang][key];
};
const REPO = 'https://github.com/o/lista';
const issue = (extra = {}) => ({ number: 1, title: 'Exportar a lista', state: 'open', labels: [], assignees: [], body: '', tasks: { done: 0, total: 0 }, updatedAt: '2026-11-20T10:00:00Z', ...extra });
const PUSH_ERROR = 'origin/main not found: nothing to compare the local main with.';
// what the engine answers for a project with no repository (local-backlog.js localBacklog), and for a synced one
const localData = (extra = {}) => ({ projectId: 'p1', platform: null, repo: null, local: true, syncedAt: null, issues: [issue({ local: true, url: null, column: 'todo' })], epics: [], ...extra });
const syncedData = (extra = {}) => ({ projectId: 'p1', platform: 'github', repo: REPO, syncedAt: '2026-11-20T10:00:00Z', issues: [issue({ url: `${REPO}/issues/1`, column: 'todo' })], epics: [], ...extra });
const ISSUE = {
  file: 'issue.yaml', name: 'issue', category: 'plan', steps: [], agents: {},
  inputs: {
    request: { label: 'Request', type: 'string', default: '' },
    project_path: { label: 'Project folder', type: 'string', required: true },
    git_platform: { type: 'string', enum: ['gh', 'gl'], default: 'gh', label: 'Platform', options: { gh: 'GitHub', gl: 'GitLab' } },
  },
};

async function screen(view, lang, { repo = null, data = repo ? syncedData() : localData() } = {}) {
  const copy = async () => JSON.parse(JSON.stringify(data));
  const page = await loadPage({
    api: {
      listProjects: async () => [{ id: 'p1', name: 'lista de compras', folder: 'C:/ws/projects/lista', exists: true, repo }],
      listPipelines: async () => [], listWorkflows: async () => JSON.parse(JSON.stringify([ISSUE])),
      getBacklog: copy, syncBacklog: copy,
      getSettings: async () => ({ language: { interface: lang } }),
    },
  });
  page.run(`showView('${view}')`);
  await settle(30);
  assert.equal(page.errors.length, 0, page.errors.map((e) => `${e.script || ''} ${e.message}`).join('; '));
  return page;
}

// the text a person sees: what is hidden (the attribute or the class) is left out
const isHidden = (el) => el.hidden || el.classList.contains('hidden');
function visibleText(node) {
  if (!node || (node.nodeType === 1 && isHidden(node))) return '';
  if (node.nodeType === 3) return node.data;
  return Array.from(node.childNodes || []).map(visibleText).join(' ');
}
const shownText = (page, sel) => visibleText(page.$(sel));
// hidden itself, or inside something hidden, up to `root`
function shown(page, sel, root) {
  const top = page.$(root);
  for (let el = page.$(sel); el; el = el.parentElement) {
    if (isHidden(el)) return false;
    if (el === top) return true;
  }
  return false;
}
const header = (page) => visibleText(page.$('#bl-hint').parentElement);
// the sync line, whatever its date: the catalog's text around its two placeholders
const syncLine = (lang, value) => new RegExp(text(lang, 'backlog.synced_syncedat_from_value').split(/\{\w+\}/).map((s) => s.trim()).filter(Boolean).join('.*') + (value ? `.*${value}` : ''));

for (const view of ['backlog', 'roadmap']) {
  for (const lang of LANGS) {
    test(`#39 ${view}, ${lang}: a project with no repository shows no sync line, no epoch date and no {value}`, async () => {
      const page = await screen(view, lang);
      const said = `${shownText(page, '#bl-synced')} ${shownText(page, '#bl-list')}`;
      assert.doesNotMatch(said, /1969|1970|\{\w+\}|\bnull\b|Invalid Date/);
      assert.doesNotMatch(said, syncLine(lang));
    });

    test(`#39 ${view}, ${lang}: a project with no repository shows no platform select and no platform badge`, async () => {
      const page = await screen(view, lang);
      const on = ['#bl-platform', '#bl-platform-badge'].filter((sel) => shown(page, sel, 'body'));
      assert.deepEqual(on, []);
    });

    test(`#39 ${view}, ${lang}: the description says the backlog is local, in the workspace, not synced`, async () => {
      const page = await screen(view, lang);
      const said = header(page);
      assert.match(said, /local/i);
      assert.match(said, /workspace/i);
      assert.equal(said.includes(text(lang, 'backlog.a_project_s_issues_synced_from')), false, said);
      assert.equal(said.includes(text(lang, 'backlog.the_last_sync_is_kept_in')), false, said);
    });

    test(`#39 ${view}, ${lang}: a project with a repository keeps its sync line (guard)`, async () => {
      const page = await screen(view, lang, { repo: REPO });
      assert.match(`${shownText(page, '#bl-synced')} ${shownText(page, '#bl-list')}`, syncLine(lang, 'GitHub'));
      assert.equal(shown(page, '#bl-platform-badge', 'body'), true, 'its platform badge');
    });
  }
}

for (const lang of LANGS) {
  // (a literal, not the catalog's: the line may stay as a finished one, e.g. without the "…" of a loading line)
  test(`#39 ${lang}: an empty local roadmap says so and has no Product Owner proposal line that looks unfinished`, async () => {
    const page = await screen('roadmap', lang, { data: localData({ issues: [] }) });
    const said = shownText(page, '#bl-list');
    assert.equal(said.includes(text(lang, 'backlog_roadmap.no_roadmap_yet')), true, said);
    assert.equal(said.includes(lang === 'en' ? 'Product Owner proposal…' : 'Proposta do Product Owner…'), false, said);
  });

  test(`#39 ${lang}: New issue… on a project with no repository opens the Start drawer with no platform field`, async () => {
    const page = await screen('backlog', lang);
    page.$('#btn-bl-new-issue').click();
    await settle(30);
    assert.equal(page.$('#drawer').classList.contains('open'), true, 'the Start drawer is open');
    assert.equal(page.$('#wf-select').value, 'issue.yaml');
    assert.equal(shown(page, '#drawer [data-wi-input="git_platform"]', '#drawer'), false, 'no platform field');
  });

  test(`#39 ${lang}: New issue… on a project with a repository keeps its platform field (guard)`, async () => {
    const page = await screen('backlog', lang, { repo: REPO });
    page.$('#btn-bl-new-issue').click();
    await settle(30);
    assert.equal(page.$('#drawer [data-wi-input="git_platform"]') === null, false);
    assert.equal(page.$('#drawer [data-wi-input="git_platform"]').value, 'gh');
  });

  const push = { local: { error: PUSH_ERROR, ahead: 0, behind: 0, commits: [], issues: [], checkedAt: '2026-11-20T10:00:00Z' } };
  test(`#73 ${lang}: the Backlog of a project with no remote shows no push status alert, even with a cached push error`, async () => {
    const page = await screen('backlog', lang, { data: localData({ ...push, issues: [issue({ local: true, url: null, column: 'local' })] }) });
    const said = shownText(page, '#bl-alerts');
    assert.equal(said.includes(text(lang, 'backlog.push_status_unknown')), false, said);
    assert.equal(said.includes(PUSH_ERROR), false, said);
  });

  test(`#73 ${lang}: a project with a remote keeps its push status alert (guard)`, async () => {
    const page = await screen('backlog', lang, { repo: REPO, data: syncedData({ ...push, issues: [issue({ url: `${REPO}/issues/1`, column: 'local' })] }) });
    const said = shownText(page, '#bl-alerts');
    assert.equal(said.includes(text(lang, 'backlog.push_status_unknown')), true, said);
    assert.equal(said.includes(PUSH_ERROR), true, said);
  });
}
