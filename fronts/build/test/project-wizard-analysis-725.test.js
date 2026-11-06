// #725: the project wizard's analysis step (fronts/build/views/projects/project-wizard.js): the "Suggested
// workflows" column starts with two choices, shows the analysis running, its failure with Retry, or the
// rows defined by hand; Continue is always possible; a failed paid job says why with Retry on its row, in
// the review's refactor card and in the tray. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-workflows-630.test.js.
//
// Spec (the interface these tests assume):
// - right column (workflowsColumn):
//   - data-testid="wizard-workflows-choice-analyze" ("Analyze the repository") and
//     data-testid="wizard-workflows-choice-manual" ("Define manually"): the two choices before any pick; no
//     data-testid="wizard-workflow" row is shown before a pick;
//   - data-testid="wizard-workflows-analyzing": the overlay while the profile job runs after Analyze, holding
//     the analysis' activity lines (#781: wizard-analysis-phases, no spinner; project-wizard-phases-781.test.js);
//     the rows are drawn under it, not interactive (each row's select disabled, or the rows / their list inert or
//     aria-disabled="true");
//   - once the profile job is done: the rows with the profile's picks, each reason "Why ..." (never
//     "No project profile yet");
//   - data-testid="wizard-workflows-failed": the profile job failed (or answered no profile): its reason, with
//     data-testid="wizard-workflows-retry" (api.retryOnboarding) and wizard-workflows-choice-manual;
//   - Define manually: the four rows, selects enabled at once, no data-testid="wizard-workflow-reason";
//     wizard-workflows-choice-analyze stays offered.
// - footer: data-testid="wizard-next" (Continue) on the analysis step, never disabled, in every state; no
//   data-testid="wizard-analyze" ("Analyze and continue" / "Analisar e continuar") any more.
// - a failed job's state from the engine (packages/engine/test/project-onboarding-failed-job-725.test.js):
//   jobs.<id> = { status: 'failed', error: <the full error>, code: 'cli-missing' | 'invalid-ranking' |
//   'no-folder' | 'refused' | 'timeout' | ..., reason: <a short English sentence>, cli?: 'claude' }; the wizard
//   words it in the interface's language from `code` (pt-BR: "Falhou: o Product Owner precisa do claude, que
//   não está instalado."). After a failed paid job the onboarding no longer goes back to `ready`: the fixture
//   ends `analyzed` with the project map failed (the wizard reads the job, not the top status; #730: the
//   ranking job is gone, these tests fail the project map instead).
// - left column's job rows (wizard-cost's li data-part="projectMap"): data-testid="wizard-job-error-projectMap"
//   (the reason in words, error color, title = the full error) and data-testid="wizard-job-retry-projectMap"
//   (api.retryOnboarding); its amount (.wizard-amount) reads "—" for a failed job; a done job its cost or
//   "grátis", never "Ainda não estimado".
// - review: wizard-review-findings data-state="failed" with the same reason and data-testid="wizard-job-retry-projectMap".
// - tray (#onboarding-tray, the wizard closed): the tray-item shows the failed job's reason and a
//   data-act="retry" button (api.retryOnboarding with the project).
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
  projectMap: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const PROFILING = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' } }), cli: CLI_OK };
const PROFILED = {
  projectId: PID,
  status: 'ready',
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE } }),
  cli: CLI_OK,
};
const PROFILE_ERROR = 'The interview refused: the Oracle\'s daily budget is spent.';
const PROFILE_FAILED = {
  projectId: PID,
  status: 'ready',
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'failed', error: PROFILE_ERROR, code: 'refused', reason: PROFILE_ERROR } }),
  cli: CLI_OK,
};
const NO_PROFILE = { ...PROFILED, jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' } }) };
// #730: no ranking job any more; the paid job that fails here is the project map (the city and the report)
const MAP_ERROR = 'The Oracle needs claude, which is not installed.';
const MAP_FAILED = {
  projectId: PID,
  status: 'analyzed',
  jobs: jobs({
    clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE },
    projectMap: { status: 'failed', error: MAP_ERROR, code: 'cli-missing', cli: 'claude', reason: MAP_ERROR },
  }),
  cli: CLI_OK,
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function page() {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => clone(READY),
      analyzeOnboarding: async (id) => ({ ...clone(PROFILING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(PROFILING), projectId: id }),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      getBacklog: async () => ({ issues: [] }),
      architectureCity: async () => null,
      architectureFacts: async () => null,
      refactorProposals: async () => [],
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
const trayMarkup = (app) => markupOf(app, 'onboarding-tray');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const isDisabled = (e) => 'disabled' in e.attrs || e.attrs['aria-disabled'] === 'true';
const isInert = (e) => 'inert' in e.attrs || e.attrs['aria-disabled'] === 'true';

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

async function press(app, testid, html = wizardMarkup(app)) {
  const el = byTestId(html, testid);
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

// the wizard at the analysis step, the clone ready; lang: the interface's language
async function atAnalysis({ lang = 'en' } = {}) {
  const app = page();
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
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
  return app;
}

const rows = (app) => H.findAll(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow');
const selectOf = (row) => H.findEl(row.outer, (e) => e.name === 'select' && e.attrs['data-testid'] === 'wizard-workflow-select');
const part = (app, id) => H.findEl(byTestId(wizardMarkup(app), 'wizard-cost')?.outer || '', (e) => e.attrs['data-part'] === id);
const amountOf = (row) => textOf(H.findEl(row.outer, (e) => /\bwizard-amount\b/.test(e.attrs.class || ''))).trim();

// Continue on the footer, shown and enabled; no "Analyze and continue"
function assertContinue(app, when) {
  const markup = wizardMarkup(app);
  const next = byTestId(markup, 'wizard-next');
  assert.equal(next === null, false, `${when}: Continue (data-testid="wizard-next") is shown`);
  assert.equal('disabled' in next.attrs, false, `${when}: Continue is enabled`);
  assert.equal(byTestId(markup, 'wizard-analyze'), null, `${when}: no "Analyze and continue" (data-testid="wizard-analyze")`);
}

// the rows are drawn but not interactive (under the overlay)
function assertDimmed(app) {
  const html = wizardMarkup(app);
  const list = H.findEl(html, (e) => /\bwizard-workflows\b/.test(e.attrs.class || '') && e.name === 'ul');
  const found = rows(app);
  assert.equal(found.length, 4, 'four rows under the overlay');
  const blocked = (list && isInert(list)) || found.every((r) => isInert(r) || (selectOf(r) && isDisabled(selectOf(r))));
  assert.equal(blocked, true, 'the rows under the overlay are not interactive');
}

// ---- 1. the two choices first --------------------------------------------------------------------

test('#725 the workflows column starts with two choices, Analyze the repository and Define manually, and no rows', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-workflows-choice-analyze') === null, false, 'data-testid="wizard-workflows-choice-analyze"');
  assert.equal(byTestId(markup, 'wizard-workflows-choice-manual') === null, false, 'data-testid="wizard-workflows-choice-manual"');
  assert.equal(rows(app).length, 0, 'no workflow row before a pick');
});

// ---- 2. analyzing, then the profile's picks -----------------------------------------------------

test('#725 #781 Analyze the repository: the rows are dimmed under an overlay holding the analysis\' activity lines', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  const overlay = byTestId(wizardMarkup(app), 'wizard-workflows-analyzing');
  assert.equal(overlay === null, false, 'data-testid="wizard-workflows-analyzing"');
  assert.equal(byTestId(overlay.outer, 'wizard-analysis-phases') === null, false, 'the activity lines in the overlay');
  assertDimmed(app);
});

test('#725 once the profile job is done the overlay leaves and the rows show the profile\'s picks and reasons', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  await emit(app, PROFILED);
  assert.equal(byTestId(wizardMarkup(app), 'wizard-workflows-analyzing'), null, 'the overlay is gone');
  const found = rows(app);
  assert.deepEqual(found.map((r) => r.attrs['data-kind'] ?? null), ['feature', 'fix', 'release', 'ci']);
  for (const row of found) {
    const reason = textOf(byTestId(row.outer, 'wizard-workflow-reason')).trim();
    assert.match(reason, /^why\b/i, `the ${row.attrs['data-kind']} row's reason: "${reason}"`);
    assert.doesNotMatch(reason, /no project profile yet/i, `the ${row.attrs['data-kind']} row reads the profile`);
    assert.equal(isDisabled(selectOf(row)), false, `the ${row.attrs['data-kind']} row's select is enabled`);
  }
});

// ---- 3. the analysis failed ----------------------------------------------------------------------

test('#725 a failed profile job: the overlay gives way to its reason, Retry (api.retryOnboarding) and Define manually', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  await emit(app, PROFILE_FAILED);
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-workflows-analyzing'), null, 'the overlay is gone');
  const failed = byTestId(markup, 'wizard-workflows-failed');
  assert.equal(failed === null, false, 'data-testid="wizard-workflows-failed"');
  assert.match(textOf(failed), /daily budget/i, `the reason in words: "${textOf(failed)}"`);
  assert.equal(byTestId(markup, 'wizard-workflows-choice-manual') === null, false, 'Define manually is offered');
  const before = app.callsTo('retryOnboarding').length;
  await press(app, 'wizard-workflows-retry');
  assert.deepEqual(app.callsTo('retryOnboarding').slice(before).map((c) => c[0]), [PID], 'Retry calls api.retryOnboarding with the project');
});

test('#725 a profile job that answers no profile counts as failed: the reason and Retry, not "No project profile yet" rows', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  await emit(app, NO_PROFILE);
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-workflows-failed') === null, false, 'data-testid="wizard-workflows-failed"');
  assert.equal(byTestId(markup, 'wizard-workflows-retry') === null, false, 'data-testid="wizard-workflows-retry"');
  assert.doesNotMatch(H.visibleText(markup), /no project profile yet/i);
});

// ---- 4. define manually --------------------------------------------------------------------------

test('#725 Define manually: the four rows editable at once, no profile reason, and Analyze still offered', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-manual');
  const markup = wizardMarkup(app);
  const found = rows(app);
  assert.deepEqual(found.map((r) => r.attrs['data-kind'] ?? null), ['feature', 'fix', 'release', 'ci']);
  for (const row of found) {
    const sel = selectOf(row);
    assert.equal(sel === null, false, `the ${row.attrs['data-kind']} row's select`);
    assert.equal(isDisabled(sel), false, `the ${row.attrs['data-kind']} row's select is enabled`);
    assert.equal(byTestId(row.outer, 'wizard-workflow-reason'), null, `the ${row.attrs['data-kind']} row has no reason line`);
  }
  assert.equal(byTestId(markup, 'wizard-workflows-analyzing'), null, 'no overlay');
  assert.equal(byTestId(markup, 'wizard-workflows-choice-analyze') === null, false, 'Analyze the repository is still offered');
});

// ---- 5. Continue always possible -----------------------------------------------------------------

test('#725 Continue is enabled and "Analyze and continue" is gone in every state of the step', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assertContinue(app, 'not started');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  assertContinue(app, 'analyzing (profile running)');
  await emit(app, { ...PROFILING, status: 'analyzing', jobs: { ...PROFILING.jobs, projectMap: { status: 'running' } } });
  assertContinue(app, 'analyzing (project map running)');
  await emit(app, PROFILED);
  assertContinue(app, 'done');
  await emit(app, PROFILE_FAILED);
  assertContinue(app, 'profile failed');
  await emit(app, MAP_FAILED);
  assertContinue(app, 'project map failed');
  assert.doesNotMatch(H.visibleText(wizardMarkup(app)), /analyze and continue/i);
});

test('#725 pt-BR: no "Analisar e continuar" on the analysis step', { timeout: 20000 }, async () => {
  const app = await atAnalysis({ lang: 'pt-BR' });
  assert.doesNotMatch(H.visibleText(wizardMarkup(app)), /analisar e continuar/i);
  assertContinue(app, 'pt-BR, not started');
});

// ---- 8, 9. a failed job says why, with Retry on its row ------------------------------------------

test('#725 #730 a failed project map row says why in pt-BR, keeps the full error in its tooltip, and its Retry calls api.retryOnboarding', { timeout: 20000 }, async () => {
  const app = await atAnalysis({ lang: 'pt-BR' });
  await emit(app, MAP_FAILED);
  const row = part(app, 'projectMap');
  assert.equal(row === null, false, 'the project map row (data-part="projectMap")');
  assert.equal(part(app, 'ranking'), null, '#730: no ranking row');
  const error = byTestId(row.outer, 'wizard-job-error-projectMap');
  assert.equal(error === null, false, 'data-testid="wizard-job-error-projectMap" on the project map row');
  const words = textOf(error);
  assert.match(words, /claude/, `the reason names the CLI: "${words}"`);
  assert.match(words, /não está instalado/, `the reason in pt-BR: "${words}"`);
  assert.equal(String(error.attrs.title || '').includes(MAP_ERROR), true, `the full error in the tooltip: "${error.attrs.title}"`);
  const before = app.callsTo('retryOnboarding').length;
  await press(app, 'wizard-job-retry-projectMap', row.outer);
  assert.deepEqual(app.callsTo('retryOnboarding').slice(before).map((c) => c[0]), [PID], 'Retry calls api.retryOnboarding with the project');
});

test('#725 amounts: a failed job reads "—", a done job its cost or "grátis", never "Ainda não estimado"', { timeout: 20000 }, async () => {
  const app = await atAnalysis({ lang: 'pt-BR' });
  await emit(app, MAP_FAILED);
  await app.settle(10);
  assert.equal(amountOf(part(app, 'projectMap')), '—', 'the failed project map\'s amount');
  // the free jobs carry no data-part: the facts are the second job row (clone, facts, profile, project map)
  const rows = H.findAll(byTestId(wizardMarkup(app), 'wizard-cost')?.outer || '', (e) => e.name === 'li' && /\bwizard-job\b/.test(e.attrs.class || ''));
  const facts = amountOf(rows[1]);
  assert.doesNotMatch(facts, /ainda não estimado/i, `the done facts' amount: "${facts}"`);
  assert.match(facts, /\d|grátis/i, `the done facts' amount is its cost or "grátis": "${facts}"`);
});

// ---- 10. the review and the tray ----------------------------------------------------------------

test('#725 #730 the review\'s findings card, its project map failed, shows the same reason and a Retry', { timeout: 20000 }, async () => {
  const app = await atAnalysis({ lang: 'pt-BR' });
  await emit(app, MAP_FAILED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  const card = byTestId(wizardMarkup(app), 'wizard-review-findings');
  assert.equal(card === null, false, 'data-testid="wizard-review-findings"');
  assert.equal(card.attrs['data-state'], 'failed');
  assert.match(textOf(card), /claude/);
  assert.match(textOf(card), /não está instalado/, `the reason in pt-BR: "${textOf(card)}"`);
  const before = app.callsTo('retryOnboarding').length;
  await press(app, 'wizard-job-retry-projectMap', card.outer);
  assert.deepEqual(app.callsTo('retryOnboarding').slice(before).map((c) => c[0]), [PID]);
});

test('#725 the tray (wizard closed) shows a failed job\'s reason and a Retry calling api.retryOnboarding', { timeout: 20000 }, async () => {
  const app = await atAnalysis({ lang: 'pt-BR' });
  app.sandbox.ProjectWizard.close();
  await app.settle(10);
  await emit(app, MAP_FAILED);
  const item = H.findEl(trayMarkup(app), (e) => e.attrs['data-testid'] === 'tray-item' && e.attrs['data-project'] === PID);
  assert.equal(item === null, false, 'the project\'s tray-item');
  assert.match(textOf(item), /claude/);
  assert.match(textOf(item), /não está instalado/, `the reason in pt-BR: "${textOf(item)}"`);
  const retry = H.findEl(item.outer, (e) => e.attrs['data-act'] === 'retry');
  assert.equal(retry === null, false, 'a Retry (data-act="retry") on the tray-item');
  const before = app.callsTo('retryOnboarding').length;
  await clickRendered(app, retry, ['#onboarding-tray']);
  await app.settle(10);
  assert.deepEqual(app.callsTo('retryOnboarding').slice(before).map((c) => c[0]), [PID]);
});
