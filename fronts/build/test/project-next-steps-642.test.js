// #642 (first-project onboarding, step 5 of docs/work/first-project-onboarding/plan.md; spec R11): the
// "Next steps" card on the project's page (fronts/analyser/views/project/project.js) after the new-project
// wizard's Finish (fronts/build/views/projects/project-wizard.js). Acceptance tests, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js), with the contract of
// project-wizard-review-642.test.js's header (the review, data-testid="wizard-finish") and these additions:
// - after Finish the project's page (state.view 'project', its Overview) shows data-testid="project-next-steps",
//   rendered only while it is shown (no hidden copy: neither a `hidden` attribute nor the `hidden` class);
// - one entry per card of R11 for this phase, data-testid="next-step-<id>": "refactors" (add chosen
//   refactors to the roadmap), "idea" (capture the first idea), "cadence" (the refactor cadence); since
//   #669 also "release-ci" and "screenshots", shown disabled (later phases, mock-7);
// - each entry leads to its screen through its button (or the entry itself when it is the button):
//   refactors → the Roadmap (state.view 'roadmap'), cadence → the project's Refactor tab
//   (state.pv.tab 'refactor'), idea → the Inbox (state.view 'inbox');
// - data-testid="next-steps-dismiss" hides the card, and it stays hidden when the page is opened again;
// - a project that did not go through the wizard (opened with openProjectView, api.onboardingStatus
//   answering null for it) shows no card.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing, pageMarkup } = require('@multiagent/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const OLD = 'p-old';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECTS = [
  { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true },
  { id: OLD, name: 'Old one', repo: 'https://github.com/o/old.git', folder: 'C:/ws/repos/old', exists: true },
];
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }), cli: CLI_OK };
const PROPOSALS = [{ id: 'rf-1', title: 'Split checkout.js', target: 'src/checkout.js', targetFiles: ['src/checkout.js'], files: ['src/checkout.js'], rank: 1 }];
const FACTS = { state: 'ok', exclude: [], model: { files: [{ file: 'src/checkout.js', quadrant: 'Danger Zone', score: 82, complexity: 30, commits: 40, lines: 900 }], danger_zone: [{ file: 'src/checkout.js', score: 82 }] } };

const clone = (x) => JSON.parse(JSON.stringify(x));

function page() {
  return loadApp({
    api: {
      listProjects: async () => clone(PROJECTS),
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async (id) => (id === PID ? clone(ANALYZED) : null),
      analyzeOnboarding: async () => clone(ANALYZED),
      retryOnboarding: async () => clone(CLONING),
      architectureEstimate: async () => ({ estimate: null }),
      architectureFacts: async () => clone(FACTS),
      refactorProposals: async () => clone(PROPOSALS),
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
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

// The app after the wizard's Finish on an analyzed project
async function finished() {
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
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review', 'the wizard reached the review');
  await app.settle(10);
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
  return app;
}

async function openProject(app, id) {
  app.run(`openProjectView(${JSON.stringify(id)})`);
  await app.settle(30);
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
// the card as rendered now (the views' static markup left out), or null
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entryIds = (app) => H.findAll(card(app)?.outer || '', (e) => /^next-step-/.test(e.attrs['data-testid'] || '')).map((e) => e.attrs['data-testid'].slice('next-step-'.length));

async function clickIn(app, el) {
  const button = el.name === 'button' || el.name === 'a' ? el : H.findEl(el.inner, (e) => e.name === 'button' || e.name === 'a') || el;
  await clickRendered(app, button);
  await app.settle(20);
}

// ---- the card ---------------------------------------------------------------------------------------

// #669: the card follows mock-7, so the later phases' release CI and screenshots entries are shown too
// (disabled, project-wizard-mockups-669.test.js).
test('#642 after Finish the project page shows the Next steps card with the refactors, idea and cadence entries', { timeout: 20000 }, async () => {
  const app = await finished();
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(card(app) === null, false, 'data-testid="project-next-steps" is shown');
  assert.deepEqual(entryIds(app).sort(), ['cadence', 'idea', 'refactors', 'release-ci', 'screenshots']);
});

for (const [id, where, expected, want] of [
  ['refactors', 'the Roadmap', (s) => ({ view: String(s.view) }), { view: 'roadmap' }],
  // #730: no Refactor tab; the cadence entry leads to the Health tab (the findings)
  ['cadence', 'the project\'s Health tab', (s) => ({ view: String(s.view), project: String(s.pv?.id), tab: String(s.pv?.tab) }), { view: 'project', project: PID, tab: 'health' }],
  ['idea', 'the Inbox', (s) => ({ view: String(s.view) }), { view: 'inbox' }],
]) {
  test(`#642 the "${id}" entry of Next steps leads to ${where}`, { timeout: 20000 }, async () => {
    const app = await finished();
    const entry = byTestId(card(app)?.outer || '', `next-step-${id}`);
    assert.equal(entry === null, false, `data-testid="next-step-${id}" in the card`);
    await clickIn(app, entry);
    assert.deepEqual(expected(app.state()), want);
  });
}

test('#642 Dismiss hides the Next steps card, and it stays hidden when the project page is opened again', { timeout: 20000 }, async () => {
  const app = await finished();
  const dismiss = byTestId(card(app)?.outer || '', 'next-steps-dismiss');
  assert.equal(dismiss === null, false, 'data-testid="next-steps-dismiss" in the card');
  await clickRendered(app, dismiss);
  await app.settle(20);
  assert.equal(card(app) === null, true, 'the card is gone');
  await openProject(app, OLD);
  await openProject(app, PID);
  assert.equal(String(app.state().pv?.id), PID);
  assert.equal(card(app) === null, true, 'still gone on the page opened again');
});

test('#642 a project that did not go through the wizard shows no Next steps card', { timeout: 20000 }, async () => {
  const app = await finished();
  assert.equal(card(app) === null, false, 'the new project shows the card');
  await openProject(app, OLD);
  assert.equal(String(app.state().pv?.id), OLD);
  assert.equal(card(app) === null, true, 'no card on the other project');
});
