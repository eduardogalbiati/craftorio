// #641 (first-project onboarding, step 4): the New project wizard (steps 1-3 of
// packages/shared/onboarding-model.js) and the onboarding progress tray. Acceptance tests, written
// before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js); spec
// docs/work/first-project-onboarding/spec.md R1-R3, R5.
//
// The contract assumed here:
// - fronts/build/views/projects/project-wizard.js is a page script (listed in
//   apps/desktop/renderer/index.html) that defines `window.ProjectWizard = { open(), close() }`;
//   open() shows the wizard on the model's step 'start' with no project yet, without the Projects screen;
// - the wizard's markup is the innerHTML of `#project-wizard` (the root carries
//   data-testid="project-wizard"); the tray's markup is the innerHTML of `#onboarding-tray`
//   (data-testid="onboarding-tray"), a separate element, so it stays after close(); the ids inside
//   either one may be filled on their own (their innerHTML / textContent is read too);
// - the step indicator: one element per step of OnboardingModel.STEPS with data-step="<id>", the
//   current one with aria-current="step";
// - step 1: data-testid="wizard-source-import" (its text names GitHub and GitLab) and
//   data-testid="wizard-source-new"; navigation data-testid="wizard-next" / "wizard-back";
// - step 2: inputs id="wizard-repo" (data-testid="wizard-repo") and id="wizard-name"
//   (data-testid="wizard-name"); the provider read from the URL in data-testid="wizard-provider"
//   (GitHub or GitLab); Next calls api.startOnboarding({ name, repo }) and, #743, the step's action
//   button (wizard-next) says the clone started (no wizard-import-status card);
// - the engine's state (project-onboarding.js): { projectId, status, code?, reason?, jobs, cli }, the
//   answer of api.startOnboarding / analyzeOnboarding / retryOnboarding and the payload of
//   onboarding:changed (window.api.onOnboardingChanged(cb));
// - errors: data-testid="wizard-error" with data-error="no-access" | "clone-failed"; the CLI's warning
//   data-testid="wizard-cli-warning" with data-error="cli-missing" | "cli-signed-out" (a warning: the
//   import goes on, no wizard-error, Next not disabled); each one shows the engine's reason and an
//   action button (a <button> or a data-act); failures have data-act="retry" which calls
//   api.retryOnboarding(projectId);
// - step 3: data-testid="wizard-cost" with data-testid="wizard-cost-total" (visible text, never blank)
//   and one element per paid part data-part="projectMap" (#730: no "ranking" part any more); the buttons
//   data-testid="wizard-workflows-choice-analyze" (#725, api.analyzeOnboarding(projectId)) and data-testid="wizard-skip"
//   (to step 'review', no analysis call);
// - the tray: one data-testid="tray-item" per project, data-project="<id>" data-status="<engine
//   status>"; a failed item shows the reason and data-act="retry" (api.retryOnboarding(projectId)).
// Harness equivalents: the fake DOM parses nothing, so buttons are found in the rendered markup and
// clicked through clickRendered (their own #id element when they have one, then the elements holding
// their markup: delegated listeners on #project-wizard / #onboarding-tray work); a typed value goes
// through the input's own input/change listeners and the wizard root's delegated ones.
// #643: Projects › New project (#btn-new-project) opens the wizard, not the old dialog
// (fronts/build/test/projects-new-opens-wizard-643.test.js covers the empty state and Edit).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'running' } }), cli: CLI_OK };
const NO_ACCESS = { projectId: PID, status: 'failed', code: 'no-access', reason: 'Repository not found or you have no access to it', jobs: jobs({ clone: { status: 'failed' } }), cli: CLI_OK };
const CLONE_FAILED = { projectId: PID, status: 'failed', code: 'clone-failed', reason: 'git clone exited with code 128: disk full', jobs: jobs({ clone: { status: 'failed', error: 'disk full' } }), cli: CLI_OK };
const CLI_MISSING = { ...CLONING, cli: { provider: 'github', status: 'missing', reason: 'The GitHub CLI (gh) is not installed' } };

const clone = (x) => JSON.parse(JSON.stringify(x));

// start: what api.startOnboarding resolves to
function page({ start = CLONING } = {}) {
  return loadApp({
    api: {
      listProjects: async () => [],
      startOnboarding: async () => clone(start),
      onboardingStatus: async () => clone(start),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
    },
  });
}

/** window.ProjectWizard, asserted loaded (a clear failure before the code exists). */
function wizard(app) {
  assert.equal(typeof app.sandbox.ProjectWizard, 'object', 'project-wizard.js is not loaded by the page (window.ProjectWizard)');
  assert.equal(typeof app.sandbox.ProjectWizard.open, 'function', 'window.ProjectWizard.open()');
  assert.equal(typeof app.sandbox.ProjectWizard.close, 'function', 'window.ProjectWizard.close()');
  return app.sandbox.ProjectWizard;
}

// The markup of an element by id, with what was written into the ids inside it
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
const trayMarkup = (app) => markupOf(app, 'onboarding-tray');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

/** The id of the current step (aria-current="step"), or null. */
function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

/** Clicks the rendered element with data-testid="<id>" of the wizard. */
async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

// Types a value into a field: its value, then its own and the wizard root's input / change listeners
async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.dataset.testid = sel.slice(1);
  const root = app.el('#project-wizard');
  for (const type of ['input', 'change', 'blur']) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

/** Fires onboarding:changed with a state (every onOnboardingChanged listener). */
async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

async function opened(opts) {
  const app = page(opts);
  await app.boot();
  wizard(app).open();
  await app.settle(10);
  return app;
}

async function toRepository(app) {
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
}

// The import done: source, repository and name, Next (startOnboarding), and the engine's event
async function imported(state = CLONING) {
  const app = await opened({ start: state });
  await toRepository(app);
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, state);
  return app;
}

async function atAnalysis() {
  const app = await imported(CLONING);
  await emit(app, READY);
  if (currentStep(app) !== 'analysis') await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'analysis', 'the wizard is on the analysis step');
  return app;
}

const hasAction = (el) => !!H.findEl(el.outer, (e) => e.name === 'button' || 'data-act' in e.attrs);
const retryOf = (el) => H.findEl(el.outer, (e) => e.attrs['data-act'] === 'retry');

// ---- step 1: the source ----------------------------------------------------------------------------

test('#641 open() shows step 1 (start) as current with the Import and Create cards, and the model\'s 4 steps in the indicator', async () => {
  const app = await opened();
  assert.equal(currentStep(app), 'start');
  const markup = wizardMarkup(app);
  const steps = [...new Set(H.findAll(markup, (e) => e.attrs['data-step']).map((e) => e.attrs['data-step']))].join(',');
  assert.equal(steps, app.run('OnboardingModel.STEPS.map((s) => s.id).join(",")'), 'the indicator lists the model\'s steps in order');
  const card = byTestId(markup, 'wizard-source-import');
  assert.ok(card, 'the "Import a repository" card');
  assert.match(H.visibleText(card.inner), /GitHub/);
  assert.match(H.visibleText(card.inner), /GitLab/);
  assert.ok(byTestId(markup, 'wizard-source-new'), 'the "Create new project" card');
});

// ---- step 2: the repository ------------------------------------------------------------------------

test('#641 choosing Import then Next shows step 2 (repository) with the repository and name fields; Next with them empty starts nothing', async () => {
  const app = await opened();
  await toRepository(app);
  assert.equal(currentStep(app), 'repository');
  const markup = wizardMarkup(app);
  assert.ok(byTestId(markup, 'wizard-repo'), 'the repository URL field');
  assert.ok(byTestId(markup, 'wizard-name'), 'the project name field');
  const next = byTestId(markup, 'wizard-next');
  if (next && !('disabled' in next.attrs)) await press(app, 'wizard-next');
  assert.equal(app.callsTo('startOnboarding').length, 0, 'no api.startOnboarding with empty fields');
  assert.equal(currentStep(app), 'repository');
});

test('#641 the provider is read from the URL: GitHub for a github.com URL, GitLab for a gitlab.com one', async () => {
  const app = await opened();
  await toRepository(app);
  const provider = () => {
    const el = byTestId(wizardMarkup(app), 'wizard-provider');
    return (el && H.visibleText(el.inner)) || String(existing(app, 'wizard-provider')?.textContent || '');
  };
  await typeInto(app, '#wizard-repo', 'https://github.com/o/r.git');
  assert.match(provider(), /GitHub/);
  await typeInto(app, '#wizard-repo', 'https://gitlab.com/g/r.git');
  assert.match(provider(), /GitLab/);
});

// #743: no import card any more; the step's action button says the clone started
test('#641 Next on step 2 calls api.startOnboarding with the typed name and repository, and the step says the clone started', async () => {
  const app = await imported(CLONING);
  const calls = app.callsTo('startOnboarding');
  assert.equal(calls.length, 1, 'one api.startOnboarding call');
  assert.equal(calls[0][0]?.name, NAME);
  assert.equal(calls[0][0]?.repo, REPO);
  const btn = byTestId(wizardMarkup(app), 'wizard-next');
  assert.ok(btn, 'the step\'s action button');
  assert.match(H.visibleText(btn.inner), /clon/i, 'the button says the clone started');
});

// ---- the errors ------------------------------------------------------------------------------------

test('#641 no access: its own error with the engine\'s reason and an action; Retry calls api.retryOnboarding(projectId)', async () => {
  const app = await imported(NO_ACCESS);
  const err = H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-error');
  assert.ok(err, 'data-testid="wizard-error"');
  assert.equal(err.attrs['data-error'], 'no-access');
  assert.ok(H.visibleText(err.inner).includes(NO_ACCESS.reason), 'the reason in words');
  assert.ok(hasAction(err), 'a next action');
  const retry = retryOf(err);
  assert.ok(retry, 'a Retry (data-act="retry")');
  await clickRendered(app, retry, ['#project-wizard']);
  const calls = app.callsTo('retryOnboarding');
  assert.equal(calls.length, 1, 'one api.retryOnboarding call');
  assert.equal(calls[0][0], PID);
});

test('#641 a failed clone: its own error (clone-failed) with the reason and a Retry that calls api.retryOnboarding(projectId)', async () => {
  const app = await imported(CLONE_FAILED);
  const err = H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-error');
  assert.ok(err, 'data-testid="wizard-error"');
  assert.equal(err.attrs['data-error'], 'clone-failed');
  assert.ok(H.visibleText(err.inner).includes(CLONE_FAILED.reason), 'the reason in words');
  const retry = retryOf(err);
  assert.ok(retry, 'a Retry (data-act="retry")');
  await clickRendered(app, retry, ['#project-wizard']);
  assert.equal(app.callsTo('retryOnboarding')[0]?.[0], PID);
});

test('#641 no gh CLI: a warning (cli-missing) with its reason and an action, and the import goes on (no error, Next enabled)', async () => {
  const app = await imported(CLI_MISSING);
  const markup = wizardMarkup(app);
  const warn = byTestId(markup, 'wizard-cli-warning');
  assert.ok(warn, 'data-testid="wizard-cli-warning"');
  assert.equal(warn.attrs['data-error'], 'cli-missing');
  assert.ok(H.visibleText(warn.inner).includes(CLI_MISSING.cli.reason), 'the reason in words');
  assert.ok(hasAction(warn), 'a next action');
  assert.equal(byTestId(markup, 'wizard-error'), null, 'not a failure');
  const next = byTestId(markup, 'wizard-next');
  assert.ok(next, 'Next is there');
  assert.equal('disabled' in next.attrs, false, 'Next is not disabled');
});

// ---- step 3: the analysis --------------------------------------------------------------------------

test('#641 step 3 shows the cost total and its paid part before any analysis is started', async () => {
  const app = await atAnalysis();
  const cost = byTestId(wizardMarkup(app), 'wizard-cost');
  assert.ok(cost, 'data-testid="wizard-cost"');
  const total = byTestId(cost.outer, 'wizard-cost-total');
  assert.ok(total, 'data-testid="wizard-cost-total"');
  assert.notEqual(H.visibleText(total.inner), '', 'the total is never blank');
  assert.ok(H.findEl(cost.outer, (e) => e.attrs['data-part'] === 'projectMap'), 'the project map part');
  assert.ok(!H.findEl(cost.outer, (e) => e.attrs['data-part'] === 'ranking'), 'no refactor ranking part since #730');
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'nothing started yet');
});

test('#641 Start analysis calls api.analyzeOnboarding(projectId)', async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze'); // #725: Analyze the repository, in the workflows column
  const calls = app.callsTo('analyzeOnboarding');
  assert.equal(calls.length, 1, 'one api.analyzeOnboarding call');
  assert.equal(calls[0][0], PID);
});

test('#641 "Skip, analyze later" goes to the review step without starting an analysis', async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-skip');
  assert.equal(currentStep(app), 'review');
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'no api.analyzeOnboarding call');
});

// ---- the progress tray -----------------------------------------------------------------------------

const trayItem = (app, id = PID) => H.findEl(trayMarkup(app), (e) => e.attrs['data-testid'] === 'tray-item' && e.attrs['data-project'] === id);

// #724: the tray is hidden while the wizard is open; it is read with the wizard closed
test('#641 the tray follows onboarding:changed (cloning, analyzing, ready), and a failure shows the reason and a Retry that calls api.retryOnboarding', async () => {
  const app = await imported(CLONING);
  wizard(app).close();
  await app.settle(10);
  assert.ok((app.apiHandlers.onOnboardingChanged || []).length >= 1, 'the page listens to api.onOnboardingChanged');
  const statuses = [];
  for (const state of [CLONING, ANALYZING, READY]) {
    await emit(app, state);
    statuses.push(trayItem(app)?.attrs['data-status'] ?? null);
  }
  assert.deepEqual(statuses, ['cloning', 'analyzing', 'ready']);
  await emit(app, CLONE_FAILED);
  const item = trayItem(app);
  assert.equal(item?.attrs['data-status'], 'failed');
  assert.ok(H.visibleText(item.inner).includes(CLONE_FAILED.reason), 'the reason in words');
  const retry = retryOf(item);
  assert.ok(retry, 'a Retry (data-act="retry")');
  await clickRendered(app, retry, ['#onboarding-tray']);
  assert.equal(app.callsTo('retryOnboarding')[0]?.[0], PID);
});

test('#641 the tray stays after ProjectWizard.close() and still follows a new event', async () => {
  const app = await imported(CLONING);
  wizard(app).close();
  await app.settle(10);
  assert.ok(trayItem(app), 'the tray item is still there');
  await emit(app, ANALYZING);
  assert.equal(trayItem(app)?.attrs['data-status'], 'analyzing');
});

// ---- never a blank panel ---------------------------------------------------------------------------

test('#641 no state leaves a blank panel: start, repository, cloning, no access, clone failed, cli missing and analysis each show words beyond the step indicator', async () => {
  const body = (app) => H.visibleText(H.dropWhere(wizardMarkup(app), (e) => 'data-step' in e.attrs));
  const seen = {};
  let app = await opened();
  seen.start = body(app);
  await toRepository(app);
  seen.repository = body(app);
  for (const [name, state] of [['cloning', CLONING], ['no-access', NO_ACCESS], ['clone-failed', CLONE_FAILED], ['cli-missing', CLI_MISSING]]) {
    app = await imported(state);
    seen[name] = body(app);
  }
  app = await atAnalysis();
  seen.analysis = body(app);
  const blank = Object.entries(seen).filter(([, t]) => !t).map(([k]) => k);
  assert.deepEqual(blank, [], 'the states with a blank panel');
});

// ---- wired to Projects (#643) ----------------------------------------------------------------------

test('#643 Projects › New project opens the wizard on its start step, not the old New project dialog', async () => {
  const app = page();
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  app.el('#project-modal-title').textContent = '';
  await app.click('#btn-new-project');
  await app.settle(10);
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old dialog was not opened');
  assert.equal(currentStep(app), 'start', 'the wizard is shown on its start step');
});
