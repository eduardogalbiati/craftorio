// #37 acceptance, written before the code: the onboarding review's (wizard step 4) Backlog card
// (fronts/build/views/projects/project-wizard-activity.js backlogBody) counts and lists only the open, non-archived
// issues, in the Backlog's default order (most recent first), its count saying they are open ("3 open issues" /
// "3 issues abertas"); with no open issue (even with closed or archived ones) it keeps "No open issues.".
// Unchanged: the Issues-turned-off state and the failed read's Retry. Driven on the real page as
// project-wizard-backlog-failed-781.test.js.
// #100: the analysed review is reached with step 3's card Analyze with AI, then Next (a done profile job carries its profile).
//
// The contract assumed here:
// - the review reads the backlog through api.getBacklog / api.syncBacklog: { issues: [{ number, title, state, labels, updatedAt }] };
// - closed = state 'closed' (any case), archived = closed with the `archived` label (packages/shared/backlog-archive.js);
// - the card is data-testid="wizard-review-backlog", its line data-testid="wizard-review-backlog-activity".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { byTestId, emit, wizardMarkup } = W;

// analysed: the profile job carries the profile it found (step 3's rows, #100)
const ANALYZED = { ...W.ANALYZED, jobs: { ...W.ANALYZED.jobs, profile: { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } } } };

const issue = (number, title, updatedAt, extra = {}) => ({ number, title, state: 'OPEN', labels: [], updatedAt, ...extra });
// the cache's order is deliberately not the most-recent-first order
const MIXED = [
  issue(1, 'Old open issue', '2026-01-01T10:00:00Z'),
  issue(2, 'Closed bug report', '2026-11-01T10:00:00Z', { state: 'CLOSED' }),
  issue(3, 'Newest open issue', '2026-11-20T10:00:00Z'),
  issue(4, 'Archived idea', '2026-11-21T10:00:00Z', { state: 'CLOSED', labels: [{ name: 'archived' }] }),
  issue(5, 'Middle open issue', '2026-06-01T10:00:00Z'),
  issue(6, 'Another closed one', '2026-10-01T10:00:00Z', { state: 'closed', labels: ['bug'] }),
];
const ONLY_CLOSED = [
  issue(2, 'Closed bug report', '2026-11-01T10:00:00Z', { state: 'CLOSED' }),
  issue(4, 'Archived idea', '2026-11-21T10:00:00Z', { state: 'CLOSED', labels: [{ name: 'archived' }] }),
];

async function atReview(issues, { lang = 'en' } = {}) {
  const data = { issues: JSON.parse(JSON.stringify(issues)) };
  const app = await W.atAnalysis({
    api: { getBacklog: async () => data, backlogProgress: async () => null },
    // called right after the wizard opens, before the steps are drawn
    record: (a) => { if (lang !== 'en') a.sandbox.I18n.setLanguage(lang); },
  });
  await W.defineWorkflows(app, 'analyze');
  await emit(app, ANALYZED);
  await W.toReview(app, 'analyze');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
  return app;
}

const card = (app) => byTestId(wizardMarkup(app), 'wizard-review-backlog');
const cardText = (app) => H.visibleText(card(app)?.inner || '');
const listed = (app) => H.findAll(card(app)?.inner || '', (e) => e.name === 'li').map((e) => H.visibleText(e.inner));

test('#37 the Backlog card counts only the open, non-archived issues, saying they are open', { timeout: 30000 }, async () => {
  const app = await atReview(MIXED);
  const text = cardText(app);
  assert.match(text, /\b3 open issues\b/i, text);
  assert.equal(/\b6\b/.test(text), false, `the 6 read issues are not the count: ${text}`);
});

test('#37 the Backlog card lists the open issues only, never a closed or an archived one', { timeout: 30000 }, async () => {
  const app = await atReview(MIXED);
  const items = listed(app);
  assert.equal(items.length, 3, JSON.stringify(items));
  const text = cardText(app);
  for (const gone of ['Closed bug report', 'Archived idea', 'Another closed one']) assert.equal(text.includes(gone), false, `${gone}: ${text}`);
});

test('#37 the Backlog card lists the open issues most recent first (the Backlog\'s default order)', { timeout: 30000 }, async () => {
  const app = await atReview(MIXED);
  const order = listed(app).map((t) => (/Newest/.test(t) ? 'newest' : /Middle/.test(t) ? 'middle' : /Old/.test(t) ? 'old' : t));
  assert.deepEqual(order, ['newest', 'middle', 'old']);
});

test('#37 only closed and archived issues: the card says "No open issues." and lists nothing', { timeout: 30000 }, async () => {
  const app = await atReview(ONLY_CLOSED);
  const text = cardText(app);
  assert.equal(text.includes('No open issues.'), true, text);
  assert.equal(listed(app).length, 0, JSON.stringify(listed(app)));
  assert.equal(/\b2\b/.test(text), false, `no count of the closed ones: ${text}`);
});

test('#37 pt-BR: the count says the issues are open ("3 issues abertas")', { timeout: 30000 }, async () => {
  const app = await atReview(MIXED, { lang: 'pt-BR' });
  const text = cardText(app);
  assert.match(text, /\b3 issues abertas\b/i, text);
});

test('#37 pt-BR: only closed issues keep "Nenhuma issue aberta."', { timeout: 30000 }, async () => {
  const app = await atReview(ONLY_CLOSED, { lang: 'pt-BR' });
  const text = cardText(app);
  assert.equal(text.includes('Nenhuma issue aberta.'), true, text);
  assert.equal(listed(app).length, 0, JSON.stringify(listed(app)));
});

test('#37 unchanged: a repository with Issues turned off keeps its own state', { timeout: 30000 }, async () => {
  const data = { issues: [], issuesDisabled: true, repo: 'https://github.com/o/new' };
  const app = await W.atAnalysis({ api: { getBacklog: async () => data, backlogProgress: async () => null } });
  await W.defineWorkflows(app, 'analyze');
  await emit(app, ANALYZED);
  await W.toReview(app, 'analyze');
  await app.settle(20);
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog-issues-disabled') === null, false);
});

test('#37 unchanged: a failed read keeps its reason and Retry', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis({ api: { getBacklog: async () => null, syncBacklog: async () => { throw new Error('gh auth login needed'); } } });
  await W.defineWorkflows(app, 'analyze');
  await emit(app, ANALYZED);
  await W.toReview(app, 'analyze');
  await app.settle(20);
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog-retry') === null, false);
});
