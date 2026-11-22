// #20 acceptance, written before the code: on an import, "Define manually" (workflows-manual) on step 3 no longer
// skips the ticked analyses. Continue starts the city analysis that was not started (never "analyze later" unless
// the owner pressed "Skip, analyze later"), the Review never says the analyses were skipped while a job runs or is
// done, and the Review's languages come from the facts job, not the city (project map) job. On the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven through project-wizard-helpers.js.
//
// The contract assumed here:
// - the analysis start boundary is api.analyzeOnboarding(projectId): after Define manually, it is called at the
//   latest when Continue is pressed (calling it already at the Define manually click is fine too);
// - the persisted wizard state is api.saveOnboardingWizard({ projectId, step, picks }); picks.analyzeLater is
//   true only after "Skip, analyze later" (wizard-skip) or for a new project (#850);
// - the Review's banner is the catalog's onboarding.review_later; the city card is data-testid="wizard-review-city"
//   with data-state "later" (left for later) or "pending" (running, with wizard-review-running);
// - the import's City and architecture row is always ticked (its checkbox is disabled): "import with the city
//   unticked" cannot be reached through the interface, so its case is covered by the new project (#850) guard;
// - the languages block is data-testid="wizard-review-languages" in the project card (#852), read with
//   api.architectureFacts once the facts job is done.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const REVIEW_LATER = catalog('en')['onboarding.review_later'];

const LANGUAGES = [{ language: 'Rust', lines: 800, files: 40 }, { language: 'Markdown', lines: 200, files: 9 }];
const FACTS = { state: 'ok', exclude: [], model: { files: [{ file: 'src/main.rs', lines: 800, commits: 40, language: 'rust' }], languages: LANGUAGES, danger_zone: [], complexity: { metric: 'cyclomatic', tool: 'test' } } };
const stateWith = (status, over) => ({ projectId: W.PID, status, cli: W.CLI_OK, jobs: W.jobs({ clone: { status: 'done' }, ...over }) });
const MAP_RUNNING = stateWith('analyzing', { facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'running' } });
const MAP_DONE = stateWith('analyzed', { facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' } });

// the review's reads and the wizard's save, over the helpers' api
const REVIEW_API = {
  saveOnboardingWizard: async (data) => ({ ...W.clone(W.READY), projectId: data?.projectId }),
  architectureCity: async () => null,
  architectureFacts: async () => W.clone(FACTS),
  architectureReport: async () => null,
  refactorProposals: async () => [],
  getBacklog: async () => ({ issues: [] }),
  backlogProgress: async () => null,
};
const atAnalysis = (api = {}) => W.atAnalysis({ api: { ...REVIEW_API, ...api } });

const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const reviewText = (app) => textOf(W.byTestId(W.wizardMarkup(app), 'wizard-review'));
const cityState = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-review-city')?.attrs['data-state'] ?? null;
const analyzeCalls = (app) => app.callsTo('analyzeOnboarding').map((c) => c[0]);
// the last persisted picks.analyzeLater (null when nothing was saved)
function savedAnalyzeLater(app) {
  const calls = app.callsTo('saveOnboardingWizard');
  if (!calls.length) return null;
  return JSON.parse(JSON.stringify(calls.at(-1)[0] || {})).picks?.analyzeLater ?? false;
}

async function toReview(app) {
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
}

// ---- 1. Define manually starts the city analysis ------------------------------------------------------------

test('#20 import, Define manually then Continue: the city analysis is started (api.analyzeOnboarding with the project)', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.deepEqual([...new Set(analyzeCalls(app))], [W.PID], `api.analyzeOnboarding calls: ${JSON.stringify(analyzeCalls(app))}`);
});

test('#20 import, Define manually then Continue: the Review\'s city card is running, not left for later', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(cityState(app), 'pending', `wizard-review-city data-state: ${cityState(app)}`);
  const city = W.byTestId(W.wizardMarkup(app), 'wizard-review-city');
  assert.ok(W.byTestId(city?.outer || '', 'wizard-review-running'), 'the city card shows its running indicator');
});

// ---- 2. Continue is not Skip ----------------------------------------------------------------------------------

test('#20 import, Define manually then Continue: the saved wizard state is not analyzeLater', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
});

test('#20 import, Define manually then Continue: the Review does not say the analyses were skipped', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
});

// ---- 3. Skip, analyze later is unchanged --------------------------------------------------------------------

test('#20 guard: import, "Skip, analyze later": analyzeLater saved, the Review says so, no analysis started', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-skip');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
  assert.equal(savedAnalyzeLater(app), true, 'the last api.saveOnboardingWizard picks.analyzeLater');
  assert.equal(reviewText(app).includes(REVIEW_LATER), true, reviewText(app));
  assert.equal(cityState(app), 'later');
  assert.equal(analyzeCalls(app).length, 0, 'api.analyzeOnboarding is not called');
});

// ---- 5. Back, Analyze, Continue: the stale banner goes ---------------------------------------------------------

test('#20 after Skip, Back then "Analyze the repository" then Continue: the Review no longer says the analyses were skipped', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-skip');
  await app.settle(20);
  assert.equal(reviewText(app).includes(REVIEW_LATER), true, 'the banner after Skip');
  await W.press(app, 'wizard-back');
  assert.equal(W.currentStep(app), 'analysis', 'back on step 3');
  await W.press(app, 'wizard-workflows-choice-analyze');
  assert.deepEqual([...new Set(analyzeCalls(app))], [W.PID], 'Analyze the repository starts the analysis');
  await toReview(app);
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
  assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
});

// ---- 6. never the banner while a job runs or is done ---------------------------------------------------------

for (const [what, state] of [['running', MAP_RUNNING], ['done', MAP_DONE]]) {
  test(`#20 the Review never says the analyses were skipped while the city job is ${what} (even after Skip)`, { timeout: 30000 }, async () => {
    const app = await atAnalysis();
    await W.press(app, 'wizard-skip');
    await app.settle(20);
    assert.equal(W.currentStep(app), 'review', 'the review');
    await W.emit(app, state);
    await app.settle(20);
    assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
  });
}

// ---- 7. languages from the facts job ---------------------------------------------------------------------------

test('#20 the Review\'s languages show once the facts job is done, while the city job still runs', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: async (id) => ({ ...W.clone(MAP_RUNNING), projectId: id }) });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, MAP_RUNNING);
  await toReview(app);
  await app.settle(20);
  const card = H.findEl(W.wizardMarkup(app), (e) => W.classesOf(e).includes('wizard-review-project'));
  assert.ok(W.byTestId(card?.outer || '', 'wizard-review-languages'), `data-testid="wizard-review-languages" in the project card: ${textOf(card)}`);
  assert.equal(app.callsTo('architectureFacts').length > 0, true, 'api.architectureFacts was read');
});

test('#20 guard: the facts job not done and the city job running: no languages bar yet', { timeout: 30000 }, async () => {
  const running = stateWith('analyzing', { facts: { status: 'running' }, profile: { status: 'waiting' }, projectMap: { status: 'waiting' } });
  const app = await atAnalysis({ analyzeOnboarding: async (id) => ({ ...W.clone(running), projectId: id }) });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await toReview(app);
  const card = H.findEl(W.wizardMarkup(app), (e) => W.classesOf(e).includes('wizard-review-project'));
  assert.equal(W.byTestId(card?.outer || '', 'wizard-review-languages'), null, textOf(card));
});

// ---- 7b. Continue when the analysis is not 'ready': the clone still running, a failed state (review round 1) ---

// step 3 reached with the onboarding in `state` (Next on step 2 when the wizard waits there)
async function atAnalysisWhile(state, api = {}) {
  let app;
  if (state.status === 'cloning') {
    app = await W.imported(state, { api: { ...REVIEW_API, ...api } });
    if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  } else {
    app = await atAnalysis(api);
    await W.emit(app, state);
  }
  assert.equal(W.currentStep(app), 'analysis', 'the wizard is on the analysis step');
  return app;
}

const ANALYSIS_FAILED = stateWith('failed', { facts: { status: 'failed', error: 'boom' } });
for (const [what, state] of [['the clone is still running', W.CLONING], ['the onboarding failed', ANALYSIS_FAILED]]) {
  test(`#20 import, Define manually then Continue while ${what}: the analysis is asked for and the Review does not say it was skipped`, { timeout: 30000 }, async () => {
    const app = await atAnalysisWhile(state);
    await W.press(app, 'wizard-workflows-choice-manual');
    await toReview(app);
    assert.deepEqual([...new Set(analyzeCalls(app))], [W.PID], `api.analyzeOnboarding calls: ${JSON.stringify(analyzeCalls(app))}`);
    assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
    assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
  });
}

test('#20 import, Continue when starting the analysis is refused: the wizard stays on step 3, nothing saved as skipped', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: async () => { throw new Error('engine refused'); } });
  await W.press(app, 'wizard-workflows-choice-manual');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(analyzeCalls(app).length, 1, 'api.analyzeOnboarding was asked once');
  assert.equal(W.currentStep(app), 'analysis', 'still on step 3');
  assert.notEqual(savedAnalyzeLater(app), true, 'not saved as "analyze later"');
});

test('#20 import, closing the wizard while Continue starts the analysis: no error, the wizard stays closed', { timeout: 30000 }, async () => {
  const errors = [];
  const onError = (e) => errors.push(String(e?.stack || e));
  process.on('unhandledRejection', onError);
  process.on('uncaughtException', onError);
  try {
    let app = null;
    app = await atAnalysis({
      analyzeOnboarding: async (id) => { W.wizard(app).close(); await Promise.resolve(); return { ...W.clone(MAP_RUNNING), projectId: id }; },
    });
    await W.press(app, 'wizard-workflows-choice-manual');
    await W.press(app, 'wizard-next');
    await app.settle(20);
    assert.equal(analyzeCalls(app).length, 1, 'api.analyzeOnboarding was asked');
    assert.deepEqual(errors, [], 'no error after the wizard closed');
    assert.equal(W.currentStep(app), null, 'the wizard is closed');
  } finally {
    process.off('unhandledRejection', onError);
    process.off('uncaughtException', onError);
  }
});

// ---- 8. a new project: the city stays left for later (#850)------------------------------------------------------

const NEW_PID = 'field-notes';
const CREATED = {
  projectId: NEW_PID, name: 'Field Notes', status: 'ready', cli: null,
  jobs: { clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' }, profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone' } } },
};

test('#20 guard (#850): a new project, Continue on step 3: the city stays left for later, no analysis started, no skipped banner', { timeout: 30000 }, async () => {
  const app = W.page({
    start: CREATED,
    accounts: [{ provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' }],
    api: { ...REVIEW_API, createOnboarding: async () => W.clone(CREATED), onboardingStatus: async () => W.clone(CREATED) },
  });
  await app.boot();
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', 'Field Notes');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  assert.ok(W.byTestId(W.wizardMarkup(app), 'wizard-job-later-projectMap'), 'step 3: the city row is left for later');
  await toReview(app);
  assert.equal(analyzeCalls(app).length, 0, 'api.analyzeOnboarding is not called');
  assert.equal(cityState(app), 'later');
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
});
