// #738: the new-project wizard (fronts/build/views/projects/project-wizard.js, project-wizard-workflows.js)
// on a repository the owner can't push to: the repository step holds a notice (wizard-fork-notice) with
// Create a fork (wizard-create-fork → api.forkOnboarding) and Work locally (wizard-work-locally →
// api.workLocallyOnboarding); the choice moves on to the analysis step, and the workflows column's way of
// working (wizard-way-of-working) follows it: Fork + PR, or Local with no pull request. Set up as
// project-wizard-workflows-630.test.js, on the real page (renderer-app-harness).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-fork';
const REPO = 'https://github.com/acme/widgets.git';
const NAME = 'Widgets';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/widgets', exists: true };
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit' };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const withFork = (state, fork, push = false) => ({ ...state, access: { push }, ...(fork ? { fork } : {}) });
const SUGGESTED = withFork(READY, { status: 'suggested', repo: 'acme/widgets' });
const PUSHABLE = withFork(READY, null, true);
const PROFILED = (fork) => ({
  ...withFork(READY, fork),
  status: 'analyzing',
  profile: PROFILE,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
});

const clone = (x) => JSON.parse(JSON.stringify(x));

function page(calls, forkAnswer = withFork(READY, { status: 'created', repo: 'acme/widgets', url: 'https://github.com/me/widgets' })) {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => null,
      analyzeOnboarding: async (id) => ({ ...clone(READY), status: 'analyzing', projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      forkOnboarding: async (id) => { calls.push(`fork:${id}`); return clone(forkAnswer); },
      workLocallyOnboarding: async (id) => { calls.push(`local:${id}`); return clone(withFork(READY, { status: 'declined', repo: 'acme/widgets' })); },
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      pickFolder: async () => 'C:/code/widgets',
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
const textOf = (el) => (el ? H.visibleText(el.inner).replace(/\s+/g, ' ').trim() : '');

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

// the wizard on the repository step, the clone done with the given access answer
async function cloned(ready, calls = [], forkAnswer = undefined) {
  const app = page(calls, forkAnswer);
  await app.boot();
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, ready);
  return app;
}

test('#738 no push access: the repository step holds the fork notice with Create a fork and Work locally', { timeout: 20000 }, async () => {
  const app = await cloned(SUGGESTED);
  assert.equal(currentStep(app), 'repository', 'the wizard waits for the owner\'s choice');
  const html = wizardMarkup(app);
  assert.equal(textOf(byTestId(html, 'wizard-fork-notice')).includes("You can't push to acme/widgets. Create a fork in your account to contribute?"), true);
  assert.equal(textOf(byTestId(html, 'wizard-create-fork')), 'Create a fork');
  assert.equal(textOf(byTestId(html, 'wizard-work-locally')), 'Work locally');
});

test('#738 push access: no fork notice, the wizard goes on to the analysis', { timeout: 20000 }, async () => {
  const app = await cloned(PUSHABLE);
  assert.equal(currentStep(app), 'analysis');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-fork-notice') === null, true);
});

test('#738 Create a fork asks the engine for the fork and moves on with the Fork + PR way of working', { timeout: 20000 }, async () => {
  const calls = [];
  const app = await cloned(SUGGESTED, calls);
  await press(app, 'wizard-create-fork');
  assert.deepEqual(calls, [`fork:${PID}`]);
  assert.equal(currentStep(app), 'analysis');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILED({ status: 'created', repo: 'acme/widgets', url: 'https://github.com/me/widgets' }));
  const way = byTestId(wizardMarkup(app), 'wizard-way-of-working');
  assert.equal(way?.attrs['data-mode'] ?? null, 'fork');
  assert.match(textOf(way), /^Fork \+ PR/);
});

test('#738 Work locally moves on with the Local way of working and says there is no pull request', { timeout: 20000 }, async () => {
  const calls = [];
  const app = await cloned(SUGGESTED, calls);
  await press(app, 'wizard-work-locally');
  assert.deepEqual(calls, [`local:${PID}`]);
  assert.equal(currentStep(app), 'analysis');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILED({ status: 'declined', repo: 'acme/widgets' }));
  const way = byTestId(wizardMarkup(app), 'wizard-way-of-working');
  assert.equal(way?.attrs['data-mode'] ?? null, 'local');
  assert.match(textOf(way), /^Local\b/);
  assert.match(textOf(way), /no pull request/i);
});

test('#738 a failed fork keeps the notice with its reason, so the owner can try again or work locally', { timeout: 20000 }, async () => {
  const app = await cloned(withFork(READY, { status: 'failed', repo: 'acme/widgets', reason: 'HTTP 403: forking is disabled' }));
  assert.equal(currentStep(app), 'repository');
  const notice = textOf(byTestId(wizardMarkup(app), 'wizard-fork-notice'));
  assert.equal(notice.includes('HTTP 403: forking is disabled'), true);
});

// #126: Create a fork while the clone still runs. The engine makes the fork at once (fork: created, url) and
// sets the remotes once the clone ends; the notice says so instead of two disabled buttons with no message.
const FORK_URL = 'https://github.com/me/widgets';
const SUGGESTED_CLONING = withFork(CLONING, { status: 'suggested', repo: 'acme/widgets' });
const CREATED_CLONING = withFork(CLONING, { status: 'created', repo: 'acme/widgets', url: FORK_URL });
const FAILED_CLONING = withFork(CLONING, { status: 'failed', repo: 'acme/widgets', reason: 'HTTP 403: forking is disabled' });
const isDisabled = (el) => el !== null && Object.prototype.hasOwnProperty.call(el.attrs, 'disabled');

test('#126 Create a fork while the clone runs: the notice shows the fork and that the remotes wait for the clone', { timeout: 20000 }, async () => {
  const calls = [];
  const app = await cloned(SUGGESTED_CLONING, calls, CREATED_CLONING);
  assert.equal(currentStep(app), 'repository');
  await press(app, 'wizard-create-fork');
  assert.deepEqual(calls, [`fork:${PID}`]);
  assert.equal(currentStep(app), 'repository', 'the clone still runs: the wizard stays on the repository step');
  const html = wizardMarkup(app);
  const notice = textOf(byTestId(html, 'wizard-fork-notice'));
  assert.equal(notice.includes(FORK_URL), true, `the notice shows the fork's URL: ${notice}`);
  assert.match(notice, /clone/i, 'the notice says it waits for the clone');
  assert.match(notice, /remote|origin|upstream/i, 'the notice says the remotes are set then');
  assert.equal(isDisabled(byTestId(html, 'wizard-create-fork')), false, 'no disabled Create a fork button left on screen');
  assert.equal(isDisabled(byTestId(html, 'wizard-work-locally')), false, 'no disabled Work locally button left on screen');
});

test('#126 the waiting notice moves on to the analysis once the clone ends', { timeout: 20000 }, async () => {
  const app = await cloned(SUGGESTED_CLONING, [], CREATED_CLONING);
  await press(app, 'wizard-create-fork');
  assert.equal(textOf(byTestId(wizardMarkup(app), 'wizard-fork-notice')).includes(FORK_URL), true, 'the waiting notice is shown first');
  await emit(app, withFork(READY, { status: 'created', repo: 'acme/widgets', url: FORK_URL }));
  assert.equal(currentStep(app), 'analysis');
});

test('#126 a fork that fails while the clone runs shows its reason at once, with both choices enabled again', { timeout: 20000 }, async () => {
  const calls = [];
  const app = await cloned(SUGGESTED_CLONING, calls, FAILED_CLONING);
  await press(app, 'wizard-create-fork');
  assert.deepEqual(calls, [`fork:${PID}`]);
  assert.equal(currentStep(app), 'repository');
  const html = wizardMarkup(app);
  assert.equal(textOf(byTestId(html, 'wizard-fork-notice')).includes('HTTP 403: forking is disabled'), true);
  const create = byTestId(html, 'wizard-create-fork');
  const local = byTestId(html, 'wizard-work-locally');
  assert.equal(create !== null && !isDisabled(create), true, 'Create a fork can be pressed again');
  assert.equal(local !== null && !isDisabled(local), true, 'Work locally can be pressed');
});
