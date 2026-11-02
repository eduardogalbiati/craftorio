// #630 (spec R6, R8; mock-4): the new-project wizard's step 3 (fronts/build/views/projects/project-wizard.js)
// suggests the new workflow set from the ways-of-working profile. Acceptance tests, written before the code,
// on the real page (packages/ui-kit/test/renderer-app-harness.js), set up as project-wizard-mockups-669.test.js.
//
// Spec (the interface these tests assume):
// - the onboarding state's profile job, once done, carries the profile { mode, ci, tests } (jobs.profile.profile;
//   the fixture also sets it at the state's top level, `profile`);
// - step 3's "Suggested workflows" is one row per kind, data-testid="wizard-workflow" data-kind="<kind>", in the
//   order feature, fix, release, ci; each row has its reason, data-testid="wizard-workflow-reason" ("Why ..."),
//   and an enabled select data-testid="wizard-workflow-select" with at least two options;
// - the "Ways of working profile" line, data-testid="wizard-profile", says the profile's mode (remote: pull
//   requests).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@multiagent/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit+e2e' };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'running' } }), cli: CLI_OK };
const PROFILED = {
  projectId: PID,
  status: 'analyzing',
  profile: PROFILE,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
  cli: CLI_OK,
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function page() {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async (id) => (id === PID ? clone(PROFILED) : null),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      pickFolder: async () => 'C:/code/shop',
    },
  });
}

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
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const isDisabled = (e) => 'disabled' in e.attrs || e.attrs['aria-disabled'] === 'true';

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

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
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

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// the wizard at step 3 with the profile job done
async function profiled(state = PROFILED) {
  const app = page();
  await app.boot();
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard went on to the analysis once the clone was ready');
  // #725: the rows show once a way in is chosen: Analyze the repository, then the profile job's answer
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, state);
  await app.settle(10);
  return app;
}

const rows = (app) => H.findAll(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow');

test('#630 step 3: four workflow rows, feature, fix, release and ci in that order', { timeout: 20000 }, async () => {
  const app = await profiled();
  assert.deepEqual(rows(app).map((r) => r.attrs['data-kind'] ?? null), ['feature', 'fix', 'release', 'ci']);
});

test('#630 step 3: each workflow row says why it is suggested', { timeout: 20000 }, async () => {
  const app = await profiled();
  const found = rows(app);
  assert.equal(found.length, 4, 'four rows data-testid="wizard-workflow"');
  for (const row of found) {
    const reason = textOf(byTestId(row.outer, 'wizard-workflow-reason')).trim();
    assert.match(reason, /^why\b/i, `the ${row.attrs['data-kind']} row's reason: "${reason}"`);
  }
});

test('#630 step 3: each workflow row has an enabled select with at least two choices', { timeout: 20000 }, async () => {
  const app = await profiled();
  const found = rows(app);
  assert.equal(found.length, 4, 'four rows data-testid="wizard-workflow"');
  for (const row of found) {
    const kind = row.attrs['data-kind'];
    const sel = H.findEl(row.outer, (e) => e.name === 'select' && e.attrs['data-testid'] === 'wizard-workflow-select');
    assert.equal(sel === null, false, `the ${kind} row's select[data-testid="wizard-workflow-select"]`);
    assert.equal(isDisabled(sel), false, `the ${kind} row's select is enabled`);
    const options = H.findAll(sel.inner, (e) => e.name === 'option').length;
    assert.equal(options >= 2, true, `the ${kind} row's select has ${options} option(s)`);
  }
});

test('#630 step 3: the ways of working profile line says the project works through pull requests', { timeout: 20000 }, async () => {
  const app = await profiled();
  const line = byTestId(wizardMarkup(app), 'wizard-profile');
  assert.equal(line === null, false, 'data-testid="wizard-profile"');
  assert.match(textOf(line), /pull request|\bPR\b|remote/i);
});

test('#630 step 3: the profile line reads the profile job\'s result when the state has no top-level profile', { timeout: 20000 }, async () => {
  const { profile, ...jobOnly } = clone(PROFILED);
  assert.equal(profile === undefined, false, 'the fixture had a top-level profile to drop');
  const app = await profiled(jobOnly);
  const line = byTestId(wizardMarkup(app), 'wizard-profile');
  assert.equal(line === null, false, 'data-testid="wizard-profile"');
  assert.match(textOf(line), /pull request|\bPR\b|remote/i);
});
