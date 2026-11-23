// #22 acceptance, written before the code: the project's page (Projects › Overview › Workflows,
// fronts/build/views/projects/project-workflows.js) shows a card per workflow with the variant picked in
// the wizard (#729); its description must say what that variant runs, in the interface language, never the
// workflow file's generic English description ("Tests first: …" of workflows/feature.yaml) when the variant
// runs code first. Driven on the real page as project-workflows-cards-729.test.js does.
//
// The contract assumed here:
// - the card data-testid="pj-wf-card" data-workflow-id="<bare name>" (in #project-workflows) shows the
//   variant's label (OnboardingModel's, e.g. 'local-code' → "Local merge · code first") and a description;
// - for a `*-code` variant the card never says "Tests first" (nor "… before any code"); for a `*-e2e` variant it never says "code first"; the two variants' cards
//   do not carry the same description;
// - in pt-BR the card's texts are in Portuguese: no English description of the workflow file.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const FEATURE_DESCRIPTION = 'Tests first: the test writer writes the acceptance tests from the issue before any code, then the developer makes them pass.';
const FIX_DESCRIPTION = 'Reproduces a bug, fixes it with its regression test, reviews, tests and verifies it.';
const INSTALLED = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', description: FEATURE_DESCRIPTION, inputs: { task: {} } },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'bundled', description: FIX_DESCRIPTION, inputs: { task: {} } },
];
const BASE = { id: 'p1', name: 'Is Plain Obj', repo: 'https://github.com/o/is-plain-obj', folder: 'C:/work/is-plain-obj', exists: true, isGit: true, kind: 'backend' };
const clone = (x) => JSON.parse(JSON.stringify(x));

// The project's page, Overview, of p1 with these workflows ({ name: variant })
async function overviewWith(variants, { lang = 'en' } = {}) {
  const workflows = Object.entries(variants).map(([name, variant]) => ({ name, origin: 'bundled', category: 'build', variant }));
  const record = { ...BASE, workflows, defaultWorkflow: workflows[0].name };
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [clone(record)],
      listWorkflows: async () => clone(INSTALLED),
      projectManifest: async () => null,
      updateProject: async () => clone(record),
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async () => ({ runs: [], project: clone(record), local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: '', models: [], model: 'base', languages: ['en'], language: 'en' }),
    },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run('openProjectView("p1")');
  await app.settle(30);
  return app;
}

const boxMarkup = (app) => `<div id="project-workflows">${String(app.el('#project-workflows').innerHTML || '')}</div>`;
const cardOf = (app, id) => H.findAll(boxMarkup(app), (e) => e.attrs['data-testid'] === 'pj-wf-card' && e.attrs['data-workflow-id'] === id)[0] || null;
// everything the card says: its visible text and its tooltips
const saysOf = (el) => (el ? `${H.visibleText(el.inner)} ${H.findAll(el.outer, (e) => !!e.attrs.title).map((e) => e.attrs.title).join(' ')}` : '');
const TESTS_FIRST = /tests first|before any code|testes primeiro|antes de qualquer código/i;
const CODE_FIRST = /code first|código primeiro/i;

test('#22 a feature card with the local-code variant never shows a "Tests first" description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-code' });
  const feature = cardOf(app, 'feature');
  assert.equal(feature === null, false, 'the feature card is shown');
  const says = saysOf(feature);
  assert.equal(says.includes('Local merge · code first'), true, `the variant's label: ${says}`);
  assert.equal(TESTS_FIRST.test(saysOf(feature).replace('Local merge · code first', '')), false, `no "Tests first" description: ${says}`);
});

// #29: code first means the developer codes first; the card says the acceptance tests come after the code
test('#29 a feature card with the local-code variant says the code comes first and the acceptance tests after it', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-code' });
  const says = saysOf(cardOf(app, 'feature')).replace('Local merge · code first', '');
  assert.equal(/developer writes the code/i.test(says), true, `the developer codes first: ${says}`);
  assert.equal(/acceptance tests are written after/i.test(says), true, `the acceptance tests come after the code: ${says}`);
});

test('#22 a feature card with the local-e2e variant never shows a "code first" description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-e2e' });
  const says = saysOf(cardOf(app, 'feature'));
  assert.equal(says !== '', true, 'the feature card is shown');
  assert.equal(CODE_FIRST.test(says), false, `no "code first" on an E2E-first card: ${says}`);
});

test('#22 the local-code and local-e2e feature cards do not carry the same description', { timeout: 20000 }, async () => {
  const code = await overviewWith({ feature: 'local-code' });
  const e2e = await overviewWith({ feature: 'local-e2e' });
  const codeLabel = String(code.run('t("onboarding.choice_feature_local_code")'));
  const e2eLabel = String(e2e.run('t("onboarding.choice_feature_local_e2e")'));
  const codeSays = saysOf(cardOf(code, 'feature')).split(codeLabel).join('').trim();
  const e2eSays = saysOf(cardOf(e2e, 'feature')).split(e2eLabel).join('').trim();
  assert.equal(codeSays !== '' && e2eSays !== '', true, 'both cards are shown');
  assert.notEqual(codeSays, e2eSays, 'the description follows the variant');
});

test('#22 a fix card with the local-code variant never shows a "Tests first" description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-code', fix: 'local-code' });
  const says = saysOf(cardOf(app, 'fix'));
  assert.equal(says !== '', true, 'the fix card is shown');
  assert.equal(TESTS_FIRST.test(says), false, `no "Tests first" description: ${says}`);
});

test('#22 a fix card with the local-e2e variant keeps the fix workflow\'s own description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-code', fix: 'local-e2e' });
  const says = saysOf(cardOf(app, 'fix'));
  assert.equal(says.includes('Reproduces a bug, fixes it with its regression test'), true, `the fix card's description: ${says}`);
  assert.equal(CODE_FIRST.test(says), false, `no "code first" on the fix card: ${says}`);
});

test('#22 a workflow with no variant keeps its file\'s description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: undefined });
  const says = saysOf(cardOf(app, 'feature'));
  assert.equal(says.includes(FEATURE_DESCRIPTION), true, `the file's description: ${says}`);
});

test('#22 in pt-BR the local-code feature card says what runs in Portuguese, never the file\'s English description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-code' }, { lang: 'pt-BR' });
  const feature = cardOf(app, 'feature');
  assert.equal(feature === null, false, 'the feature card is shown');
  const says = saysOf(feature);
  assert.equal(says.includes('Merge local · código primeiro'), true, `the variant's label in pt-BR: ${says}`);
  assert.equal(says.includes('Tests first'), false, `no English "Tests first": ${says}`);
  assert.equal(says.includes('the test writer'), false, `no English description: ${says}`);
  assert.equal(/testes primeiro/i.test(says), false, `no "testes primeiro" on a code-first card: ${says}`);
  const description = says.split('Merge local · código primeiro').join('');
  assert.equal(/\b(the|writes|before|tests)\b/i.test(description), false, `the description is not English: ${description}`);
});

test('#22 in pt-BR the local-e2e feature card has a Portuguese description', { timeout: 20000 }, async () => {
  const app = await overviewWith({ feature: 'local-e2e' }, { lang: 'pt-BR' });
  const says = saysOf(cardOf(app, 'feature'));
  assert.equal(says.includes('Merge local · E2E primeiro'), true, `the variant's label in pt-BR: ${says}`);
  assert.equal(/tests first|the test writer|before any code/i.test(says), false, `no English description: ${says}`);
  assert.equal(CODE_FIRST.test(says), false, `no "código primeiro" on an E2E-first card: ${says}`);
});
