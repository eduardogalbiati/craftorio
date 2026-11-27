// #20, as craftorio#100 changed it (the owner's decision, 2026-11-26; these tests were written for #20 and rewritten
// for #100): on an import, Continue on step 3 starts nothing. "Define manually" (workflows-manual) then Continue is
// the free path that "Skip, analyze later" was (wizard-skip no longer exists): no analysis is started and it is left
// for later (analyzeLater); only "Analyze with AI" starts it (api.analyzeOnboarding, once), and Continue after it
// neither starts it again nor leaves it for later. Still #20's: the Review never says the analyses were skipped while
// a job runs or is done, and the Review's languages come from the facts job, not the city (project map) job. On the
// real page (packages/ui-kit/test/renderer-app-harness.js), driven through project-wizard-helpers.js.
//
// The contract assumed here:
// - the analysis start boundary is api.analyzeOnboarding(projectId): called by the Analyze with AI click only, never
//   by Continue (wizard-next), which is disabled until the workflows are defined;
// - the persisted wizard state is api.saveOnboardingWizard({ projectId, step, picks }); picks.analyzeLater is
//   true after Define manually then Continue with no analysis asked for, or for a new project (#850); false once
//   the analysis was asked for (the engine's status analyzing / analyzed, or its `wanted` during the clone);
// - the Review's banner is the catalog's onboarding.review_later; the city card is data-testid="wizard-review-city"
//   with data-state "later" (left for later) or "pending" (running, with wizard-review-running);
// - the import's City and architecture row is always ticked (its checkbox is disabled): "import with the city
//   unticked" cannot be reached through the interface, so its case is covered by the new project (#850) guard
//   (a new project's step 3 no longer lists the jobs: the guard reads the review);
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
// the profile job done with a valid profile: the workflows are defined (#100: one done with none locks Continue)
const PROFILED = { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } };
const MAP_RUNNING = stateWith('analyzing', { facts: { status: 'done' }, profile: PROFILED, projectMap: { status: 'running' } });
const MAP_DONE = stateWith('analyzed', { facts: { status: 'done' }, profile: PROFILED, projectMap: { status: 'done' } });

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

// ---- 1. #100: Define manually then Continue starts nothing ---------------------------------------------------

const nextOf = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-next');

test('#20 #100 import, Define manually then Continue: no analysis is started (api.analyzeOnboarding is never called)', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.deepEqual(analyzeCalls(app), [], `api.analyzeOnboarding calls: ${JSON.stringify(analyzeCalls(app))}`);
  assert.equal(app.callsTo('retryOnboarding').length, 0, 'nor api.retryOnboarding');
});

test('#20 #100 import, Define manually then Continue: the Review\'s city card is left for later, not running', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(cityState(app), 'later', `wizard-review-city data-state: ${cityState(app)}`);
  const city = W.byTestId(W.wizardMarkup(app), 'wizard-review-city');
  assert.equal(W.byTestId(city?.outer || '', 'wizard-review-running'), null, 'the city card shows no running indicator');
});

// ---- 2. #100: Continue after Define manually is what Skip was ---------------------------------------------------

test('#20 #100 import, Define manually then Continue: the saved wizard state is analyzeLater', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(savedAnalyzeLater(app), true, 'the last api.saveOnboardingWizard picks.analyzeLater');
});

test('#20 #100 import, Define manually then Continue: the Review says the analyses were left for later', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(reviewText(app).includes(REVIEW_LATER), true, reviewText(app));
});

// ---- 3. #100: "Skip, analyze later" is gone; Continue waits for the workflows -----------------------------------

test('#20 #100 guard: import, no "Skip, analyze later" (wizard-skip); Continue is locked until the workflows are defined, then leaves the analysis for later', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-skip'), null, 'no data-testid="wizard-skip" while the two choices show');
  assert.equal('disabled' in nextOf(app).attrs, true, 'Continue is disabled while the two choices show');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'a click on the locked Continue stays on step 3');
  assert.equal(analyzeCalls(app).length, 0, 'and starts nothing');
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-skip'), null, 'no data-testid="wizard-skip" beside the rows');
  assert.equal('disabled' in nextOf(app).attrs, false, 'Continue is enabled once the workflows are defined');
  await toReview(app);
  assert.equal(savedAnalyzeLater(app), true, 'the last api.saveOnboardingWizard picks.analyzeLater');
  assert.equal(reviewText(app).includes(REVIEW_LATER), true, reviewText(app));
  assert.equal(cityState(app), 'later');
  assert.equal(analyzeCalls(app).length, 0, 'api.analyzeOnboarding is not called');
});

// ---- 4. #100: Analyze with AI is the one start; Continue after it starts nothing more ----------------------------

test('#20 #100 import, Analyze with AI then Continue: one api.analyzeOnboarding call (the click\'s), not saved as analyzeLater, the city card running', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-analyze');
  assert.deepEqual(analyzeCalls(app), [W.PID], 'Analyze with AI starts the analysis');
  assert.equal('disabled' in nextOf(app).attrs, false, 'Continue is enabled as soon as the analysis is asked for');
  await toReview(app);
  assert.deepEqual(analyzeCalls(app), [W.PID], 'Continue does not start it a second time');
  assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
  assert.equal(cityState(app), 'pending', `wizard-review-city data-state: ${cityState(app)}`);
});

// ---- 5. Back, Analyze, Continue: the stale banner goes ---------------------------------------------------------

test('#20 after Define manually and Continue, Back then "Analyze with AI" then Continue: the Review no longer says the analyses were skipped', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(reviewText(app).includes(REVIEW_LATER), true, 'the banner after Define manually and Continue');
  await W.press(app, 'wizard-back');
  assert.equal(W.currentStep(app), 'analysis', 'back on step 3');
  await W.press(app, 'wizard-workflows-choice-analyze');
  assert.deepEqual([...new Set(analyzeCalls(app))], [W.PID], 'Analyze with AI starts the analysis');
  await toReview(app);
  assert.deepEqual(analyzeCalls(app), [W.PID], 'started once');
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
  assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
});

// ---- 6. never the banner while a job runs or is done ---------------------------------------------------------

for (const [what, state] of [['running', MAP_RUNNING], ['done', MAP_DONE]]) {
  test(`#20 the Review never says the analyses were skipped while the city job is ${what} (even after Define manually left them for later)`, { timeout: 30000 }, async () => {
    const app = await atAnalysis();
    await W.press(app, 'wizard-workflows-choice-manual');
    await toReview(app);
    assert.equal(reviewText(app).includes(REVIEW_LATER), true, 'the banner before the job');
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

// ---- 7b. Continue when the onboarding is not 'ready': the clone still running, a failed state (review round 1) ---

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
  test(`#20 #100 import, Define manually then Continue while ${what}: no analysis is asked for, it is saved as left for later`, { timeout: 30000 }, async () => {
    const app = await atAnalysisWhile(state);
    await W.press(app, 'wizard-workflows-choice-manual');
    await toReview(app);
    assert.deepEqual(analyzeCalls(app), [], `api.analyzeOnboarding calls: ${JSON.stringify(analyzeCalls(app))}`);
    assert.equal(savedAnalyzeLater(app), true, 'the last api.saveOnboardingWizard picks.analyzeLater');
    // once the clone is there and nothing runs, the Review says so
    await W.emit(app, W.READY);
    await app.settle(20);
    assert.equal(reviewText(app).includes(REVIEW_LATER), true, reviewText(app));
    assert.equal(cityState(app), 'later');
  });
}

// the engine keeps an analysis asked for during the clone (`wanted`): Continue then does not leave it for later
test('#20 #100 import, Analyze with AI asked during the clone (wanted), then Continue: not saved as analyzeLater, started once', { timeout: 30000 }, async () => {
  const wanted = { ...W.clone(W.CLONING), wanted: true };
  const app = await atAnalysisWhile(W.CLONING, { analyzeOnboarding: async (id) => ({ ...W.clone(wanted), projectId: id }) });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await toReview(app);
  assert.deepEqual(analyzeCalls(app), [W.PID], 'asked once, by the Analyze with AI click');
  assert.equal(savedAnalyzeLater(app), false, 'the last api.saveOnboardingWizard picks.analyzeLater');
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
});

// #100: the start boundary is the Analyze with AI click (Continue starts nothing)
test('#20 #100 import, Analyze with AI refused by the engine: the wizard stays on step 3, nothing saved as skipped; Continue then starts nothing', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: async () => { throw new Error('engine refused'); } });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  assert.equal(analyzeCalls(app).length, 1, 'api.analyzeOnboarding was asked once');
  assert.equal(W.currentStep(app), 'analysis', 'still on step 3');
  assert.notEqual(savedAnalyzeLater(app), true, 'not saved as "analyze later"');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(analyzeCalls(app).length, 1, 'Continue does not ask again');
});

test('#20 #100 import, closing the wizard while Analyze with AI starts the analysis: no error, the wizard stays closed', { timeout: 30000 }, async () => {
  const errors = [];
  const onError = (e) => errors.push(String(e?.stack || e));
  process.on('unhandledRejection', onError);
  process.on('uncaughtException', onError);
  try {
    let app = null;
    app = await atAnalysis({
      analyzeOnboarding: async (id) => { W.wizard(app).close(); await Promise.resolve(); return { ...W.clone(MAP_RUNNING), projectId: id }; },
    });
    await W.press(app, 'wizard-workflows-choice-analyze');
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
  // the engine's create() gives the profile its answers and tests: 'unit' (a valid profile: the rows show at once)
  jobs: { clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' }, profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone', tests: 'unit' } } },
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
  // its step 3 lists no jobs any more (no wizard-cost): nothing shows as waiting or running, the rows are its workflows
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-cost'), null, 'step 3: no job list for a new project');
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-progress'), null, 'step 3: no analysis progress');
  assert.equal('disabled' in nextOf(app).attrs, false, '#100: a new project\'s Continue is enabled at once');
  assert.equal(JSON.parse(JSON.stringify(app.callsTo('saveOnboardingWizard').at(-1)?.[0] || {})).picks?.analyzeLater, true, 'step 3: saved as left for later (#850)');
  await toReview(app);
  assert.equal(analyzeCalls(app).length, 0, 'api.analyzeOnboarding is not called');
  assert.equal(cityState(app), 'later');
  assert.equal(reviewText(app).includes(REVIEW_LATER), false, reviewText(app));
});

// ---- 9. #101: a refused Analyze with AI gives step 3 back as it was ----------------------------------------------
// The contract assumed here: the engine refuses onboarding:analyze / onboarding:retry by throwing (its clientError,
// a rejected api promise); the wizard then shows the app's toast (#toast) with the reason and the workflows column
// (wizard-workflows-column data-state) goes back to where it was before the click (choose / manual), Continue with it;
// the saved wizard (api.saveOnboardingWizard picks) goes back too: no workflowsMode 'analyze', analyzeLater as it was.

const REFUSAL = 'no model credits left';
const refused = async () => { throw new Error(REFUSAL); };
const columnState = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-workflows-column')?.attrs['data-state'] ?? null;
const toastText = (app) => H.visibleText(String(W.existing(app, 'toast')?.innerHTML || W.existing(app, 'toast')?.textContent || ''));
// the last saved picks ({} when nothing was saved)
const lastSavedPicks = (app) => JSON.parse(JSON.stringify(app.callsTo('saveOnboardingWizard').at(-1)?.[0] || {})).picks || {};

test('#101 Analyze with AI refused from the two choices: the column is back on choose, Continue disabled, a toast says why', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: refused });
  assert.equal(columnState(app), 'choose', 'the two choices before the click');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  assert.equal(analyzeCalls(app).length, 1, 'api.analyzeOnboarding was asked once');
  assert.equal(columnState(app), 'choose', `wizard-workflows-column data-state: ${columnState(app)}`);
  assert.equal('disabled' in nextOf(app).attrs, true, 'Continue is disabled again');
  assert.equal(toastText(app).includes(REFUSAL), true, `the toast: "${toastText(app)}"`);
});

test('#101 Analyze with AI refused from the manual rows: the column is back on manual, Continue still enabled', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: refused });
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(columnState(app), 'manual', 'the manual rows before the click');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  assert.equal(analyzeCalls(app).length, 1, 'api.analyzeOnboarding was asked once');
  assert.equal(columnState(app), 'manual', `wizard-workflows-column data-state: ${columnState(app)}`);
  assert.equal('disabled' in nextOf(app).attrs, false, 'Continue stays enabled (the workflows defined by hand)');
  assert.equal(toastText(app).includes(REFUSAL), true, `the toast: "${toastText(app)}"`);
});

// the click runs api.retryOnboarding when the profile job failed while the analysis runs (#74)
test('#101 Analyze with AI refused on the retry path (a failed profile while analyzing): the column is back on choose, Continue disabled', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ retryOnboarding: refused });
  await W.emit(app, stateWith('analyzing', { facts: { status: 'done' }, profile: { status: 'failed', error: 'boom' }, projectMap: { status: 'running' } }));
  assert.equal(columnState(app), 'choose', 'the two choices before the click');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  assert.equal(app.callsTo('retryOnboarding').length, 1, 'the click asked api.retryOnboarding');
  assert.equal(analyzeCalls(app).length, 0, 'not api.analyzeOnboarding');
  assert.equal(columnState(app), 'choose', `wizard-workflows-column data-state: ${columnState(app)}`);
  assert.equal('disabled' in nextOf(app).attrs, true, 'Continue is disabled again');
  assert.equal(toastText(app).includes(REFUSAL), true, `the toast: "${toastText(app)}"`);
});

// the owner picks Define manually (offered on the failed rows) while the refused retry is still on its way: the
// late refusal does not take the pick back
test('#101 Define manually pressed while a retry is on its way, then the retry refused: the column stays manual', { timeout: 30000 }, async () => {
  let refuse;
  const app = await atAnalysis({ retryOnboarding: () => new Promise((_, reject) => { refuse = reject; }) });
  await W.emit(app, stateWith('analyzing', { facts: { status: 'done' }, profile: { status: 'failed', error: 'boom' }, projectMap: { status: 'running' } }));
  await W.press(app, 'wizard-workflows-choice-analyze');
  assert.equal(app.callsTo('retryOnboarding').length, 1, 'the click asked api.retryOnboarding');
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(columnState(app), 'manual', 'Define manually picked while the retry is on its way');
  refuse(new Error(REFUSAL));
  await app.settle(20);
  assert.equal(columnState(app), 'manual', `wizard-workflows-column data-state: ${columnState(app)}`);
  assert.equal(toastText(app).includes(REFUSAL), true, `the toast: "${toastText(app)}"`);
});

test('#101 Analyze with AI refused from the two choices: the last saved wizard has no workflowsMode analyze, analyzeLater false as before', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: refused });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  const picks = lastSavedPicks(app);
  assert.notEqual(picks.workflowsMode, 'analyze', `the last saved picks.workflowsMode: ${JSON.stringify(picks)}`);
  assert.equal(picks.analyzeLater, false, `the last saved picks.analyzeLater: ${JSON.stringify(picks)}`);
});

test('#101 Define manually, Continue, Back, then Analyze with AI refused: the last saved wizard is manual and analyzeLater again', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ analyzeOnboarding: refused });
  await W.press(app, 'wizard-workflows-choice-manual');
  await toReview(app);
  assert.equal(savedAnalyzeLater(app), true, 'saved as left for later after Continue');
  await W.press(app, 'wizard-back');
  assert.equal(W.currentStep(app), 'analysis', 'back on step 3');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  const picks = lastSavedPicks(app);
  assert.equal(picks.workflowsMode, 'manual', `the last saved picks.workflowsMode: ${JSON.stringify(picks)}`);
  assert.equal(picks.analyzeLater, true, `the last saved picks.analyzeLater: ${JSON.stringify(picks)}`);
  assert.equal(columnState(app), 'manual', `wizard-workflows-column data-state: ${columnState(app)}`);
});

test('#101 guard: Analyze with AI accepted: one api.analyzeOnboarding call, the column analyzing, Continue enabled', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(20);
  assert.deepEqual(analyzeCalls(app), ['p-new'], 'one call, for the project');
  assert.equal(columnState(app), 'analyzing', `wizard-workflows-column data-state: ${columnState(app)}`);
  assert.equal('disabled' in nextOf(app).attrs, false, 'Continue is enabled');
});
