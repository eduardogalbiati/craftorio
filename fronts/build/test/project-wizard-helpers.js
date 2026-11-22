// A test helper (not a test): the New project wizard (fronts/build/views/projects/project-wizard.js) on the
// real page (packages/ui-kit/test/renderer-app-harness.js), as project-wizard.test.js drives it, for the
// tests of #724 (the progress tray never covers the wizard), #739 (the name from the URL) and #743 (one
// cloning state on the repository step). It calls no test() at load.
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
const ANALYZED = {
  projectId: PID, status: 'analyzed', cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }),
};
const NO_ACCESS = { projectId: PID, status: 'failed', code: 'no-access', reason: 'Repository not found or you have no access to it', jobs: jobs({ clone: { status: 'failed' } }), cli: CLI_OK };
const CLONE_FAILED = { projectId: PID, status: 'failed', code: 'clone-failed', reason: 'git clone exited with code 128: disk full', jobs: jobs({ clone: { status: 'failed', error: 'disk full' } }), cli: CLI_OK };

const clone = (x) => JSON.parse(JSON.stringify(x));

// start: what api.startOnboarding resolves to; accounts / repos: api.onboardingAccounts / onboardingRepos;
// api: more window.api methods, over these (#781)
function page({ start = CLONING, accounts = [], repos = {}, api = {} } = {}) {
  return loadApp({
    api: {
      listProjects: async () => [],
      startOnboarding: async () => clone(start),
      onboardingStatus: async () => clone(start),
      onboardingAccounts: async () => clone(accounts),
      onboardingRepos: async (provider) => clone(repos[provider] || []),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => null,
      ...api,
    },
  });
}

/** window.ProjectWizard, asserted loaded. */
function wizard(app) {
  assert.equal(typeof app.sandbox.ProjectWizard, 'object', 'project-wizard.js is not loaded by the page (window.ProjectWizard)');
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
const classesOf = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
/** Whether some markup holds a circular loading: an element with the class `spinner`. */
const hasSpinner = (html) => !!H.findEl(String(html || ''), (e) => classesOf(e).includes('spinner'));

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

// The import started: source, repository and name, Next (startOnboarding), and the engine's event
async function imported(state = CLONING, opts = {}) {
  const app = await opened({ start: state, ...opts });
  if (opts.record) opts.record(app);
  await toRepository(app);
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, state);
  return app;
}

async function atAnalysis(opts = {}) {
  const app = await imported(CLONING, opts);
  await emit(app, READY);
  if (currentStep(app) !== 'analysis') await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'analysis', 'the wizard is on the analysis step');
  return app;
}

/** Every markup written into the wizard's root (#project-wizard) from now on, in order. */
function recordWizard(app) {
  const root = existing(app, 'project-wizard');
  assert.ok(root, 'the wizard is open (#project-wizard)');
  const writes = [];
  let html = String(root.innerHTML || '');
  writes.push(html);
  Object.defineProperty(root, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get: () => html,
    set: (v) => { html = String(v); writes.push(html); },
  });
  return writes;
}

/** Whether the element with this id is hidden (missing, `hidden`, a `hidden` attribute or class). */
function isHidden(app, id) {
  const el = existing(app, id);
  if (!el) return true;
  return el.hidden === true || 'hidden' in (el.attrs || {}) || !!el.classList?.contains?.('hidden');
}

module.exports = {
  ANALYZED,
  ANALYZING,
  CLI_OK,
  CLONE_FAILED,
  CLONING,
  NAME,
  NO_ACCESS,
  PID,
  READY,
  REPO,
  atAnalysis,
  byTestId,
  classesOf,
  clickRendered,
  clone,
  currentStep,
  emit,
  existing,
  hasSpinner,
  imported,
  isHidden,
  jobs,
  markupOf,
  opened,
  page,
  press,
  recordWizard,
  toRepository,
  trayMarkup,
  typeInto,
  wizard,
  wizardMarkup,
};
