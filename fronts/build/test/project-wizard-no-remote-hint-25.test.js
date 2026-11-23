// #25, revised by #35: the new-project wizard's create step (fronts/build/views/projects/project-wizard.js, step 2
// of "Create new project"), on the real page (packages/ui-kit/test/renderer-app-harness.js) as
// project-wizard-create-632.test.js drives it.
//
// #25 added data-testid="wizard-no-remote-hint" (onboarding.no_remote_hint): "Without a repository the Backlog and
// the Roadmap are not available…" / "Sem um repositório, o Backlog e o Roadmap não ficam disponíveis…". #35's
// decision: "a project with no remote gets a local backlog", so the step no longer says so (a hint may stay, saying
// something else, e.g. that the issues stay in the workspace).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const GL_OUT = { provider: 'gitlab', cli: 'glab', installed: false, signedIn: false };
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// the create step's visible text (a string)
const stepText = (app) => H.visibleText(wizardMarkup(app));

test('#35 wizard step 2, en: nothing says the Backlog and the Roadmap are not available without a repository', { timeout: 20000 }, async () => {
  const app = await atCreate('en');
  const text = stepText(app);
  assert.equal(text.includes('Without a repository the Backlog and the Roadmap are not available'), false, text);
  assert.equal(/not available/i.test(text), false, text);
});

test('#35 wizard step 2, pt-BR: nothing says "o Backlog e o Roadmap não ficam disponíveis"', { timeout: 20000 }, async () => {
  const app = await atCreate('pt-BR');
  const text = stepText(app);
  assert.equal(text.includes('o Backlog e o Roadmap não ficam disponíveis'), false, text);
  assert.equal(/não ficam disponíveis/i.test(text), false, text);
});
