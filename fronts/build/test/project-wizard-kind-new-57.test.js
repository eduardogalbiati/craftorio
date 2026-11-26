// #57: "Create new project" asks the project's kind (frontend, full-stack or backend) instead of opening its
// review on "Detect from the files"; an import keeps the detection (#781's tests). Acceptance tests written
// before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js), driven as
// project-wizard-new-project-850.test.js.
//
// Contract assumed here:
// - the create step shows a fourth question, wizard-question data-question="kind", its chips (wizard-chip
//   data-question="kind") data-value="frontend" | "full-stack" | "backend" in that order
//   (OnboardingModel.CREATE_ANSWERS.kind), one pressed by default (CREATE_DEFAULTS.kind), labels from the
//   catalogs (en.json / pt-BR.json), never a raw key;
// - Next sends api.createOnboarding({ ..., answers: { mode, ci, release, kind } });
// - the new project's review: the kind select (wizard-kind-select) opens on the kind answered and offers no
//   "Detect from the files". The fake engine here answers the profile with the step-2 answers (as it does for
//   mode / ci / release), kind included.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const NAME = 'Field Notes';
const NEW_PID = 'field-notes';
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };

// what the engine answers to createOnboarding: ready at once, its profile the step-2 answers
const created = (answers = { mode: 'local', ci: 'release', release: 'milestone' }) => ({
  projectId: NEW_PID, name: NAME, status: 'ready', cli: null,
  jobs: {
    clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' },
    profile: { status: 'done', profile: { ...answers, tests: null, testCommand: null } },
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
const kindChips = (app) => H.findAll(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-chip' && e.attrs['data-question'] === 'kind');

// the create step of a new project, its name typed
async function atCreate() {
  const app = newPage();
  await app.boot();
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', NAME);
  return app;
}

async function pickKind(app, value) {
  const chip = kindChips(app).find((e) => e.attrs['data-value'] === value);
  assert.ok(chip, `the kind chip data-value="${value}"`);
  await W.clickRendered(app, chip, ['#project-wizard']);
  await app.settle(10);
}

// Next from the create step: what api.createOnboarding received (plain data)
async function sent(app) {
  await W.press(app, 'wizard-next');
  await app.settle(20);
  const calls = app.callsTo('createOnboarding');
  assert.equal(calls.length, 1, 'one api.createOnboarding call');
  return JSON.parse(JSON.stringify(calls[0][0] ?? null));
}

const kindSelect = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-kind-select');
const kindOptions = (app) => H.findAll(kindSelect(app)?.outer || '', (e) => e.name === 'option');
const pickedKind = (app) => kindOptions(app).find((o) => 'selected' in o.attrs)?.attrs.value ?? null;

test('#57 create step: the questions now ask the project\'s kind too', { timeout: 30000 }, async () => {
  const app = await atCreate();
  const groups = H.findAll(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-question').map((e) => e.attrs['data-question']);
  assert.equal(groups.includes('kind'), true, `the questions: ${groups.join(', ')}`);
});

test('#57 create step: the kind offers frontend, full-stack and backend, in that order', { timeout: 30000 }, async () => {
  const app = await atCreate();
  assert.deepEqual(kindChips(app).map((e) => e.attrs['data-value']), ['frontend', 'full-stack', 'backend']);
});

test('#57 create step: the kind chips read words from the catalog, never a raw key', { timeout: 30000 }, async () => {
  const app = await atCreate();
  const texts = kindChips(app).map(textOf);
  assert.deepEqual(texts.filter((s) => !s.trim() || /onboarding\.|ways_of_working\./.test(s)), [], `the chips: ${JSON.stringify(texts)}`);
  const title = H.findEl(W.wizardMarkup(app), (e) => e.attrs.id === 'wizard-question-kind');
  assert.equal(/^\s*$|onboarding\./.test(textOf(title)), false, `the question's title: ${textOf(title)}`);
});

test('#57 create step: one kind is picked by default', { timeout: 30000 }, async () => {
  const app = await atCreate();
  assert.equal(kindChips(app).filter((e) => e.attrs['aria-pressed'] === 'true').length, 1);
});

test('#57 Next sends the kind picked (backend)', { timeout: 30000 }, async () => {
  const app = await atCreate();
  await pickKind(app, 'backend');
  assert.equal((await sent(app)).answers?.kind, 'backend');
});

test('#57 the new project\'s review opens on the kind answered, with no "Detect from the files"', { timeout: 30000 }, async () => {
  const app = await atCreate();
  await pickKind(app, 'full-stack');
  await sent(app);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review');
  const options = kindOptions(app).map(textOf);
  assert.deepEqual({ picked: pickedKind(app), detect: options.includes('Detect from the files') }, { picked: 'full-stack', detect: false }, options.join(' | '));
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-kind-detected') === null, true, 'answered, not "Detected"');
});

// a new project's wizard resumed later: the onboarding state has no profile any more, the kind answered is read
// from the project's record (listProjects), and it is not presented as detected
function resumedPage(kind) {
  const record = { id: W.PID, name: NAME, repo: '', folder: 'C:/ws/repos/field-notes', exists: true, kind, onboarding: { finished: false, step: 'analysis' } };
  const status = { ...W.clone(W.READY), projectId: W.PID, wizard: { step: 'analysis', picks: { source: 'new', name: NAME, workflowsMode: 'manual' }, finished: false } };
  return loadApp({
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => [W.clone(record)],
      listProjectRuns: async () => ({ runs: [], project: W.clone(record), local: null }),
      onboardingAccounts: async () => [],
      onboardingRepos: async () => [],
      architectureEstimate: async () => null,
      onboardingStatus: async () => W.clone(status),
      saveOnboardingWizard: async (data) => ({ ...W.clone(status), wizard: { step: data?.step, picks: W.clone(data?.picks), finished: false } }),
      getBacklog: async () => ({ issues: [] }),
    },
  });
}

test('#57 a resumed new project\'s review opens on the kind saved on the project, not as "Detected"', { timeout: 30000 }, async () => {
  const app = resumedPage('backend');
  await app.boot();
  W.wizard(app).open({ projectId: W.PID });
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'resumed on step 3');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review');
  const options = kindOptions(app).map(textOf);
  assert.deepEqual({
    picked: pickedKind(app),
    detect: options.includes('Detect from the files'),
    detectedMark: W.byTestId(W.wizardMarkup(app), 'wizard-kind-detected') !== null,
  }, { picked: 'backend', detect: false, detectedMark: false }, options.join(' | '));
});
