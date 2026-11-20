// #850 acceptance, written before the code: a new project (wizard source "Create new project") is not told
// about analyses it never needed, and its Review says what the owner answered on step 2. On the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-create-632.test.js and
// project-wizard-helpers.js; the project page's Next steps as fronts/analyser/test/project-next-steps-744.test.js.
//
// The contract assumed here:
// - step 3 of a new project: the "City and architecture" row (onboarding.job_projectMap) of wizard-cost is
//   shown unticked (no checked checkbox), says why with the NEW key onboarding.job_projectMap_later_new (left
//   for later / not needed yet), and wizard-cost never says onboarding.cost_not_known; no wizard-skip button;
// - OnboardingModel (packages/shared/onboarding-model.js) is the one source of truth: next() from the
//   repository step of a new project (source 'new') lands on analysis with analyzeLater: true (an import keeps
//   analyzeLater false);
// - the Review of a new project never says onboarding.review_later, and its "How <name> is worked on" card says
//   the step-2 answer (onboarding.new_mode_local / onboarding.new_mode_remote), never review_how_pending;
// - step 3's profile line (data-testid="wizard-profile") of a new project says it comes from the answers
//   (/answers/ in English, /respostas/ in pt-BR), never "from the git history"; an import still says git history;
// - the project page's Next steps: with a `release` workflow in the project's workflows, the release CI entry
//   (next-step-release-ci) does not say onboarding.next_steps_release_ci_reason; without one it still does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { pageMarkup } = require('@multiagent/front-analyser/test/project-page-helpers');
const W = require('./project-wizard-helpers');

const I18N = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
const MODEL = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'onboarding-model.js');

const NAME = 'Field Notes';
const NEW_PID = 'field-notes';
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };

// what the engine answers to createOnboarding: ready at once, its profile the step-2 answers
const created = (answers = { mode: 'local', ci: 'release', release: 'milestone' }) => ({
  projectId: NEW_PID, name: NAME, status: 'ready', cli: null,
  jobs: {
    clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' },
    profile: { status: 'done', profile: { mode: answers.mode, ci: answers.ci, release: answers.release, tests: null, testCommand: null } },
  },
});

function newPage() {
  let last = created();
  return loadApp({
    api: {
      listProjects: async () => [],
      onboardingAccounts: async () => [W.clone(GH_IN)],
      onboardingRepos: async () => [],
      createOnboarding: async (data) => { last = created(data?.answers); return W.clone(last); },
      onboardingStatus: async () => W.clone(last),
      architectureEstimate: async () => null,
      getBacklog: async () => ({ issues: [] }),
    },
  });
}

const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);

// the new project created from step 2 (mode: the "Where changes land" chip, 'local' by default): step 3
async function newAtAnalysis({ lang = 'en', mode = 'local' } = {}) {
  const app = newPage();
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', NAME);
  if (mode === 'remote') {
    const chip = H.findAll(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-chip' && e.attrs['data-question'] === 'mode')
      .find((e) => e.attrs['data-value'] === 'remote');
    assert.ok(chip, 'the "Local + remote" chip');
    await W.clickRendered(app, chip, ['#project-wizard']);
    await app.settle(10);
  }
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  return app;
}

async function newAtReview(opts) {
  const app = await newAtAnalysis(opts);
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
  return app;
}

const costBlock = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-cost');
// the "City and architecture" row of step 3's jobs
function cityRow(app, lang = 'en') {
  const title = catalog(lang)['onboarding.job_projectMap'];
  return H.findAll(costBlock(app)?.outer || '', (e) => e.name === 'li').find((li) => textOf(li).includes(title)) || null;
}
const isChecked = (e) => 'checked' in e.attrs || e.attrs['aria-checked'] === 'true';

// ---- a) step 3: the city analysis is left for later, not ticked and pending ---------------------------------

test('#850 new project step 3: the City and architecture row is shown unticked', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  const row = cityRow(app);
  assert.ok(row, 'the "City and architecture" row on step 3');
  const ticked = H.findAll(row.outer, (e) => (e.name === 'input' && e.attrs.type === 'checkbox') || e.attrs.role === 'checkbox').filter(isChecked);
  assert.equal(ticked.length, 0, `ticked boxes in the row: ${ticked.map((e) => e.outer).join(' | ')}`);
});

test('#850 new project step 3: the City and architecture row says why it is left for later (onboarding.job_projectMap_later_new)', { timeout: 30000 }, async () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  assert.equal(typeof en['onboarding.job_projectMap_later_new'], 'string', 'en.json has onboarding.job_projectMap_later_new');
  assert.equal(typeof pt['onboarding.job_projectMap_later_new'], 'string', 'pt-BR.json has onboarding.job_projectMap_later_new');
  const app = await newAtAnalysis();
  const said = textOf(cityRow(app));
  assert.equal(said.includes(en['onboarding.job_projectMap_later_new']), true, said);
});

test('#850 new project step 3: nothing reads "Not known yet" and there is no "Skip, analyze later"', { timeout: 30000 }, async () => {
  for (const lang of ['en', 'pt-BR']) {
    const app = await newAtAnalysis({ lang });
    const cost = textOf(costBlock(app));
    assert.equal(cost.includes(catalog(lang)['onboarding.cost_not_known']), false, `${lang}: ${cost}`);
    assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-skip'), null, `${lang}: no wizard-skip`);
  }
});

test('#850 the model: a new project reaches step 3 with analyzeLater set; an import does not', () => {
  delete require.cache[require.resolve(MODEL)];
  const M = require(MODEL);
  const created3 = M.next({ ...M.initialState(), step: 'repository', source: 'new', name: NAME });
  assert.deepEqual([created3.step, created3.analyzeLater], ['analysis', true]);
  const imported3 = M.next({ ...M.initialState(), step: 'repository', source: 'import', repository: W.REPO, name: NAME });
  assert.deepEqual([imported3.step, imported3.analyzeLater], ['analysis', false]);
});

// ---- b) the Review never says the analyses were skipped -----------------------------------------------------

test('#850 new project Review: no "The analyses were skipped" line (en and pt-BR)', { timeout: 30000 }, async () => {
  for (const lang of ['en', 'pt-BR']) {
    const app = await newAtReview({ lang });
    const said = H.visibleText(W.wizardMarkup(app));
    assert.equal(said.includes(catalog(lang)['onboarding.review_later']), false, `${lang}: ${said}`);
  }
});

// ---- c) "How it is worked on" says the step-2 answer ---------------------------------------------------------

const projectCard = (app) => H.findEl(W.wizardMarkup(app), (e) => W.classesOf(e).includes('wizard-review-project'));

for (const [lang, mode, key] of [
  ['en', 'local', 'onboarding.new_mode_local'],
  ['pt-BR', 'local', 'onboarding.new_mode_local'],
  ['en', 'remote', 'onboarding.new_mode_remote'],
]) {
  test(`#850 new project Review (${lang}, ${mode}): "How it is worked on" says "${catalog(lang)[key]}", not the pending line`, { timeout: 30000 }, async () => {
    const app = await newAtReview({ lang, mode });
    const said = textOf(projectCard(app));
    assert.equal(said.includes(catalog(lang)['onboarding.review_how_pending']), false, said);
    assert.equal(said.includes(catalog(lang)[key]), true, said);
  });
}

// ---- d) the profile line: from your answers (new), from the git history (import) ------------------------------

test('#850 new project step 3: the profile line says it comes from the answers, not the git history (en)', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  const said = textOf(W.byTestId(W.wizardMarkup(app), 'wizard-profile'));
  assert.doesNotMatch(said, /git history/i);
  assert.match(said, /answers/i);
});

test('#850 new project step 3: the profile line says it comes from the answers, not the git history (pt-BR)', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis({ lang: 'pt-BR' });
  const said = textOf(W.byTestId(W.wizardMarkup(app), 'wizard-profile'));
  assert.doesNotMatch(said, /histórico do git/i);
  assert.match(said, /respostas/i);
});

test('#850 guard: an import\'s profile line still says it comes from the git history', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis();
  const profile = { mode: 'local', ci: 'none', tests: 'unit', testCommand: 'npm test', release: 'milestone' };
  await W.emit(app, { ...W.clone(W.READY), status: 'analyzing', jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile }, projectMap: { status: 'running' } }) });
  assert.match(textOf(W.byTestId(W.wizardMarkup(app), 'wizard-profile')), /git history/i);
});

// ---- e) the project page's release CI step -----------------------------------------------------------------

const PID = 'p1';
async function projectPage(workflows, lang = 'en') {
  const app = loadApp({
    api: {
      listProjects: async () => [{ id: PID, name: 'Demo', repo: 'https://github.com/o/demo.git', folder: 'C:/ws/repos/demo', exists: true, workflows: W.clone(workflows) }],
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
    },
    storage: { 'multiagent.nextSteps': JSON.stringify({ [PID]: 'open' }) },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return app;
}
const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const nextStepsCard = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const WITH_RELEASE = [{ name: 'feature', origin: 'bundled', category: 'build', variant: 'local-code' }, { name: 'release', origin: 'bundled', category: 'build', variant: 'milestone', ci: 'release' }];
const WITHOUT_RELEASE = [{ name: 'feature', origin: 'bundled', category: 'build', variant: 'local-code' }];

test('#850 project page: with a release workflow, "Set up release CI" no longer says it needs a release workflow (en and pt-BR)', { timeout: 30000 }, async () => {
  for (const lang of ['en', 'pt-BR']) {
    const app = await projectPage(WITH_RELEASE, lang);
    const card = nextStepsCard(app);
    assert.ok(card, `${lang}: the Next steps card is shown`);
    const said = H.visibleText(card.outer) + allByTestId(card.outer, 'next-step-release-ci').map((e) => ` ${e.outer}`).join('');
    assert.equal(said.includes(catalog(lang)['onboarding.next_steps_release_ci_reason']), false, `${lang}: ${said}`);
  }
});

test('#850 project page: with a release workflow, "Set up release CI" gives its own reason, in en and pt-BR', { timeout: 30000 }, async () => {
  for (const lang of ['en', 'pt-BR']) {
    const ready = catalog(lang)['onboarding.next_steps_release_ci_reason_ready'];
    assert.equal(typeof ready === 'string' && ready.length > 0, true, `${lang}: onboarding.next_steps_release_ci_reason_ready`);
    assert.notEqual(ready, catalog(lang)['onboarding.next_steps_release_ci_reason'], `${lang}: a different text from the missing-workflow reason`);
    const app = await projectPage(WITH_RELEASE, lang);
    const entry = W.byTestId(nextStepsCard(app)?.outer || '', 'next-step-release-ci');
    assert.ok(entry, `${lang}: the release CI entry`);
    const reason = W.byTestId(entry.outer, 'next-step-reason');
    assert.equal(reason ? textOf(reason) : null, ready, `${lang}: ${textOf(entry)}`);
  }
});

test('#850 guard: without a release workflow, "Set up release CI" still says it needs one', { timeout: 30000 }, async () => {
  const app = await projectPage(WITHOUT_RELEASE);
  const entry = W.byTestId(nextStepsCard(app)?.outer || '', 'next-step-release-ci');
  assert.ok(entry, 'the release CI entry');
  assert.equal(textOf(entry).includes(catalog('en')['onboarding.next_steps_release_ci_reason']), true, textOf(entry));
});
