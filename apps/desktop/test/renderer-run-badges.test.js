// apps/desktop/renderer/run-badges.js: the PR icon (coloured by state) and #n link, and a run's default
// title (#84), shared by app.js, run-chat.js and backlog.js. Pure (no DOM): it loads in Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const RunBadges = require('../renderer/run-badges');

test('prBadgeHtml: nothing without a PR (no url and no number)', () => {
  assert.equal(RunBadges.prBadgeHtml(null), '');
  assert.equal(RunBadges.prBadgeHtml({}), '');
});

test('prBadgeHtml: the state names the CSS class, and the number is a link to the PR', () => {
  const html = RunBadges.prBadgeHtml({ number: 66, url: 'https://github.com/o/r/pull/66', state: 'ready' });
  assert.match(html, /class="run-pr run-pr-ready"/);
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/pull\/66"/);
  assert.match(html, /data-pr-url="https:\/\/github\.com\/o\/r\/pull\/66"/);
  assert.match(html, /#66/);
});

test('prBadgeHtml: a conflict gets a warning mark; without a url it is not a link', () => {
  const conflict = RunBadges.prBadgeHtml({ number: 1, url: 'https://github.com/o/r/pull/1', state: 'conflict' });
  assert.match(conflict, /run-pr-warn/);
  const noUrl = RunBadges.prBadgeHtml({ number: 2, state: 'pending' });
  assert.doesNotMatch(noUrl, /<a /);
  assert.match(noUrl, /<span class="run-pr run-pr-pending"/);
});

test('prBadgeHtml: compact adds its class; an unread PR (no state yet) shows "checking"', () => {
  const compact = RunBadges.prBadgeHtml({ number: 3, url: 'https://github.com/o/r/pull/3', state: 'open' }, { compact: true });
  assert.match(compact, /run-pr-open compact/);
  const unread = RunBadges.prBadgeHtml({ number: 4, url: 'https://github.com/o/r/pull/4' });
  assert.match(unread, /run-pr-checking/);
});

test('prTooltip: the state in words, its detail and when it was checked', () => {
  const tip = RunBadges.prTooltip({ number: 5, state: 'failing', detail: 'checks failed: lint', checkedAt: '2026-09-30T10:00:00.000Z' });
  assert.match(tip, /^PR #5: checks failing: checks failed: lint · checked/);
  assert.equal(RunBadges.prTooltip({ number: 6 }), 'PR #6: checking the state…');
});

test('defaultTitle: the issue, a group with "(+k)", or the task\'s first line', () => {
  assert.equal(RunBadges.defaultTitle({ issues: [{ number: 12, title: 'Fix the bug' }] }), '#12 Fix the bug');
  assert.equal(RunBadges.defaultTitle({ issues: [{ number: 12 }, { number: 13 }] }), '#12 (+1)');
  assert.equal(RunBadges.defaultTitle({ issue: { number: 7 } }), '#7');
  assert.equal(RunBadges.defaultTitle({ inputs: { task: 'Add the feature\nmore' } }), 'Add the feature');
  assert.equal(RunBadges.defaultTitle({}), null);
});
