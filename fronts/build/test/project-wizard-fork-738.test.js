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

function page(calls) {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => null,
      analyzeOnboarding: async (id) => ({ ...clone(READY), status: 'analyzing', projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      forkOnboarding: async (id) => { calls.push(`fork:${id}`); return clone(withFork(READY, { status: 'created', repo: 'acme/widgets', url: 'https://github.com/me/widgets' })); },
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
async function cloned(ready, calls = []) {
  const app = page(calls);
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
