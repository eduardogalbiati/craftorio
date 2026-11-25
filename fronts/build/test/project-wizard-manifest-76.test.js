// #76 acceptance, written before the code: the new-project wizard (fronts/build/views/projects/) reads a
// repository's workflows manifest only when there is something to read. On the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-new-project-850.test.js and
// project-wizard-default-kinds-790-791.test.js drive it.
//
// The contract assumed here:
// - api.projectManifest is never called without a non-empty folder or url: a new project with no repository,
//   taken from step 1 to its Review, never asks for it;
// - once the project's record (state.projects) has a folder, the manifest is read with { folder };
// - an import whose record has no folder yet still reads it with { url }, and its default reaches step 3.
// The fake projectManifest refuses an empty target, as the projects:manifest channel does.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const NAME = 'Field Notes';
const NEW_PID = 'field-notes';
const FOLDER = 'C:/ws/projects/field-notes';
const CREATED = {
  projectId: NEW_PID, name: NAME, status: 'ready', cli: null,
  jobs: {
    clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' },
    profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone', tests: null, testCommand: null } },
  },
};

// the projects:manifest channel: an empty target is refused, else the repository's manifest (or null)
const manifestOf = (manifest) => async (target) => {
  if (!target?.url && !target?.folder) throw new Error('Invalid manifest target: expected { url } or { folder }.');
  return W.clone(manifest);
};

// the targets api.projectManifest was called with, as JSON (the page's objects are another realm's)
const targets = (app) => app.callsTo('projectManifest').map((args) => JSON.stringify(args));

// a new project taken from step 1 to step 3; records: what the service lists (the page's state.projects)
async function newAtAnalysis({ records = [] } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => W.clone(records),
      onboardingAccounts: async () => [],
      onboardingRepos: async () => [],
      createOnboarding: async () => W.clone(CREATED),
      onboardingStatus: async () => W.clone(CREATED),
      architectureEstimate: async () => null,
      getBacklog: async () => ({ issues: [] }),
      projectManifest: manifestOf(null),
    },
  });
  await app.boot();
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', NAME);
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  return app;
}

async function toReview(app) {
  // the engine's event of the created project, as onboarding:changed pushes it
  await W.emit(app, CREATED);
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
}

test('#76 a new project with no repository never asks for a manifest, from step 1 to its Review', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  await toReview(app);
  assert.equal(targets(app).join(' | '), '');
});

test('#76 a new project whose record has a folder reads the manifest of that folder only', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis({ records: [{ id: NEW_PID, name: NAME, repo: null, folder: FOLDER, exists: true }] });
  await toReview(app);
  assert.equal([...new Set(targets(app))].join(' | '), JSON.stringify([{ folder: FOLDER }]));
});

test('#76 an import still reads the manifest of its URL, and the default it declares reaches step 3', { timeout: 30000 }, async () => {
  const manifest = { workflows: [{ name: 'hero', category: 'solo' }, { name: 'feature', category: 'solo' }], default: 'hero', kinds: {} };
  // the analysis under way with its profile found: step 3 shows its workflow selects
  const profiled = { ...W.ANALYZING, jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } }, projectMap: { status: 'running' } }) };
  const app = await W.atAnalysis({ api: { projectManifest: manifestOf(manifest), analyzeOnboarding: async () => W.clone(profiled) } });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, profiled);
  assert.equal([...new Set(targets(app))].join(' | '), JSON.stringify([{ url: W.REPO }]));
  const select = H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === 'default');
  assert.match(String(select?.outer ?? ''), /<option value="hero(\.yaml)?"[^>]*\bselected\b/);
});
