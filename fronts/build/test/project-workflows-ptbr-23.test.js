// #23 acceptance, written before the code: the project's page › Workflows (fronts/build/views/projects/
// project-workflows.js) in pt-BR never shows a bundled workflow file's English description on its cards: not
// feature.yaml's "Tests first: …" (a feature with no variant), not fix.yaml's "Reproduces a bug, fixes it…", not
// release.yaml's "Checks what merged locally…". Driven on the real page as project-workflows-variant-22.test.js;
// in English the cards keep the file's own description.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const FEATURE_DESCRIPTION = 'Tests first: the test writer writes the acceptance tests from the issue before any code, then the developer makes them pass.';
const FIX_DESCRIPTION = 'Reproduces a bug, fixes it with its regression test, reviews, tests and verifies it.';
const RELEASE_DESCRIPTION = 'Checks what merged locally since the last release with the project\'s whole unit suite and whole E2E suite, then you Ship or Hold.';
const INSTALLED = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', description: FEATURE_DESCRIPTION, inputs: { task: {} } },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'bundled', description: FIX_DESCRIPTION, inputs: { task: {} } },
  { file: 'release.yaml', name: 'release', category: 'build', origin: 'bundled', description: RELEASE_DESCRIPTION, inputs: {} },
];
const BASE = { id: 'p1', name: 'Shop', repo: 'https://github.com/o/shop', folder: 'C:/work/shop', exists: true, isGit: true, kind: 'backend' };
const clone = (x) => JSON.parse(JSON.stringify(x));

async function overviewWith(workflows, lang) {
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
const saysOf = (el) => (el ? `${H.visibleText(el.inner)} ${H.findAll(el.outer, (e) => !!e.attrs.title).map((e) => e.attrs.title).join(' ')}` : '');

const WORKFLOWS = [
  { name: 'feature', origin: 'bundled', category: 'build' },
  { name: 'fix', origin: 'bundled', category: 'build', variant: 'local-e2e' },
  { name: 'release', origin: 'bundled', category: 'build', variant: 'milestone' },
];
const ENGLISH = { feature: 'Tests first:', fix: 'Reproduces a bug, fixes it', release: 'Checks what merged locally' };

for (const [id, english] of Object.entries(ENGLISH)) {
  test(`#23 Workflows in pt-BR: the ${id} card never shows "${english}…"`, { timeout: 20000 }, async () => {
    const app = await overviewWith(WORKFLOWS, 'pt-BR');
    const says = saysOf(cardOf(app, id));
    assert.equal(says !== '', true, `the ${id} card is shown`);
    assert.equal(says.includes(english), false, says);
  });
}

test('#23 Workflows in pt-BR: the three cards still carry a description', { timeout: 20000 }, async () => {
  const app = await overviewWith(WORKFLOWS, 'pt-BR');
  const descriptions = Object.keys(ENGLISH).map((id) => {
    const card = cardOf(app, id);
    const desc = card && H.findEl(card.outer, (e) => String(e.attrs.class || '').split(/\s+/).includes('pj-wf-card-desc'));
    return desc ? H.visibleText(desc.inner).trim() : '';
  });
  assert.deepEqual(descriptions.map((d) => d.length > 0), [true, true, true], JSON.stringify(descriptions));
});

test('#23 guard: Workflows in English keep the files\' own descriptions', { timeout: 20000 }, async () => {
  const app = await overviewWith(WORKFLOWS, 'en');
  assert.equal(saysOf(cardOf(app, 'feature')).includes(FEATURE_DESCRIPTION), true);
  assert.equal(saysOf(cardOf(app, 'fix')).includes(FIX_DESCRIPTION), true);
  assert.equal(saysOf(cardOf(app, 'release')).includes(RELEASE_DESCRIPTION), true);
});
