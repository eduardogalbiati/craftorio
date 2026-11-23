// #25 acceptance, written before the code: the new-project wizard's create step (fronts/build/views/projects/
// project-wizard.js, step 2 of "Create new project"), on the real page (packages/ui-kit/test/renderer-app-harness.js)
// as project-wizard-create-632.test.js drives it.
//
// The contract assumed here: next to the checkbox "Create a private repository too" (data-testid="wizard-new-remote")
// a hint data-testid="wizard-no-remote-hint" says that without a repository the Backlog and the Roadmap are not
// available (the catalog's onboarding.no_remote_hint, in the interface language).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const GL_OUT = { provider: 'gitlab', cli: 'glab', installed: false, signedIn: false };
const clone = (x) => JSON.parse(JSON.stringify(x));
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const textOfKey = (lang, key) => String(catalog(lang)[key] ?? `(missing ${key})`);

// the markup of an element by id, with what was written into the ids inside it (as in the #632 test)
function markupOf(app, id) {
  const parts = [];
  const seen = new Set([id]);
  const follow = (el, depth) => {
    const html = String(el?.innerHTML || '');
    parts.push(html || String(el?.textContent || ''));
    if (depth > 3) return;
    for (const m of html.matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const inner = existing(app, m[1]);
      if (inner && (inner.innerHTML || inner.textContent)) follow(inner, depth + 1);
    }
  };
  follow(existing(app, id), 0);
  return parts.join('\n');
}
const wizardMarkup = (app) => markupOf(app, 'project-wizard');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function atCreate(lang) {
  const app = loadApp({
    api: {
      listProjects: async () => [],
      onboardingAccounts: async () => clone([GH_IN, GL_OUT]),
      onboardingRepos: async () => [],
      createOnboarding: async () => ({ projectId: 'field-notes', status: 'ready', jobs: {}, cli: null }),
      onboardingStatus: async () => null,
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
    },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.sandbox.ProjectWizard.open();
  await app.settle(20);
  await press(app, 'wizard-source-new');
  await press(app, 'wizard-next');
  assert.ok(byTestId(wizardMarkup(app), 'wizard-new-remote'), 'the create step with its remote checkbox');
  return app;
}

const hintText = (app) => {
  const el = byTestId(wizardMarkup(app), 'wizard-no-remote-hint');
  return el === null ? null : H.visibleText(el.inner);
};

test('#25 wizard step 2: a hint data-testid="wizard-no-remote-hint" is shown with the remote checkbox', { timeout: 20000 }, async () => {
  const app = await atCreate('en');
  assert.equal(hintText(app) === null, false, 'data-testid="wizard-no-remote-hint" in the create step');
});

test('#25 wizard step 2, en: the hint says the Backlog and the Roadmap need a repository', { timeout: 20000 }, async () => {
  const app = await atCreate('en');
  const text = hintText(app) || '';
  assert.equal(text.includes(textOfKey('en', 'onboarding.no_remote_hint')), true, `the hint: ${text}`);
  assert.equal(/Backlog/.test(text) && /Roadmap/.test(text), true, `the hint: ${text}`);
});

test('#25 wizard step 2, pt-BR: the hint says it in Portuguese', { timeout: 20000 }, async () => {
  const app = await atCreate('pt-BR');
  const text = hintText(app) || '';
  assert.equal(text.includes(textOfKey('pt-BR', 'onboarding.no_remote_hint')), true, `the hint: ${text}`);
  assert.equal(/repositório/i.test(text), true, `it says "repositório": ${text}`);
});
