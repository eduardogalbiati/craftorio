// #641 (first-project onboarding, step 4): what the review of the new-project wizard added
// (fronts/build/views/projects/project-wizard.js) on top of the acceptance tests of
// project-wizard.test.js: Edit the URL after a refused access, the gh / glab warning on the analysis
// step, the cost from api.architectureEstimate (I18n.formatCost, "Not known yet"), the tray's dismiss,
// the focus given back on close(), the analyzed state, and the keys (Enter, Escape) in the dialog.
// On the real page (packages/ui-kit/test/renderer-app-harness.js), with the contract of
// project-wizard.test.js's header. Tab's focus trap is not tested here: the harness's
// querySelectorAll returns [] (no focusable list to walk).
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
const CLI_MISSING = { provider: 'github', status: 'missing', reason: 'The GitHub CLI (gh) is not installed' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }), cli: CLI_OK };
const NO_ACCESS = { projectId: PID, status: 'failed', code: 'no-access', reason: 'Repository not found or you have no access to it', jobs: jobs({ clone: { status: 'skipped' } }), cli: CLI_OK };

const clone = (x) => JSON.parse(JSON.stringify(x));

// start: what api.startOnboarding resolves to (or a function of its data); estimate: api.architectureEstimate's answer
function page({ start = CLONING, estimate = null } = {}) {
  return loadApp({
    api: {
      listProjects: async () => [],
      startOnboarding: async (data) => clone(typeof start === 'function' ? start(data) : start),
      onboardingStatus: async () => clone(CLONING),
      analyzeOnboarding: async (id) => ({ ...clone(READY), status: 'analyzing', projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => clone(estimate),
    },
  });
}

const wizard = (app) => {
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  return app.sandbox.ProjectWizard;
};

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
const textOf = (el) => (el ? H.visibleText(el.inner) : '');

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

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

// A key pressed inside the wizard (its root's keydown listeners), on an element of the given tag
async function key(app, name, tagName = 'INPUT') {
  const root = existing(app, 'project-wizard');
  const ev = { type: 'keydown', key: name, shiftKey: false, target: { tagName }, currentTarget: root, preventDefault() {}, stopPropagation() {} };
  for (const fn of root.listeners.keydown || []) await fn(ev);
  await app.settle(10);
}

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

async function filled(opts) {
  const app = await opened(opts);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  return app;
}

async function imported(state, opts = {}) {
  const app = await filled({ start: state, ...opts });
  await press(app, 'wizard-next');
  await emit(app, state);
  return app;
}

async function atAnalysis(opts) {
  const app = await imported(CLONING, opts);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard went on to the analysis once the clone was ready');
  return app;
}

const trayItem = (app, id = PID) => H.findEl(trayMarkup(app), (e) => e.attrs['data-testid'] === 'tray-item' && e.attrs['data-project'] === id);
const part = (app, id) => H.findEl(byTestId(wizardMarkup(app), 'wizard-cost')?.outer || '', (e) => e.attrs['data-part'] === id);

// ---- no access: Edit the URL -----------------------------------------------------------------------

test('#641 Edit the URL after a refused access opens the fields again, and Next imports the new URL while the failed one stays in the tray', async () => {
  const OTHER = 'https://github.com/o/other.git';
  const app = await imported(NO_ACCESS, { start: (data) => (data.repo === REPO ? NO_ACCESS : { ...CLONING, projectId: 'p-two' }) });
  const field = () => byTestId(wizardMarkup(app), 'wizard-repo');
  assert.equal('readonly' in (field()?.attrs || {}), true, 'the URL is locked while its import is shown');
  await press(app, 'wizard-edit-repo');
  assert.equal(currentStep(app), 'repository');
  assert.equal('readonly' in field().attrs, false, 'the URL can be edited again');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-error'), null, 'the old error is gone');
  await typeInto(app, '#wizard-repo', OTHER);
  await press(app, 'wizard-next');
  const calls = app.callsTo('startOnboarding').map((c) => c[0]?.repo);
  assert.deepEqual(calls, [REPO, OTHER], 'a second import with the new URL');
  assert.equal(trayItem(app, PID)?.attrs['data-status'], 'failed', 'the refused import stays in the tray');
  assert.equal(trayItem(app, 'p-two')?.attrs['data-status'], 'cloning', 'the new import is in the tray');
});

test('#641 a failed clone (not an access error) offers no Edit the URL', async () => {
  const FAILED = { ...NO_ACCESS, code: 'clone-failed', reason: 'git clone exited with code 128' };
  const app = await imported(FAILED);
  assert.ok(byTestId(wizardMarkup(app), 'wizard-error'), 'the error is shown');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-edit-repo'), null);
});

// ---- the gh / glab warning on the analysis step ----------------------------------------------------

test('#641 the gh warning is still shown on the analysis step after the clone is ready, and the analysis can start', async () => {
  const app = await imported({ ...CLONING, cli: CLI_MISSING });
  await emit(app, { ...READY, cli: CLI_MISSING });
  assert.equal(currentStep(app), 'analysis');
  const warn = byTestId(wizardMarkup(app), 'wizard-cli-warning');
  assert.ok(warn, 'data-testid="wizard-cli-warning" on the analysis step');
  assert.equal(warn.attrs['data-error'], 'cli-missing');
  assert.ok(textOf(warn).includes(CLI_MISSING.reason), 'the reason in words');
  // #725: the analysis starts from the workflows column's Analyze the repository
  assert.ok(byTestId(wizardMarkup(app), 'wizard-workflows-choice-analyze'), 'Start analysis is still offered');
});

// ---- the cost --------------------------------------------------------------------------------------

test('#641 the cost shows the project map\'s estimate as an amount, the total known so far (#730: no ranking part; #74: the profile\'s is not known)', async () => {
  const app = await atAnalysis({ estimate: { estimate: { usd: 0.42, basis: 'files' } } });
  await app.settle(10);
  assert.equal(textOf(part(app, 'projectMap')).includes('$0.42'), true, `the project map part: ${textOf(part(app, 'projectMap'))}`);
  assert.ok(!part(app, 'ranking'), 'no ranking part since #730');
  const cost = byTestId(wizardMarkup(app), 'wizard-cost');
  assert.equal(textOf(byTestId(cost.outer, 'wizard-cost-total')), '$0.42');
  assert.match(textOf(byTestId(cost.outer, 'wizard-cost-unknown')), /leaves out an analysis/, '#74: the total says it leaves the profile out');
  assert.doesNotMatch(textOf(cost), /ranking/i);
});

test('#641 with no estimate at all the cost says "Not known yet", never $0', async () => {
  const app = await atAnalysis({ estimate: { estimate: null } });
  await app.settle(10);
  const cost = byTestId(wizardMarkup(app), 'wizard-cost');
  assert.match(textOf(part(app, 'projectMap')), /Not known yet/);
  assert.equal(textOf(byTestId(cost.outer, 'wizard-cost-total')), 'Not known yet');
  assert.doesNotMatch(textOf(cost), /\$\s?0(\.00)?\b/, 'no $0 in the cost');
});

test('#641 a cost below one cent is shown as "< $0.01", not $0.00', async () => {
  const app = await atAnalysis({ estimate: { estimate: { usd: 0.004 } } });
  await app.settle(10);
  assert.equal(textOf(part(app, 'projectMap')).includes('< $0.01'), true, `the project map part: ${textOf(part(app, 'projectMap'))}`);
});

// ---- the analyzed state ----------------------------------------------------------------------------

test('#641 once analyzed, the analysis step says it is done, offers no Start analysis, and Next goes to the review', async () => {
  const app = await atAnalysis();
  await emit(app, ANALYZED);
  assert.equal(currentStep(app), 'analysis');
  const markup = wizardMarkup(app);
  assert.match(H.visibleText(markup), /analyses are done/i);
  assert.equal(byTestId(markup, 'wizard-analyze'), null, 'no Start analysis once analyzed');
  const next = byTestId(markup, 'wizard-next');
  assert.ok(next, 'Next is offered');
  assert.equal('disabled' in next.attrs, false);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
});

// ---- the tray's dismiss ----------------------------------------------------------------------------

test('#641 a finished import can be dismissed from the tray; one still cloning cannot', async () => {
  const app = await imported(CLONING);
  const dismissOf = () => H.findEl(trayItem(app)?.outer || '', (e) => e.attrs['data-act'] === 'dismiss');
  assert.equal(dismissOf(), null, 'no dismiss while cloning');
  await emit(app, READY);
  const dismiss = dismissOf();
  assert.ok(dismiss, 'a dismiss once ready');
  await clickRendered(app, dismiss, ['#onboarding-tray']);
  await app.settle(10);
  assert.equal(trayItem(app), null, 'the item left the tray');
});

// ---- focus and keys --------------------------------------------------------------------------------

test('#641 close() gives the focus back to the element that had it when the wizard opened', async () => {
  const app = page();
  await app.boot();
  let focused = 0;
  app.sandbox.document.activeElement = { isConnected: true, focus() { focused += 1; } };
  wizard(app).open();
  await app.settle(10);
  wizard(app).close();
  assert.equal(focused, 1, 'the opener got the focus back');
});

test('#641 Enter in a field of the repository step goes on like Next (starts the import)', async () => {
  const app = await filled();
  await key(app, 'Enter', 'INPUT');
  const calls = app.callsTo('startOnboarding');
  assert.equal(calls.length, 1, 'one api.startOnboarding call');
  assert.equal(calls[0][0]?.repo, REPO);
  assert.equal(calls[0][0]?.name, NAME);
});

test('#641 Escape closes the wizard, and the tray stays', async () => {
  const app = await imported(CLONING);
  await key(app, 'Escape', 'DIV');
  assert.equal(H.findEl(wizardMarkup(app), (e) => 'data-step' in e.attrs), null, 'the wizard is closed');
  assert.ok(trayItem(app), 'the tray item is still there');
});
