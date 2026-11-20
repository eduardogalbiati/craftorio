// #844 acceptance, written before the code: the new-project wizard's step 3 "Suggested workflows"
// (fronts/build/views/projects/project-wizard-workflows.js over packages/shared/onboarding-model.js) never
// promises unit tests for a project without tests. On the real page (renderer-app-harness), driven as
// project-wizard-i18n-726.test.js.
//
// The contract assumed here:
// - the profile job's profile of an imported repository with no test command and no test file has
//   testCommand null and its tests unset (null) or 'none';
// - then the feature and fix rows' reasons (data-testid="wizard-workflow-reason"), their picked option and
//   the profile line (data-testid="wizard-profile") say nothing of unit tests: no "unit" in English, no
//   "unitários" in pt-BR (so no "Código + unitários", no "depois escreve os testes unitários");
// - a profile with a test command and unit tests may still say so.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@multiagent/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/shop.git';
const NAME = 'Shop';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/shop', exists: true };
const NO_TESTS = { mode: 'local', ci: 'none', tests: null, testCommand: null, checkCommand: null, e2eCommand: null, release: 'milestone', languages: ['python'] };
const WITH_TESTS = { ...NO_TESTS, tests: 'unit', testCommand: 'npm test', languages: ['javascript'] };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'running' } }), cli: CLI_OK };
const profiledState = (profile) => ({
  projectId: PID, status: 'analyzing', profile, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile }, projectMap: { status: 'running' } }),
});

const clone = (x) => JSON.parse(JSON.stringify(x));

function page(profiled) {
  return loadApp({
    only: (src) => !src.startsWith('views/settings/'),
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async (id) => (id === PID ? clone(profiled) : null),
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

async function fire(app, el, types) {
  const root = app.el('#project-wizard');
  for (const type of types) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  await fire(app, el, ['input', 'change', 'blur']);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// the wizard at step 3 with the profile job done on `profile`, the interface in `lang`
async function profiled(profile, lang) {
  const state = profiledState(profile);
  const app = page(state);
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
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
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, state);
  await app.settle(10);
  return app;
}

const rowOf = (app, kind) => H.findAll(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow').find((r) => r.attrs['data-kind'] === kind) || null;
const pickedText = (row) => {
  const sel = H.findEl(row?.outer || '', (e) => e.name === 'select' && e.attrs['data-testid'] === 'wizard-workflow-select');
  const opt = H.findAll(sel?.inner || '', (e) => e.name === 'option').find((o) => 'selected' in o.attrs);
  return opt ? H.visibleText(opt.inner) : '';
};
// what the feature and fix rows and the profile line say: their reasons and picked options
function promised(app) {
  const parts = ['feature', 'fix'].map((kind) => {
    const row = rowOf(app, kind);
    assert.ok(row, `step 3 has the ${kind} row (a profile without tests is still a profile: the column shows its rows)`);
    return `${kind}: ${textOf(byTestId(row.outer, 'wizard-workflow-reason'))} | ${pickedText(row)}`;
  });
  parts.push(`profile: ${textOf(byTestId(wizardMarkup(app), 'wizard-profile'))}`);
  return parts.join('\n');
}

test('#844 no test command: the suggested feature and fix never promise unit tests (English)', async () => {
  for (const tests of [null, 'none']) {
    const said = promised(await profiled({ ...NO_TESTS, tests }, 'en'));
    assert.doesNotMatch(said, /\bunit\b/i, `tests ${tests}:\n${said}`);
  }
});

test('#844 no test command: the suggested feature and fix never promise unit tests (pt-BR)', async () => {
  for (const tests of [null, 'none']) {
    const said = promised(await profiled({ ...NO_TESTS, tests }, 'pt-BR'));
    assert.doesNotMatch(said, /unitári/i, `tests ${tests}:\n${said}`);
  }
});

test('#844 guard: a project with a test command and unit tests is still told so', async () => {
  const said = promised(await profiled(WITH_TESTS, 'en'));
  assert.match(said, /\bunit\b/i, said);
});
