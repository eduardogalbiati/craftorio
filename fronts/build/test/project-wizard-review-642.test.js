// #642 (first-project onboarding, step 5 of docs/work/first-project-onboarding/plan.md; spec R10, R11):
// the review, the last step of the new-project wizard (fronts/build/views/projects/project-wizard.js).
// Acceptance tests, written before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js),
// with the contract of project-wizard.test.js's header (#641) and these additions:
// - the review step: data-testid="wizard-review" holding three sections, each with
//   data-state="ready" (its analysis done, its data shown) or "pending" (its analysis still running or not
//   run, with words saying so, never blank):
//   - data-testid="wizard-review-city": the project map (api.architectureCity(projectId));
//   - data-testid="wizard-review-backlog": the project's backlog (api.getBacklog(projectId) → { issues });
//   - data-testid="wizard-review-refactors": the refactor backlog (api.refactorProposals(projectId)), one
//     data-testid="wizard-review-refactor" data-refactor="<proposal id>" per proposal showing its file's
//     score (0-100) and quadrant as on the Facts view (api.architectureFacts(projectId) → { model: { files:
//     [{ file, quadrant, score }] } }), and a checkbox data-testid="wizard-review-refactor-pick"
//     data-refactor="<proposal id>", unchecked at first (R11: nothing enters the roadmap without a click),
//     chosen by its change event (e.target.checked);
//   - the idea field id="wizard-review-idea" (data-testid="wizard-review-idea"), read from its input / change;
// - Finish: data-testid="wizard-finish", never disabled, never waits for an analysis still running; it
//   sends each chosen refactor to the roadmap as a planned item (api.addRefactorToRoadmap(projectId,
//   proposalId), never with runNow, nothing started: no startRoadmap / startRun / runPipeline /
//   analyzeOnboarding), keeps a non-blank idea as a local item of the project's backlog (an Inbox idea:
//   api.createDiscoveryCard(projectId, title, …) with the typed text), closes the wizard and opens the
//   project's page (state.view 'project', state.pv.id the project).
// Harness equivalents as in project-wizard-review-641.test.js (clickRendered, typed values through the
// field's and the root's listeners).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@multiagent/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'running' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }), cli: CLI_OK };

const PROPOSALS = [
  { id: 'rf-1', title: 'Split checkout.js', target: 'src/checkout.js', targetFiles: ['src/checkout.js'], files: ['src/checkout.js'], rank: 1 },
  { id: 'rf-2', title: 'Tests for refund.py', target: 'payments/refund.py', targetFiles: ['payments/refund.py'], files: ['payments/refund.py'], rank: 2 },
];
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
      refactorProposals: read(PROPOSALS),
      getBacklog: read(BACKLOG),
      addRefactorToRoadmap: async (projectId, id) => ({ proposal: { ...PROPOSALS.find((p) => p.id === id), roadmapStatus: 'planned' }, stage: 1, waiting: true }),
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
const refactorRow = (app, id) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-review-refactor' && e.attrs['data-refactor'] === id);

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

// Ticks the refactor's checkbox: a change event with e.target.checked = true
let picks = 0;
async function pick(app, id) {
  const box = H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-review-refactor-pick' && e.attrs['data-refactor'] === id);
  assert.ok(box, `a data-testid="wizard-review-refactor-pick" data-refactor="${id}" checkbox`);
  const el = app.el(box.attrs.id ? `#${box.attrs.id}` : `[data-test-pick-${(picks += 1)}]`);
  for (const [k, v] of Object.entries(box.attrs)) {
    if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else if (k === 'class') el.className = v;
    else if (k !== 'id') el.attrs[k] = v;
  }
  el.tagName = 'INPUT';
  el.type = 'checkbox';
  el.checked = true;
  await fire(app, el, ['change', 'input']);
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

// The review with every analysis done
async function reviewDone(opts) {
  const app = await atAnalysis(opts);
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  await app.settle(20);
  return app;
}

// The review with the project map still running and the ranking not started
async function reviewRunning(opts) {
  const app = await atAnalysis({ pending: true, ...opts });
  await press(app, 'wizard-analyze');
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

test('#642 with the analyses done, the review shows the city, the backlog, and each refactor with its file\'s score and quadrant', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  assert.equal(section(app, 'wizard-review') === null, false, 'data-testid="wizard-review"');
  assert.equal(section(app, 'wizard-review-city')?.attrs['data-state'], 'ready', 'the city is shown');
  const backlog = section(app, 'wizard-review-backlog');
  assert.equal(backlog?.attrs['data-state'], 'ready', 'the backlog is shown');
  assert.equal(textOf(backlog).includes('Login fails on Safari'), true, `the backlog's issue: ${textOf(backlog)}`);
  assert.equal(section(app, 'wizard-review-refactors')?.attrs['data-state'], 'ready', 'the refactor backlog is shown');
  const first = textOf(refactorRow(app, 'rf-1'));
  assert.equal(first.includes('82'), true, `rf-1 shows its file's score: ${first}`);
  assert.equal(first.includes('Danger Zone'), true, `rf-1 shows its file's quadrant: ${first}`);
  const second = textOf(refactorRow(app, 'rf-2'));
  assert.equal(second.includes('41'), true, `rf-2 shows its file's score: ${second}`);
  assert.equal(second.includes('Cowboy Code'), true, `rf-2 shows its file's quadrant: ${second}`);
});

test('#642 with the analyses still running, the review shows them pending, and Finish closes the wizard on the project page without waiting', { timeout: 20000 }, async () => {
  const app = await reviewRunning();
  const city = section(app, 'wizard-review-city');
  assert.equal(city?.attrs['data-state'], 'pending', 'the city waits for the project map');
  assert.equal(textOf(city).length > 0, true, 'the pending city says so in words');
  const refactors = section(app, 'wizard-review-refactors');
  assert.equal(refactors?.attrs['data-state'], 'pending', 'the refactor backlog waits for the ranking');
  assert.equal(textOf(refactors).length > 0, true, 'the pending refactor backlog says so in words');
  const done = byTestId(wizardMarkup(app), 'wizard-finish');
  assert.equal(done === null, false, 'data-testid="wizard-finish"');
  assert.equal('disabled' in done.attrs, false, 'Finish is enabled while the analyses run');
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed although the analyses never answered');
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
});

// ---- the chosen refactors --------------------------------------------------------------------------

test('#642 Finish sends the chosen refactor to the roadmap as a planned item, not the unchosen one, and starts nothing', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await pick(app, 'rf-2');
  await finish(app);
  const calls = app.callsTo('addRefactorToRoadmap');
  assert.equal(calls.length, 1, 'one refactor sent to the roadmap');
  assert.equal(String(calls[0][0]), PID, 'on the new project');
  assert.equal(String(calls[0][1]), 'rf-2', 'the chosen one');
  assert.equal(calls[0][2]?.runNow === true, false, 'planned, never run now');
  assert.equal(runStarts(app), 0, 'no roadmap, run or pipeline started');
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'no analysis started');
});

test('#642 Finish with no refactor chosen sends nothing to the roadmap (none is chosen by default)', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  await finish(app);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(app.callsTo('addRefactorToRoadmap').length, 0, 'no refactor sent');
  assert.equal(app.callsTo('saveRoadmap').length, 0, 'no roadmap edit');
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
