// #845: the wizard Review's Backlog card when the repository has Issues turned off. The engine's sync
// (backlog.js syncBacklog, through window.api.syncBacklog) resolves with { issues: [], issuesDisabled: true, repo }:
// the card says "Issues are turned off in this repository", with no red error, no Retry, and a link to the
// repository's settings; Finish still closes the wizard. A network failure keeps its reason and Retry (#781).
// On the real page (project-wizard-helpers, as project-wizard-backlog-failed-781.test.js). Primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { PID, REPO, byTestId, emit, press, wizardMarkup } = W;
const OFF_TEXT = 'Issues are turned off in this repository';
const NETWORK = 'gh issue list failed: error connecting to api.github.com';
const SETTINGS = 'github.com/o/new/settings';

async function atReview(api) {
  const app = await W.atAnalysis({ api: { getBacklog: async () => null, ...api } });
  await emit(app, W.ANALYZED);
  await press(app, 'wizard-next');
  await app.settle(20);
  return app;
}

const section = (app) => byTestId(wizardMarkup(app), 'wizard-review-backlog');
const sectionText = (app) => H.visibleText(section(app)?.inner || '');
const retry = (app) => byTestId(wizardMarkup(app), 'wizard-review-backlog-retry');
const disabledSync = { syncBacklog: async () => ({ projectId: PID, platform: 'github', repo: REPO, issues: [], epics: [], issuesDisabled: true }) };
const wizardClosed = (app) => H.findEl(wizardMarkup(app), (e) => 'data-step' in e.attrs) === null;

test('#845 Issues turned off: the Review\'s Backlog card says so, without the raw error', { timeout: 20000 }, async () => {
  const app = await atReview(disabledSync);
  assert.equal(sectionText(app).includes(OFF_TEXT), true, sectionText(app));
  assert.equal(sectionText(app).includes('disabled issues'), false, sectionText(app));
  assert.equal(sectionText(app).includes('No open issues.'), false, sectionText(app));
});

test('#845 Issues turned off: no failed state, no alert, no Retry', { timeout: 20000 }, async () => {
  const app = await atReview(disabledSync);
  const markup = wizardMarkup(app);
  assert.equal(retry(app), null, 'no Retry');
  assert.notEqual(section(app)?.attrs['data-state'], 'failed');
  assert.notEqual(byTestId(markup, 'wizard-review-backlog-activity')?.attrs['data-state'], 'failed');
  assert.equal(H.findAll(section(app)?.outer || '', (e) => e.attrs.role === 'alert').length, 0, 'no alert');
});

test('#845 Issues turned off: the card links to the repository\'s settings', { timeout: 20000 }, async () => {
  const app = await atReview(disabledSync);
  const link = H.findEl(section(app)?.outer || '', (e) => e.name === 'a' && String(e.attrs.href || '').includes(SETTINGS));
  assert.equal(link === null, false, `a link to ${SETTINGS} in: ${section(app)?.outer || ''}`);
});

test('#845 Issues turned off, read from the cache (getBacklog): the same card', { timeout: 20000 }, async () => {
  const app = await atReview({ getBacklog: async () => ({ projectId: PID, platform: 'github', repo: REPO, issues: [], epics: [], issuesDisabled: true }) });
  assert.equal(sectionText(app).includes(OFF_TEXT), true, sectionText(app));
  assert.equal(retry(app), null);
});

test('#845 Issues turned off: Finish still closes the wizard on the project', { timeout: 20000 }, async () => {
  const app = await atReview(disabledSync);
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(20);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(String(app.state().view), 'project');
  assert.equal(String(app.state().pv?.id), PID);
});

test('#845 a network failure still shows its reason and Retry', { timeout: 20000 }, async () => {
  const app = await atReview({ syncBacklog: async () => { throw new Error(NETWORK); } });
  assert.equal(sectionText(app).includes('error connecting to api.github.com'), true, sectionText(app));
  assert.equal(sectionText(app).includes(OFF_TEXT), false);
  assert.equal(retry(app) === null, false, 'its Retry');
  assert.equal(section(app)?.attrs['data-state'], 'failed');
});
