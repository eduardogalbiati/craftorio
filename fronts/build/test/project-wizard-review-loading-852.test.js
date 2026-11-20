// #852 acceptance, written before the code: the Review (step 4) says the same thing the same way while the project
// map runs, and its languages block says it is loading. On the real page (packages/ui-kit/test/renderer-app-harness.js),
// driven as project-wizard-review-781.test.js.
//
// The contract assumed here:
// - while the projectMap job runs, the City card (wizard-review-city) and the Findings card (wizard-review-findings)
//   each show ONE running indicator, data-testid="wizard-review-running": the same markup in both, holding a
//   spinner (an element with the class `spinner`) and the catalog's onboarding.job_status_running; the City card
//   keeps its "Open the city" (wizard-open-city);
// - projectMap done: no wizard-review-running, no spinner in either card; failed: no wizard-review-running, no
//   spinner, the job's reason and Retry (wizard-job-retry-projectMap);
// - the languages of the project card (.wizard-review-project): until facts arrive (the analysis running, or its
//   read not answered) a placeholder data-testid="wizard-review-languages-loading" saying the NEW key
//   onboarding.review_languages_loading; once facts arrive the bar (architecture-languages-bar) with its
//   percentages and no placeholder; a facts read that failed (api.architectureFacts rejected) says the NEW key
//   onboarding.review_languages_failed instead, with no placeholder;
// - project-wizard.css: its prefers-reduced-motion: reduce rule covers the review's spinner (names wizard-review).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const CSS = path.join(ROOT, 'fronts', 'build', 'views', 'projects', 'project-wizard.css');

const PROJECT = { id: W.PID, name: W.NAME, repo: W.REPO, folder: 'C:/ws/repos/new', exists: true };
const MAP_ERROR = 'project-map stopped: disk full';
const stateWith = (status, projectMap) => ({
  projectId: W.PID, status, cli: W.CLI_OK,
  jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap }),
});
const MAP_RUNNING = stateWith('analyzing', { status: 'running' });
const MAP_DONE = stateWith('analyzed', { status: 'done' });
const MAP_FAILED = stateWith('analyzed', { status: 'failed', error: MAP_ERROR, reason: MAP_ERROR });

const LANGUAGES = [{ language: 'Rust', lines: 800, files: 40 }, { language: 'Markdown', lines: 200, files: 9 }];
const FACTS = { state: 'ok', exclude: [], model: { files: [{ file: 'src/main.rs', lines: 800, commits: 40, language: 'rust' }], languages: LANGUAGES, danger_zone: [], complexity: { metric: 'cyclomatic', tool: 'test' } } };
const CITY = { state: 'ok', model: { grouping: 'folders', districts: [{ id: 'src', name: 'src', buildings: [{ file: 'src/main.rs' }] }] }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null };
const REPORT_VIEW = { report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: null, simulated: true, report: { summary: 'A tool.', areas: [], findings: [] } }, previousId: null, gone: [], runsSince: 0, findings: [] };
const never = () => new Promise(() => {});

function page(state, api = {}) {
  return loadApp({
    api: {
      listProjects: async () => [W.clone(PROJECT)],
      startOnboarding: async () => W.clone(W.CLONING),
      onboardingStatus: async () => W.clone(state),
      analyzeOnboarding: async (id) => ({ ...W.clone(state), projectId: id }),
      retryOnboarding: async (id) => ({ ...W.clone(W.CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => W.clone(CITY),
      architectureFacts: async () => W.clone(FACTS),
      architectureReport: async () => W.clone(REPORT_VIEW),
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      backlogProgress: async () => null,
      ...api,
    },
  });
}

async function atReview(state, api) {
  const app = page(state, api);
  await app.boot();
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', W.NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.CLONING);
  await W.emit(app, W.READY);
  assert.equal(W.currentStep(app), 'analysis', 'the analysis step once the clone was ready');
  await W.emit(app, state);
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'review', 'the review');
  await app.settle(20);
  return app;
}

const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const section = (app, id) => W.byTestId(W.wizardMarkup(app), id);
const reviewHtml = (app) => section(app, 'wizard-review')?.outer || '';
const running = (html) => allByTestId(html, 'wizard-review-running');

// ---- a) one running indicator, the same in the City and Findings cards ------------------------------------

test('#852 while the project map runs, the Review shows two running indicators: one in City, one in Findings', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_RUNNING);
  assert.equal(running(reviewHtml(app)).length, 2, 'two data-testid="wizard-review-running" in the review');
  assert.deepEqual(['wizard-review-city', 'wizard-review-findings'].map((id) => running(section(app, id)?.outer || '').length), [1, 1]);
});

test('#852 the City and Findings running indicators are the same markup: a spinner and "running"', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_RUNNING);
  const [a, b] = running(reviewHtml(app));
  assert.ok(a && b, 'two running indicators');
  assert.equal(a.outer, b.outer, 'the same markup');
  assert.equal(W.hasSpinner(a.outer), true, `a spinner: ${a.outer}`);
  assert.equal(textOf(a).includes(catalog('en')['onboarding.job_status_running']), true, textOf(a));
});

test('#852 while the project map runs, the City card keeps "Open the city"', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_RUNNING);
  assert.ok(W.byTestId(section(app, 'wizard-review-city')?.outer || '', 'wizard-open-city'), 'wizard-open-city in the City card');
  assert.equal(running(section(app, 'wizard-review-city')?.outer || '').length, 1, 'and its running indicator');
});

// ---- b) done and failed: no running indicator --------------------------------------------------------------

test('#852 guard: the project map done, no running indicator and no spinner in City or Findings', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_DONE);
  assert.equal(running(reviewHtml(app)).length, 0);
  assert.deepEqual(['wizard-review-city', 'wizard-review-findings'].map((id) => W.hasSpinner(section(app, id)?.outer || '')), [false, false]);
});

test('#852 guard: the project map failed, its reason and Retry, no running indicator and no spinner', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_FAILED);
  const html = reviewHtml(app);
  assert.equal(running(html).length, 0);
  assert.deepEqual(['wizard-review-city', 'wizard-review-findings'].map((id) => W.hasSpinner(section(app, id)?.outer || '')), [false, false]);
  assert.equal(textOf(section(app, 'wizard-review-city')).includes(MAP_ERROR), true, textOf(section(app, 'wizard-review-city')));
  assert.ok(W.byTestId(html, 'wizard-job-retry-projectMap'), 'Retry (wizard-job-retry-projectMap)');
});

// ---- c) the languages block: loading, loaded, failed --------------------------------------------------------

const projectCard = (app) => H.findEl(W.wizardMarkup(app), (e) => W.classesOf(e).includes('wizard-review-project'));
const placeholder = (app) => W.byTestId(projectCard(app)?.outer || '', 'wizard-review-languages-loading');

test('#852 the catalogs have onboarding.review_languages_loading and onboarding.review_languages_failed', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const key of ['onboarding.review_languages_loading', 'onboarding.review_languages_failed']) {
      const s = catalog(lang)[key];
      assert.equal(typeof s === 'string' && s.trim().length > 0, true, `${lang}.json ${key}`);
    }
  }
});

test('#852 facts not read yet: the project card shows the languages placeholder, saying it is loading', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_DONE, { architectureFacts: never });
  const el = placeholder(app);
  assert.ok(el, 'data-testid="wizard-review-languages-loading" in the project card');
  assert.equal(textOf(el).includes(catalog('en')['onboarding.review_languages_loading']), true, textOf(el));
});

test('#852 the analysis still running: the project card shows the languages placeholder', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_RUNNING);
  assert.ok(placeholder(app), 'data-testid="wizard-review-languages-loading" in the project card');
});

test('#852 facts arrived: the bar with its percentages, no placeholder', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_DONE);
  const card = projectCard(app)?.outer || '';
  assert.ok(W.byTestId(card, 'architecture-languages-bar'), 'the languages bar');
  assert.deepEqual(allByTestId(card, 'architecture-language-entry').map(textOf), ['Rust 80%', 'Markdown 20%']);
  assert.equal(placeholder(app), null, 'no placeholder');
});

test('#852 the facts read failed: a short message instead of the placeholder', { timeout: 30000 }, async () => {
  const app = await atReview(MAP_DONE, { architectureFacts: async () => { throw new Error('facts unreadable'); } });
  assert.equal(placeholder(app), null, 'no placeholder');
  assert.equal(textOf(projectCard(app)).includes(catalog('en')['onboarding.review_languages_failed']), true, textOf(projectCard(app)));
});

// ---- d) reduced motion --------------------------------------------------------------------------------------

test('#852 project-wizard.css slows the review\'s spinner under prefers-reduced-motion: reduce', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  const blocks = [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\}\s*\}/g)].map((m) => m[1]);
  assert.equal(blocks.length > 0, true, 'a prefers-reduced-motion: reduce rule');
  assert.equal(blocks.some((b) => b.includes('wizard-review')), true, blocks.join('\n'));
});
