// #642 (first-project onboarding, step 5 of docs/work/first-project-onboarding/plan.md; spec R10, R11):
// the review, the last step of the new-project wizard (fronts/build/views/projects/project-wizard.js).
// Acceptance tests, written before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js),
// with the contract of project-wizard.test.js's header (#641) and these additions:
// - the review step: data-testid="wizard-review" holding three sections, each with
//   data-state="ready" (its analysis done, its data shown) or "pending" (its analysis still running or not
//   run, with words saying so, never blank):
//   - data-testid="wizard-review-city": the project map (api.architectureCity(projectId));
//   - data-testid="wizard-review-backlog": the project's backlog (api.getBacklog(projectId) → { issues });
//   - data-testid="wizard-review-findings" (#730, in place of the refactor backlog): the findings of the
//     Oracle's report (api.architectureReport(projectId)), one data-testid="wizard-review-finding"
//     data-finding="<index>" per finding; filing one as an issue is project-wizard-findings-730.test.js's
//     (R11: nothing is filed or enters the roadmap without a click);
//   - the idea field id="wizard-review-idea" (data-testid="wizard-review-idea"), read from its input / change;
// - Finish: data-testid="wizard-finish", never disabled, never waits for an analysis still running; it
//   files no issue and sends nothing to the roadmap (no api.createFindingIssue / addRefactorToRoadmap /
//   saveRoadmap), nothing started: no startRoadmap / startRun / runPipeline / analyzeOnboarding (#100: the one call is the
//   card Analyze with AI's, pressed on step 3 to reach an analysed review; Next and Finish make none), keeps a non-blank idea as a local item of the project's backlog (an Inbox idea:
//   api.createDiscoveryCard(projectId, title, …) with the typed text), closes the wizard and opens the
//   project's page (state.view 'project', state.pv.id the project).
// The visual layout (2026-11) added, tested at the end of this file:
// - the title row: <header class="wizard-review-top"> holding h2#project-wizard-title, the project's name (the
//   dialog's aria-labelledby), and where it comes from (the repository, the clone's folder); the project block
//   (wizard-review-project) no longer repeats them;
// - the idea is a one-line textarea (rows="1") whose help is its placeholder (kept in an sr-only span too);
// - #40 in the review: one short wizard-default-awaiting-acceptance ("<name> only runs once accepted.") with
//   wizard-default-review-accept, inside the project block's Workflows well, in place of the long notice above the grid.
// Harness equivalents as in project-wizard-review-641.test.js (clickRendered, typed values through the
// field's and the root's listeners).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
// the profile the analysis found: step 3's rows show with it (#100: Next waits for them)
const PROFILE_JOB = { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: PROFILE_JOB, projectMap: { status: 'running' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: PROFILE_JOB, projectMap: { status: 'done' } }), cli: CLI_OK };

const FINDINGS = [
  { kind: 'hotspot', severity: 'high', title: 'Split checkout.js', files: [{ path: 'src/checkout.js' }], evidence: 'git', status: 'open' },
  { kind: 'tests', severity: 'medium', title: 'Tests for refund.py', files: [{ path: 'payments/refund.py' }], evidence: 'git', status: 'open' },
];
const REPORT_VIEW = {
  report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: null, simulated: true, report: { summary: 'A shop.', areas: [], findings: FINDINGS.map(({ status, ...f }) => f) } },
  previousId: null, gone: [], runsSince: 0, findings: FINDINGS,
};
const FACTS = {
  state: 'ok',
  exclude: [],
  model: {
    files: [
      { file: 'src/checkout.js', lines: 900, commits: 40, complexity: 30, quadrant: 'Danger Zone', score: 82, language: 'js' },
      { file: 'payments/refund.py', lines: 300, commits: 25, complexity: 4, quadrant: 'Cowboy Code', score: 41, language: 'py' },
    ],
    danger_zone: [{ file: 'src/checkout.js', score: 82 }],
    complexity: { metric: 'cyclomatic', tool: 'test' },
  },
};
const CITY = { state: 'ok', model: { grouping: 'folders', districts: [{ id: 'src', name: 'src', buildings: [{ file: 'src/checkout.js' }] }] }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null };
const BACKLOG = { issues: [{ number: 12, title: 'Login fails on Safari', state: 'open', labels: [] }] };

const clone = (x) => JSON.parse(JSON.stringify(x));
const never = () => new Promise(() => {});
const RUN_STARTS = ['startRoadmap', 'startRun', 'runPipeline', 'runSeed'];

// pending: the analyses' reads never answer (an analysis still running)
function page({ pending = false, api = {} } = {}) {
  const read = (value) => (pending ? never : async () => clone(value));
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: pending ? never : async () => clone(ANALYZED),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: read(CITY),
      architectureFacts: read(FACTS),
      architectureReport: read(REPORT_VIEW),
      refactorProposals: async () => [],
      getBacklog: read(BACKLOG),
      createFindingIssue: async () => ({ filed: { issue: 1, issueUrl: 'https://github.com/o/new/issues/1', stage: null, waiting: false } }),
      addRefactorToRoadmap: async () => ({ proposal: {}, stage: 1, waiting: true }),
      createDiscoveryCard: async (projectId, title, text) => ({ id: 'card-1', projectId, title, text, type: 'idea', column: 'inbox' }),
      ...api,
    },
  });
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
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const section = (app, id) => byTestId(wizardMarkup(app), id);
const findingRow = (app, index) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-review-finding' && e.attrs['data-finding'] === String(index));

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

// Fires `types` on a fake element (its own handlers, then the wizard root's delegated ones)
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

async function atAnalysis(opts) {
  const app = page(opts);
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
  return app;
}

// The review with every analysis done: asked for with the card Analyze with AI (#100: Next starts none and
// waits for the workflows)
async function reviewDone(opts) {
  const app = await atAnalysis(opts);
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  await app.settle(20);
  return app;
}

// The review with the project map still running
async function reviewRunning(opts) {
  const app = await atAnalysis({ pending: true, ...opts });
  await press(app, 'wizard-workflows-choice-analyze'); // #725: the analysis starts from the workflows column
  await emit(app, ANALYZING);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  await app.settle(10);
  return app;
}

// Finish, without waiting for more than a few ticks for what it does
async function finish(app) {
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(20);
}

const wizardClosed = (app) => H.findEl(wizardMarkup(app), (e) => 'data-step' in e.attrs) === null;
const runStarts = (app) => RUN_STARTS.reduce((n, name) => n + app.callsTo(name).length, 0);

// ---- what the review shows -------------------------------------------------------------------------

test('#642 with the analyses done, the review shows the city, the backlog, and each finding of the Oracle\'s report (#730)', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  assert.equal(section(app, 'wizard-review') === null, false, 'data-testid="wizard-review"');
  assert.equal(section(app, 'wizard-review-city')?.attrs['data-state'], 'ready', 'the city is shown');
  const backlog = section(app, 'wizard-review-backlog');
  assert.equal(backlog?.attrs['data-state'], 'ready', 'the backlog is shown');
  assert.equal(textOf(backlog).includes('Login fails on Safari'), true, `the backlog's issue: ${textOf(backlog)}`);
  assert.equal(section(app, 'wizard-review-findings')?.attrs['data-state'], 'ready', 'the findings are shown');
  assert.ok(!section(app, 'wizard-review-refactors'), 'no refactor backlog since #730');
  const first = textOf(findingRow(app, 0));
  assert.equal(first.includes('Split checkout.js'), true, `the first finding: ${first}`);
  const second = textOf(findingRow(app, 1));
  assert.equal(second.includes('Tests for refund.py'), true, `the second finding: ${second}`);
});

test('#642 with the analyses still running, the review shows them pending, and Finish closes the wizard on the project page without waiting', { timeout: 20000 }, async () => {
  const app = await reviewRunning();
  const city = section(app, 'wizard-review-city');
  assert.equal(city?.attrs['data-state'], 'pending', 'the city waits for the project map');
  assert.equal(textOf(city).length > 0, true, 'the pending city says so in words');
  const findings = section(app, 'wizard-review-findings');
  assert.equal(findings?.attrs['data-state'], 'pending', 'the findings wait for the project map');
  assert.equal(textOf(findings).length > 0, true, 'the pending findings say so in words');
  const done = byTestId(wizardMarkup(app), 'wizard-finish');
  assert.equal(done === null, false, 'data-testid="wizard-finish"');
  assert.equal('disabled' in done.attrs, false, 'Finish is enabled while the analyses run');
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed although the analyses never answered');
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
});

// ---- Finish files nothing on its own (#730) --------------------------------------------------------

test('#642 Finish files no issue, sends nothing to the roadmap and starts nothing', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  // #100: the analysis was asked for once, by the card Analyze with AI; Next started none
  assert.equal(app.callsTo('analyzeOnboarding').length, 1, 'one analysis, asked by the card; none by Next');
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(app.callsTo('createFindingIssue').length, 0, 'no issue filed without a click');
  assert.equal(app.callsTo('addRefactorToRoadmap').length, 0, 'no refactor sent');
  assert.equal(app.callsTo('saveRoadmap').length, 0, 'no roadmap edit');
  assert.equal(runStarts(app), 0, 'no roadmap, run or pipeline started');
  assert.equal(app.callsTo('analyzeOnboarding').length, 1, 'no analysis started by Finish');
  assert.equal(app.callsTo('retryOnboarding').length, 0, 'no analysis run again');
});

// ---- the idea --------------------------------------------------------------------------------------

test('#642 the idea typed in the review is kept as a local item of the project\'s backlog at Finish', { timeout: 20000 }, async () => {
  const IDEA = 'Let customers save a cart for later';
  const app = await reviewDone();
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-idea') === null, false, 'data-testid="wizard-review-idea"');
  await typeInto(app, '#wizard-review-idea', IDEA);
  await finish(app);
  const calls = app.callsTo('createDiscoveryCard');
  assert.equal(calls.length, 1, 'one idea kept');
  assert.equal(String(calls[0][0]), PID, 'in the new project');
  assert.equal(calls[0].slice(1, 3).some((a) => typeof a === 'string' && a.includes(IDEA)), true, 'with the typed text');
  assert.equal(runStarts(app), 0, 'nothing started');
});

test('#642 a blank idea adds nothing to the backlog', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await typeInto(app, '#wizard-review-idea', '   ');
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(app.callsTo('createDiscoveryCard').length, 0, 'no idea kept');
});

// ---- a backlog never read before (a project just imported has no cache) -----------------------------

test('#642 a backlog never read before is synced once, and the synced issues fill the review\'s backlog', { timeout: 20000 }, async () => {
  const app = await reviewDone({ api: { getBacklog: async () => null, syncBacklog: async () => clone(BACKLOG) } });
  assert.deepEqual(app.callsTo('syncBacklog').map((args) => String(args[0])), [PID], 'one sync of the new project');
  const backlog = section(app, 'wizard-review-backlog');
  assert.equal(backlog?.attrs['data-state'], 'ready', 'the backlog is shown');
  assert.equal(textOf(backlog).includes('Login fails on Safari'), true, `the synced issue: ${textOf(backlog)}`);
});

test('#642 a backlog sync that fails (no repository) shows the empty backlog, and Finish still works', { timeout: 20000 }, async () => {
  const app = await reviewDone({ api: { getBacklog: async () => null, syncBacklog: async () => { throw new Error('no repository'); } } });
  const backlog = section(app, 'wizard-review-backlog');
  assert.equal(backlog?.attrs['data-state'], 'ready', 'the backlog section stops waiting');
  assert.equal(textOf(backlog).includes('No open issues.'), true, `the empty backlog's words: ${textOf(backlog)}`);
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(String(app.state().view), 'project', 'the project page is open');
});

test('#642 a backlog already read is not synced again by the review', { timeout: 20000 }, async () => {
  const app = await reviewDone({ api: { syncBacklog: async () => clone(BACKLOG) } });
  assert.equal(app.callsTo('syncBacklog').length, 0, 'no sync');
  assert.equal(textOf(section(app, 'wizard-review-backlog')).includes('Login fails on Safari'), true, 'the cached issue');
});

// ---- the visual layout: the title row, the idea on one line, the short acceptance notice ------------

const classesOf = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
const reviewTop = (app) => H.findEl(section(app, 'wizard-review')?.outer || '', (e) => e.name === 'header' && classesOf(e).includes('wizard-review-top'));
const projectBlock = (app) => section(app, 'wizard-review-project');

test('visual layout: the review\'s title row is the project\'s name (h2#project-wizard-title in wizard-review-top), where it comes from beside it', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  const top = reviewTop(app);
  assert.equal(top === null, false, '<header class="wizard-review-top"> in the review');
  const titles = H.findAll(wizardMarkup(app), (e) => e.attrs.id === 'project-wizard-title');
  assert.equal(titles.length, 1, 'one #project-wizard-title in the wizard (the dialog\'s aria-labelledby)');
  const title = H.findEl(top.outer, (e) => e.attrs.id === 'project-wizard-title');
  assert.equal(title?.name, 'h2', 'the title is the row\'s h2');
  assert.equal(textOf(title), NAME, 'the title is the project\'s name, nothing else');
  const where = H.visibleText(top.inner);
  assert.equal(where.includes(REPO), true, `the repository beside the name: ${where}`);
  assert.equal(where.includes(PROJECT.folder), true, `the clone's folder beside the name: ${where}`);
  // the title row comes first in the review, before the two columns
  const review = section(app, 'wizard-review').inner;
  assert.equal(review.indexOf('wizard-review-top') < review.indexOf('wizard-review-grid'), true, 'the title row leads the step');
});

test('visual layout: the project block no longer repeats the name nor the repository, and still holds its kind and its workflows', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  const block = projectBlock(app);
  assert.equal(block === null, false, 'data-testid="wizard-review-project"');
  assert.equal(textOf(block).includes(NAME), false, `no name in the project block: ${textOf(block)}`);
  assert.equal(textOf(block).includes(REPO), false, 'no repository URL in the project block');
  assert.equal(byTestId(block.outer, 'wizard-kind-select') === null, false, 'the kind\'s select');
  assert.equal(H.findAll(block.outer, (e) => e.attrs['data-testid'] === 'wizard-kind-tile').length > 0, true, 'the kind\'s tiles');
  for (const flow of ['feature', 'fix', 'release']) assert.equal(textOf(block).includes(flow), true, `the workflow ${flow}: ${textOf(block)}`);
});

test('visual layout: the idea is a one-line textarea with its help as placeholder, and keeps what was typed through a re-render', { timeout: 20000 }, async () => {
  const HELP = 'Kept in the Inbox as an idea when you finish.';
  const app = await reviewDone();
  const idea = () => byTestId(wizardMarkup(app), 'wizard-review-idea');
  assert.equal(idea()?.name, 'textarea', 'the idea is a textarea');
  assert.equal(idea().attrs.id, 'wizard-review-idea');
  assert.equal(idea().attrs.rows, '1', 'one line');
  assert.equal(idea().attrs.placeholder, HELP, 'the help is the placeholder');
  const label = H.findEl(section(app, 'wizard-review').outer, (e) => e.name === 'label' && classesOf(e).includes('wizard-review-idea'));
  assert.equal(label === null, false, 'label.wizard-review-idea');
  assert.equal(byTestId(label.outer, 'wizard-review-idea') === null, false, 'the textarea is in its label');
  assert.match(H.visibleText(label.inner), /Note an idea/);
  const help = H.findEl(label.outer, (e) => e.name === 'span' && classesOf(e).includes('sr-only'));
  assert.equal(textOf(help), HELP, 'the help stays for assistive tech (sr-only)');
  await typeInto(app, '#wizard-review-idea', 'Save a cart for later');
  await emit(app, ANALYZED);
  assert.equal(idea().inner.includes('Save a cart for later'), true, 'the typed idea is drawn again in the textarea');
});

// #40: a repository whose own default workflow is refused until accepted
const REPO_WF = 'team-flow';
const awaiting = (accepted) => ({
  listProjects: async () => [{ ...clone(PROJECT), defaultWorkflow: REPO_WF }],
  projectManifest: async () => ({ workflows: [{ name: REPO_WF, file: `workflows/${REPO_WF}.yaml`, category: 'build' }], default: REPO_WF, kinds: {} }),
  listWorkflows: async (opts = {}) => (opts?.projectId === PID
    ? [{ file: `${REPO_WF}.yaml`, name: REPO_WF, origin: 'repository', projectId: PID, commit: 'c0ffee1', changedCommit: accepted ? null : 'c0ffee1', accepted, acceptedCommit: accepted ? 'c0ffee1' : null, trusted: accepted, steps: [], inputs: {}, category: 'build' }]
    : []),
});
const notices = (html) => H.findAll(html, (e) => e.attrs['data-testid'] === 'wizard-default-awaiting-acceptance');

test('visual layout: a default awaiting acceptance is said once on the review, short, inside the project block with Review and accept', { timeout: 20000 }, async () => {
  const app = await reviewDone({ api: awaiting(false) });
  const all = notices(section(app, 'wizard-review').outer);
  assert.equal(all.length, 1, 'one wizard-default-awaiting-acceptance on the review');
  const inBlock = notices(projectBlock(app).outer);
  assert.equal(inBlock.length, 1, 'inside the project block (wizard-review-project)');
  assert.equal(textOf(inBlock[0]).includes(`${REPO_WF} only runs once accepted.`), true, `the short sentence: ${textOf(inBlock[0])}`);
  assert.equal(textOf(inBlock[0]).includes('comes from the repository'), false, 'not the long sentence');
  const accept = byTestId(inBlock[0].outer, 'wizard-default-review-accept');
  assert.equal(accept?.name, 'button', 'Review and accept');
  assert.equal(accept.attrs['data-act'], 'review-accept');
  assert.equal(accept.attrs['data-file'], `${REPO_WF}.yaml`, 'on the workflow\'s file');
  assert.equal(textOf(accept), 'Review and accept');
});

test('visual layout: an accepted default says nothing on the review', { timeout: 20000 }, async () => {
  const app = await reviewDone({ api: awaiting(true) });
  assert.equal(notices(section(app, 'wizard-review').outer).length, 0);
});
