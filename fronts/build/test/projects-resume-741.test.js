// #741: an unfinished onboarding resumes at its step; one editor for a project. Acceptance tests, written
// before the code (renderer side; the engine's are packages/engine/test/project-onboarding-resume-741.test.js).
// The page is the real one (packages/ui-kit/test/renderer-app-harness.js), the wizard driven as
// project-wizard-helpers.js does; the engine is a fake api that echoes what the wizard saved.
//
// Contract assumed (implement these names):
// - api.saveOnboardingWizard({ projectId, step, picks }) (channel onboarding:save-wizard): the wizard calls it on
//   every change once the project exists (its step: an OnboardingModel step id; its picks: source, repository,
//   name, workflowsMode, analysis choice, refactor / finding picks, idea);
// - api.finishOnboarding(projectId) (channel onboarding:finish): called by Finish;
// - the onboarding state carries wizard: { step, picks, finished }; when api.startOnboarding (or
//   api.onboardingStatus) answers one, the wizard shows that step with those picks;
// - api.startOnboarding answering { exists: true, finished: true, projectId }: the wizard shows
//   data-testid="wizard-project-exists" with data-testid="wizard-open-existing" (opens the project's page);
// - window.ProjectWizard.open({ projectId }) opens the wizard on that project's onboarding (api.onboardingStatus);
// - Projects cards: a project with onboarding: { finished: false, step } reads "Onboarding not finished"
//   (projects.onboarding_not_finished) with a Continue button data-act="continue" (projects.continue_onboarding)
//   that opens the wizard on it; the card's Edit opens the project's page (its settings), never the old dialog;
//   the old New / Edit project dialog (data-testid="project-dialog", #project-modal) is gone from the page.
// - i18n keys (en.json and pt-BR.json): projects.onboarding_not_finished, projects.continue_onboarding,
//   onboarding.project_exists, onboarding.open_existing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const CATALOGS = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const PICKS = { source: 'import', repository: 'https://github.com/o/shop.git', name: 'Shop', workflowsMode: 'manual' };
const UNFINISHED = {
  id: 'p1', name: 'Shop', repo: 'https://github.com/o/shop.git', folder: 'C:/p/shop', exists: true, isGit: true,
  onboarding: { finished: false, step: 'analysis' },
};
const atStep = (projectId, step, picks) => ({ ...W.clone(W.READY), projectId, wizard: { step, picks: W.clone(picks), finished: false } });

// the page with a fake engine: startOnboarding answers the last saved wizard of the import, once there is one
function page({ projects = [], start = null, status = null } = {}) {
  let saved = null;
  return loadApp({
    storage: { 'multiagent.currentProject': projects[0]?.id || '' },
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => W.clone(projects),
      listProjectRuns: async (id) => ({ runs: [], project: projects.find((p) => p.id === id) || null, local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: null, issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      onboardingAccounts: async () => [],
      onboardingRepos: async () => [],
      architectureEstimate: async () => null,
      saveOnboardingWizard: async (data) => { saved = W.clone(data); return atStep(data?.projectId, data?.step, data?.picks); },
      finishOnboarding: async (id) => ({ ...W.clone(W.READY), projectId: id }),
      startOnboarding: async () => W.clone(start || (saved ? atStep(saved.projectId, saved.step, saved.picks) : W.CLONING)),
      onboardingStatus: async (id) => W.clone(status || { ...W.CLONING, projectId: id }),
      analyzeOnboarding: async (id) => ({ ...W.clone(W.ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...W.clone(W.CLONING), projectId: id }),
    },
  });
}

async function booted(opts) {
  const app = page(opts);
  await app.boot();
  return app;
}

async function onProjects(opts) {
  const app = await booted(opts);
  app.run("showView('projects')");
  await app.settle(10);
  app.el('#project-modal-title').textContent = '';
  return app;
}

const cardsMarkup = (app) => String(app.el('#projects-list').innerHTML || '');
const clickCard = (app, act) => app.click('[data-testid="project-card"]', { dataset: { act, id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
const columnState = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-workflows-column')?.attrs['data-state'] ?? null;
const wizardShown = (app) => { const el = app.created.find((e) => e.id === 'project-wizard'); return !!el && el.hidden !== true; };
const saves = (app) => app.callsTo('saveOnboardingWizard').map(([data]) => ({ projectId: data?.projectId, step: data?.step }));

// the wizard opened, the import of W.REPO / W.NAME started and its clone ready: on the analysis step
async function importedToAnalysis(app) {
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', W.NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.READY);
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis', 'the wizard is on the analysis step');
}

// ---- the wizard saves its step and picks -----------------------------------------------------------

test('#741 the wizard saves its step with the project\'s onboarding once the import started (the analysis step)', async () => {
  const app = await booted();
  await importedToAnalysis(app);
  assert.deepEqual(saves(app).at(-1), { projectId: W.PID, step: 'analysis' });
});

test('#741 the wizard saves again when a pick changes (Define manually)', async () => {
  const app = await booted();
  await importedToAnalysis(app);
  const before = saves(app).length;
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(columnState(app), 'manual', 'the pick was made');
  assert.equal(saves(app).length > before, true, `saves before ${before}, after ${saves(app).length}`);
});

test('#741 Finish tells the engine the onboarding is finished (finishOnboarding with the project)', async () => {
  const app = await booted();
  await importedToAnalysis(app);
  await W.press(app, 'wizard-next'); // analyze later: the review
  await Promise.race([W.press(app, 'wizard-finish'), app.settle(60)]);
  assert.deepEqual(app.callsTo('finishOnboarding').map((args) => args[0]), [W.PID]);
});

// ---- closed at step 3, New project again with the same URL ----------------------------------------

test('#741 closed at step 3, New project with the same URL comes back at step 3', async () => {
  const app = await booted();
  await importedToAnalysis(app);
  await W.press(app, 'wizard-workflows-choice-manual');
  await W.press(app, 'wizard-close');
  assert.equal(wizardShown(app), false, 'the wizard closed');
  await importedToAnalysisAgain(app);
  assert.equal(W.currentStep(app), 'analysis');
});

test('#741 closed at step 3, New project with the same URL comes back with its picks (Define manually)', async () => {
  const app = await booted();
  await importedToAnalysis(app);
  await W.press(app, 'wizard-workflows-choice-manual');
  await W.press(app, 'wizard-close');
  await importedToAnalysisAgain(app);
  assert.equal(columnState(app), 'manual');
});

// the wizard opened again, the same URL and Next: the engine answers the saved wizard (no READY event sent)
async function importedToAnalysisAgain(app) {
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', W.NAME);
  await W.press(app, 'wizard-next');
}

test('#741 New project with the repository of a finished onboarding says it exists and opens it', async () => {
  const app = await booted({ projects: [{ ...UNFINISHED, onboarding: { finished: true, step: 'review' } }], start: { exists: true, finished: true, projectId: 'p1' } });
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', UNFINISHED.repo);
  await W.typeInto(app, '#wizard-name', 'Shop');
  await W.press(app, 'wizard-next');
  assert.equal(!!W.byTestId(W.wizardMarkup(app), 'wizard-project-exists'), true, 'the wizard says the project exists');
  await W.press(app, 'wizard-open-existing');
  assert.equal(app.state().view, 'project');
});

// ---- the Projects card ----------------------------------------------------------------------------

test('#741 a project whose onboarding is not finished reads "Onboarding not finished" on its card', async () => {
  const app = await onProjects({ projects: [UNFINISHED] });
  assert.equal(H.visibleText(cardsMarkup(app)).includes('Onboarding not finished'), true, H.visibleText(cardsMarkup(app)));
});

test('#741 the card of an unfinished onboarding has a Continue button (data-act="continue")', async () => {
  const app = await onProjects({ projects: [UNFINISHED] });
  const btn = H.findEl(cardsMarkup(app), (e) => e.name === 'button' && e.attrs['data-act'] === 'continue');
  assert.equal(btn ? H.visibleText(btn.inner).trim() : null, 'Continue');
});

test('#741 the card\'s Continue opens the wizard on the project\'s saved step', async () => {
  const app = await onProjects({ projects: [UNFINISHED], status: atStep('p1', 'analysis', PICKS) });
  await clickCard(app, 'continue');
  await app.settle(10);
  assert.equal(app.callsTo('onboardingStatus').some((args) => args[0] === 'p1' || args[0]?.projectId === 'p1'), true, 'the wizard read the project\'s onboarding');
  assert.equal(wizardShown(app), true, 'the wizard is open');
  assert.equal(W.currentStep(app), 'analysis');
});

test('#741 the card\'s Continue opens the wizard with the saved picks (the name, Define manually)', async () => {
  const app = await onProjects({ projects: [UNFINISHED], status: atStep('p1', 'analysis', PICKS) });
  await clickCard(app, 'continue');
  await app.settle(10);
  assert.equal(columnState(app), 'manual');
  await W.press(app, 'wizard-back');
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-name')?.attrs.value ?? null, 'Shop');
});

test('#741 ProjectWizard.open({ projectId }) opens the wizard on that project\'s saved step', async () => {
  const app = await booted({ projects: [UNFINISHED], status: atStep('p1', 'review', PICKS) });
  W.wizard(app).open({ projectId: 'p1' });
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
});

test('#741 the card\'s Edit opens the project\'s page (its settings), not the old project dialog', async () => {
  const app = await onProjects({ projects: [{ ...UNFINISHED, onboarding: { finished: true, step: 'review' } }] });
  await clickCard(app, 'edit');
  await app.settle(10);
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old dialog was not opened');
  assert.equal(app.state().view, 'project');
});

test('#741 the old New / Edit project dialog is gone from the page', () => {
  const app = loadApp();
  const holders = [...app.defs].filter(([, def]) => /data-testid="project-dialog"|id="project-modal"/.test(`${def.markup || ''}${def.modals || ''}`)).map(([id]) => id);
  assert.deepEqual(holders, []);
});

// ---- i18n -----------------------------------------------------------------------------------------

test('#741 the card\'s and the wizard\'s new texts are in en.json and pt-BR.json', () => {
  const en = readJson(path.join(CATALOGS, 'en.json'));
  const pt = readJson(path.join(CATALOGS, 'pt-BR.json'));
  const keys = ['projects.onboarding_not_finished', 'projects.continue_onboarding', 'onboarding.project_exists', 'onboarding.open_existing'];
  const missing = keys.flatMap((k) => [[en, 'en'], [pt, 'pt-BR']].filter(([c]) => !String(c[k] || '').trim()).map(([, l]) => `${l}:${k}`));
  assert.deepEqual(missing, []);
  assert.equal(en['projects.onboarding_not_finished'], 'Onboarding not finished');
});
