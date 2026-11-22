// #744 acceptance, written before the code: the Next steps card on the project's page
// (fronts/analyser/views/project/project.js, shown while localStorage multiagent.nextSteps[<project>] is
// 'open'), on the real page (packages/ui-kit/test/renderer-app-harness.js) as project-next-steps-642.test.js.
//
// The contract assumed here (new seams of #744):
// - a first entry data-testid="next-step-po-issue" ("Create an issue with the PO") with its button
//   data-testid="next-step-po-issue-open" ("Open the PO"), which calls Actions.call('openPoIssue', <project id>)
//   (packages/ui-kit/actions.js; the Build front's backlog-po.js registers it);
// - the entry is done once an issue was filed through it for the project: the PO saves a marker in
//   localStorage multiagent.nextStepsPoIssue = { <projectId>: { issue, url } }; the entry then shows the
//   issue's link (data-testid="next-step-po-issue-link", href = url) and no "Open the PO" button;
// - the refactors entry (next-step-refactors) is left out when the project has no refactor proposal;
// - a disabled step button carries its reason: a non-empty `title` and a visible line
//   data-testid="next-step-reason" in its entry (or the entry is not shown at all).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const PROJECTS = [{ id: PID, name: 'Demo', repo: 'https://github.com/o/demo.git', folder: 'C:/ws/repos/demo', exists: true, workflows: [{ name: 'feature', category: 'feature' }] }];
const PROPOSALS = [{ id: 'rf-1', title: 'Split checkout.js', target: 'src/checkout.js', files: ['src/checkout.js'], rank: 1 }];
const ISSUE_URL = 'https://github.com/o/demo/issues/812';
const clone = (x) => JSON.parse(JSON.stringify(x));

async function projectPage({ proposals = PROPOSALS, storage = {} } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => clone(PROJECTS),
      onboardingStatus: async () => null,
      refactorProposals: async () => clone(proposals),
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }), ...storage },
  });
  await app.boot();
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return app;
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entries = (app) => H.findAll(card(app)?.outer || '', (e) => e.name === 'li' && /^next-step-[\w-]+$/.test(e.attrs['data-testid'] || ''));
const entryIds = (app) => entries(app).map((e) => e.attrs['data-testid'].slice('next-step-'.length));
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

test('#744 "Create an issue with the PO" is the first entry of the Next steps card', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(card(app) === null, false, 'the card is shown');
  assert.equal(entryIds(app)[0], 'po-issue');
});

test('#744 "Open the PO" opens the PO chat in issue mode on this project (Actions openPoIssue)', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const calls = [];
  app.sandbox.Actions.register('openPoIssue', (...args) => { calls.push(args.map(String)); });
  const button = byTestId(card(app)?.outer || '', 'next-step-po-issue-open');
  assert.equal(button === null, false, 'data-testid="next-step-po-issue-open" in the card');
  await clickRendered(app, button);
  await app.settle(10);
  assert.deepEqual(calls, [[PID]]);
});

test('#744 once an issue was filed through it, the PO entry shows the issue\'s link instead of "Open the PO"', { timeout: 30000 }, async () => {
  const app = await projectPage({ storage: { 'craftorio.nextStepsPoIssue': JSON.stringify({ [PID]: { issue: 812, url: ISSUE_URL } }) } });
  const entry = byTestId(card(app)?.outer || '', 'next-step-po-issue');
  assert.equal(entry === null, false, 'data-testid="next-step-po-issue" in the card');
  const link = byTestId(entry.outer, 'next-step-po-issue-link');
  assert.equal(link?.attrs.href ?? null, ISSUE_URL);
  assert.equal(byTestId(entry.outer, 'next-step-po-issue-open') === null, true, 'no "Open the PO" any more');
});

test('#744 the refactors entry is left out when the project has no refactor proposal', { timeout: 30000 }, async () => {
  const app = await projectPage({ proposals: [] });
  assert.equal(card(app) === null, false, 'the card is shown');
  assert.equal(entryIds(app).includes('refactors'), false, `entries: ${entryIds(app).join(', ')}`);
});

test('#744 a disabled step button carries its reason: a tooltip and a visible line', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const disabled = entries(app).map((entry) => ({ entry, button: H.findEl(entry.inner, (e) => e.name === 'button' && 'disabled' in e.attrs) })).filter((x) => x.button);
  for (const { entry, button } of disabled) {
    const id = entry.attrs['data-testid'];
    assert.equal(String(button.attrs.title || '').trim() !== '', true, `${id}: the disabled button has a title`);
    const reason = byTestId(entry.inner, 'next-step-reason');
    assert.equal(H.visibleText(reason?.inner || '') !== '', true, `${id}: a visible reason line`);
  }
});
