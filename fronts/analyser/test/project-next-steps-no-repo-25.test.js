// #25 acceptance, written before the code: the Next steps card on the project's page
// (fronts/analyser/views/project/project.js, shown while localStorage craftorio.nextSteps[<project>] is 'open') for
// a project created without a repository, on the real page (packages/ui-kit/test/renderer-app-harness.js) as
// project-next-steps-744.test.js drives it.
//
// The contract assumed here (decision of #25: "add a repository", no local backlog):
// - a project with no `repo` gets no "Open the PO" (no data-testid="next-step-po-issue-open", no enabled
//   data-next-step="po-issue" button) in the card;
// - instead an entry data-testid="next-step-needs-repo" says a repository is needed (its title is the catalog's
//   onboarding.next_steps_needs_repo, its line onboarding.next_steps_needs_repo_text, in the interface language);
// - its action data-testid="next-step-add-repo" (label onboarding.add_repo) opens the fix: the project's settings
//   (data-testid="project-settings", project-settings.js), as a Projects card's Edit does (openProject with
//   { settings: true });
// - a project with a repository keeps today's "Create an issue with the PO" entry and its "Open the PO".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const BASE = { id: PID, name: 'Field Notes', repo: null, folder: 'C:/ws/projects/field-notes', exists: true, workflows: [{ name: 'feature', category: 'build', variant: 'local-code' }] };
const WITH_REPO = { repo: 'https://github.com/o/field-notes.git' };
const clone = (x) => JSON.parse(JSON.stringify(x));
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const textOfKey = (lang, key) => String(catalog(lang)[key] ?? `(missing ${key})`);

async function projectPage({ project = {}, lang = 'en' } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => [clone({ ...BASE, ...project })],
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }) },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return app;
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const poButton = (app) => H.findEl(card(app)?.outer || '', (e) => e.attrs['data-testid'] === 'next-step-po-issue-open'
  || (e.name === 'button' && e.attrs['data-next-step'] === 'po-issue' && !('disabled' in e.attrs)));
const settingsOpen = (app) => {
  const el = H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-settings');
  return el === null ? 'absent' : 'open' in el.attrs ? 'open' : 'closed';
};

// ---- a project without a repository -----------------------------------------------------------------

test('#25 no repository: the Next steps card offers no "Open the PO"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  assert.equal(poButton(app) === null, true, 'no next-step-po-issue-open / enabled data-next-step="po-issue" in the card');
});

test('#25 no repository: the first entry of the card is data-testid="next-step-needs-repo"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const first = H.findAll(card(app)?.outer || '', (e) => e.name === 'li' && /^next-step-[\w-]+$/.test(e.attrs['data-testid'] || ''))[0];
  assert.equal(first ? first.attrs['data-testid'] : '(no entry)', 'next-step-needs-repo');
});

test('#25 no repository, en: the needs-repo entry says a repository is needed', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const entry = byTestId(card(app)?.outer || '', 'next-step-needs-repo');
  const text = entry ? H.visibleText(entry.inner) : '';
  assert.equal(text.includes(textOfKey('en', 'onboarding.next_steps_needs_repo')), true, `its title: ${text}`);
  assert.equal(/repositor/i.test(text), true, `it names the repository: ${text}`);
});

test('#25 no repository, pt-BR: the needs-repo entry says it in Portuguese', { timeout: 30000 }, async () => {
  const app = await projectPage({ lang: 'pt-BR' });
  const entry = byTestId(card(app)?.outer || '', 'next-step-needs-repo');
  const text = entry ? H.visibleText(entry.inner) : '';
  assert.equal(text.includes(textOfKey('pt-BR', 'onboarding.next_steps_needs_repo')), true, `its title: ${text}`);
  assert.equal(/repositório/i.test(text), true, `it says "repositório": ${text}`);
});

test('#25 no repository: the needs-repo entry carries its action data-testid="next-step-add-repo"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const entry = byTestId(card(app)?.outer || '', 'next-step-needs-repo');
  const action = byTestId(entry?.outer || '', 'next-step-add-repo');
  assert.equal(action === null, false, 'data-testid="next-step-add-repo" inside next-step-needs-repo');
  assert.equal('disabled' in (action?.attrs || {}), false, 'the action is enabled');
});

test('#25 no repository: "add a repository" opens the project\'s settings (the Projects › Edit form)', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(settingsOpen(app) === 'open', false, 'the settings start closed');
  const action = byTestId(card(app)?.outer || '', 'next-step-add-repo');
  assert.equal(action === null, false, 'data-testid="next-step-add-repo" in the card');
  await clickRendered(app, action);
  await app.settle(20);
  assert.equal(settingsOpen(app), 'open');
});

// ---- a project with a repository: unchanged ---------------------------------------------------------

test('#25 with a repository: the card keeps "Open the PO" and shows no needs-repo entry', { timeout: 30000 }, async () => {
  const app = await projectPage({ project: WITH_REPO });
  assert.equal(poButton(app) === null, false, 'next-step-po-issue-open in the card');
  assert.equal(byTestId(card(app)?.outer || '', 'next-step-needs-repo') === null, true, 'no next-step-needs-repo');
});
