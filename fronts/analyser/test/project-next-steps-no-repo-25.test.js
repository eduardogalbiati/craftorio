// #25, revised by #35: the Next steps card on the project's page (fronts/analyser/views/project/project.js, shown
// while localStorage craftorio.nextSteps[<project>] is 'open') for a project created without a repository, on the
// real page (packages/ui-kit/test/renderer-app-harness.js) as project-next-steps-744.test.js drives it.
//
// #25 replaced its first entry by data-testid="next-step-needs-repo" ("Add a repository to create issues").
// #35's decision: "a project with no remote gets a local backlog", so the card is the same as for a project with a
// repository again:
// - its first entry is data-testid="next-step-po-issue" ("Create an issue with the PO" / "Criar uma issue com o PO")
//   with its "Open the PO" (data-testid="next-step-po-issue-open");
// - no next-step-needs-repo entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const BASE = { id: PID, name: 'Field Notes', repo: null, folder: 'C:/ws/projects/field-notes', exists: true, workflows: [{ name: 'feature', category: 'build', variant: 'local-code' }] };
const WITH_REPO = { repo: 'https://github.com/o/field-notes.git' };
const clone = (x) => JSON.parse(JSON.stringify(x));

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
const entries = (app) => H.findAll(card(app)?.outer || '', (e) => e.name === 'li' && /^next-step-[\w-]+$/.test(e.attrs['data-testid'] || ''));

// ---- a project without a repository: its local backlog (#35) ------------------------------------------

test('#35 no repository: the Next steps card offers "Open the PO"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  assert.equal(poButton(app) === null, false, 'next-step-po-issue-open in the card');
});

test('#35 no repository: the first entry of the card is data-testid="next-step-po-issue"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const first = entries(app)[0];
  assert.equal(first ? first.attrs['data-testid'] : '(no entry)', 'next-step-po-issue');
});

test('#35 no repository, pt-BR: the first entry reads "Criar uma issue com o PO"', { timeout: 30000 }, async () => {
  const app = await projectPage({ lang: 'pt-BR' });
  const first = entries(app)[0];
  const text = first ? H.visibleText(first.inner) : '';
  assert.equal(text.includes('Criar uma issue com o PO'), true, `the first entry: ${text}`);
});

test('#35 no repository: the card has no next-step-needs-repo entry', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(byTestId(card(app)?.outer || '', 'next-step-needs-repo'), null);
});

// ---- a project with a repository: unchanged ---------------------------------------------------------

test('#25 with a repository: the card keeps "Open the PO" and shows no needs-repo entry', { timeout: 30000 }, async () => {
  const app = await projectPage({ project: WITH_REPO });
  assert.equal(poButton(app) === null, false, 'next-step-po-issue-open in the card');
  assert.equal(byTestId(card(app)?.outer || '', 'next-step-needs-repo') === null, true, 'no next-step-needs-repo');
});
