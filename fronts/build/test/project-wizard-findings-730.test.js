// #730: the new-project wizard (fronts/build/views/projects/project-wizard.js) without the Product Owner's
// ranking: its analysis lists no "Refactor backlog" job row, and its review lists the Oracle's findings
// (api.architectureReport(projectId)), each with "Create issue" and "Create issue and prioritize"
// (api.createFindingIssue(projectId, reportId, findingIndex, { prioritize })), in place of the refactor
// proposals sent to the roadmap at Finish. "Open the city" lands on the project's City tab.
// Acceptance tests, written before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js)
// driven as project-wizard-review-642.test.js and project-wizard-open-city-731.test.js drive it.
// The contract assumed here (new seams of #730):
// - onboarding states carry jobs { clone, facts, profile, projectMap } (no ranking);
// - the analysis step's job rows (wizard-cost's li data-part="<job>", shown while the analysis asked for with the card
//   Analyze with AI runs, #100) have no data-part="ranking";
// - #100: the analysed review is reached with that card, then Next (a done profile job carries its profile);
// - the review: data-testid="wizard-review-findings" (data-state="ready" once the report is read), one
//   data-testid="wizard-review-finding" data-finding="<index>" per finding (its title shown), with buttons
//   data-testid="wizard-review-create-issue" and "wizard-review-create-issue-prioritize" (data-finding);
//   once filed the row shows data-testid="wizard-review-finding-issue" (a link to the issue) instead;
// - no wizard-review-refactors / wizard-review-refactor-pick; Finish sends nothing to the roadmap;
// - "Open the city" (wizard-open-city) opens the project page on its City tab (state.pv.tab 'city').
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const URL_OF = (n) => `https://github.com/o/new/issues/${n}`;
const jobs = (over = {}) => ({ clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' }, projectMap: { status: 'waiting' }, ...over });
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit' };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'done' } }), cli: CLI_OK };

const FINDINGS = [
  { kind: 'god-file', title: 'Checkout does too much.', severity: 'high', status: 'new', files: [{ path: 'src/checkout.js' }], evidence: 'It changes in every commit.', refactor: 'Split it.', filed: null, proposal: null },
  { kind: 'missing-tests', title: 'Refunds have no tests.', severity: 'medium', status: 'new', files: [{ path: 'payments/refund.py' }], evidence: 'No test touches it.', refactor: 'Add tests.', filed: null, proposal: null },
];
const REPORT_VIEW = {
  report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: null, simulated: true, report: { summary: 'A shop.', areas: [], findings: FINDINGS.map(({ status, filed, proposal, ...f }) => f) } },
  previousId: null, gone: [], runsSince: 0, findings: FINDINGS,
};
const FACTS = { state: 'ok', exclude: [], model: { files: [{ file: 'src/checkout.js', quadrant: 'Danger Zone', score: 82 }], danger_zone: [] } };
const CITY = { state: 'ok', model: { grouping: 'folders', districts: [{ id: 'src', name: 'src', buildings: [{ file: 'src/checkout.js' }] }] }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null };

const clone = (x) => JSON.parse(JSON.stringify(x));

// analyze: what api.analyzeOnboarding (the card Analyze with AI) answers
function page(analyze = ANALYZED) {
  let next = 70;
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => clone(ANALYZED),
      analyzeOnboarding: async () => clone(analyze),
      retryOnboarding: async () => clone(CLONING),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => clone(CITY),
      architectureFacts: async () => clone(FACTS),
      architectureReport: async () => clone(REPORT_VIEW),
      listArchitectureReports: async () => [{ id: 'r1', date: '2026-10-20T10:00:00Z', findings: 2, simulated: true }],
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      updateProject: async (id, patch) => ({ ...clone(PROJECT), ...patch }),
      createFindingIssue: async (projectId, reportId, findingIndex, opts) => {
        next += 1;
        return { filed: { issue: next, issueUrl: URL_OF(next), stage: opts?.prioritize ? 2 : null, waiting: !!opts?.prioritize } };
      },
      addRefactorToRoadmap: async () => ({ proposal: {}, stage: 1, waiting: true }),
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
const findingRow = (app, index) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-review-finding' && e.attrs['data-finding'] === String(index));
const inRow = (app, index, testid) => (findingRow(app, index) ? byTestId(findingRow(app, index).outer, testid) : null);

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.equal(el !== null, true, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function pressIn(app, index, testid) {
  const el = inRow(app, index, testid);
  assert.equal(el !== null, true, `finding ${index} shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(20);
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

async function atAnalysis(analyze) {
  const app = page(analyze);
  await app.boot();
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard is on the analysis step');
  return app;
}

async function reviewDone() {
  const app = await atAnalysis();
  await press(app, 'wizard-workflows-choice-analyze'); // #100: the analysis is asked for by its card; Next waits for the workflows
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review', 'the wizard is on the review');
  await app.settle(20);
  return app;
}

const createCalls = (app) => app.callsTo('createFindingIssue').map((a) => [String(a[0]), String(a[1]), Number(a[2]), !!a[3]?.prioritize]);

// ---- the analysis ---------------------------------------------------------------------------------

test('#730 the wizard\'s analysis has no ranking row (no "Refactor backlog" job)', { timeout: 20000 }, async () => {
  const app = await atAnalysis(ANALYZING);
  await press(app, 'wizard-workflows-choice-analyze'); // the job rows show while the analysis asked for runs
  const cost = byTestId(wizardMarkup(app), 'wizard-cost');
  assert.equal(cost !== null, true, 'the analysis\'s job list (data-testid="wizard-cost")');
  const parts = H.findAll(cost.outer, (e) => 'data-part' in e.attrs).map((e) => e.attrs['data-part']);
  assert.deepEqual(parts, ['profile', 'projectMap'], 'the analyses that may cost, no ranking');
  assert.equal(parts.includes('ranking'), false, `job rows: ${parts.join(', ')}`);
  assert.equal(textOf(cost).includes('Refactor backlog'), false, `the job list: ${textOf(cost)}`);
});

// ---- the review -----------------------------------------------------------------------------------

test('#730 the review lists the findings, each with Create issue and Create issue and prioritize', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  const section = byTestId(wizardMarkup(app), 'wizard-review-findings');
  assert.equal(section?.attrs['data-state'], 'ready', 'data-testid="wizard-review-findings" with the report read');
  for (const [i, title] of [[0, 'Checkout does too much.'], [1, 'Refunds have no tests.']]) {
    assert.equal(textOf(findingRow(app, i)).includes(title), true, `finding ${i}: ${textOf(findingRow(app, i))}`);
    assert.equal(textOf(inRow(app, i, 'wizard-review-create-issue')), 'Create issue');
    assert.equal(textOf(inRow(app, i, 'wizard-review-create-issue-prioritize')), 'Create issue and prioritize');
  }
});

test('#730 the review has no refactor proposals to pick any more', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-refactors') === null, true, 'no wizard-review-refactors');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-refactor-pick') === null, true, 'no wizard-review-refactor-pick');
});

test('#730 the review\'s Create issue files the finding\'s issue and shows its link instead of the buttons', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await pressIn(app, 0, 'wizard-review-create-issue');
  assert.deepEqual(createCalls(app), [[PID, 'r1', 0, false]]);
  const link = inRow(app, 0, 'wizard-review-finding-issue');
  assert.equal(link?.name, 'a', 'a link to the issue');
  assert.equal(link.attrs.href, URL_OF(71));
  assert.equal(inRow(app, 0, 'wizard-review-create-issue') === null, true, 'no Create issue any more');
  assert.equal(inRow(app, 0, 'wizard-review-create-issue-prioritize') === null, true, 'no Create issue and prioritize any more');
  assert.equal(inRow(app, 1, 'wizard-review-create-issue') !== null, true, 'the other finding keeps its buttons');
});

test('#730 the review\'s Create issue and prioritize files and prioritizes the finding, then shows its link', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await pressIn(app, 1, 'wizard-review-create-issue-prioritize');
  assert.deepEqual(createCalls(app), [[PID, 'r1', 1, true]]);
  assert.equal(inRow(app, 1, 'wizard-review-finding-issue')?.attrs.href, URL_OF(71));
  assert.equal(inRow(app, 1, 'wizard-review-create-issue-prioritize') === null, true, 'no buttons once filed');
});

test('#730 Finish sends nothing to the roadmap and files no issue on its own', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(20);
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(app.callsTo('addRefactorToRoadmap').length, 0, 'no refactor sent to the roadmap');
  assert.equal(app.callsTo('createFindingIssue').length, 0, 'no issue filed without a click');
});

test('#730 "Open the city" lands on the project\'s City tab', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  app.sandbox.ProjectCityModes = undefined;
  app.sandbox.ProjectCityPanels = undefined;
  await Promise.race([press(app, 'wizard-open-city'), app.settle(60)]);
  await app.settle(30);
  assert.equal(String(app.state().view), 'project');
  assert.equal(String(app.state().pv?.id), PID);
  assert.equal(String(app.state().pv?.tab), 'city', 'on its City tab');
});
