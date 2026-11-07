// #809 internals of the PR monitor (the developer's own tests, next to the acceptance ones):
// - transitions.js prMonitorSeed: a run recovered in its monitor waits there from the start (no run
//   slot), with its last card and the time the card last changed (the slower pace survives a restart);
// - run-pr.js fetchPrMonitor: a GitHub review asking for changes blocks even when no review is required
//   (reviewDecision empty); a GitLab pipeline waiting for a manual job is `manual`, not running forever;
// - packages/shared/pr-card.js: one line's HTML and the card's title, shared by the run and the Roadmap.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { prMonitorSeed } = require('../../engine/run/transitions');
const runPr = require('../../domains/run/run-pr');
const PrCard = require('../../../shared/pr-card');

const CARD = { ci: { status: 'running', failed: [] }, review: { status: 'required', by: [] }, conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: false, blockers: ['CI running'] } };

test('#809 prMonitorSeed: the last card, and the time of the last change, not of the last read', () => {
  const events = [
    { type: 'pr.monitor', step_id: 'pr_monitor', ts: '2026-11-01T10:00:00.000Z', state: 'open', checked_at: '2026-11-01T10:00:00.000Z', ...CARD },
    { type: 'pr.monitor', step_id: 'pr_monitor', ts: '2026-11-01T10:10:00.000Z', state: 'open', checked_at: '2026-11-01T10:10:00.000Z', ...CARD },
    { type: 'pr.monitor', step_id: 'pr_monitor', ts: '2026-11-01T10:20:00.000Z', error: 'gh: offline', state: 'open', ...CARD },
    { type: 'pr.monitor', step_id: 'other', ts: '2026-11-02T10:00:00.000Z', state: 'ready' },
  ];
  const seed = prMonitorSeed(events, 'pr_monitor');
  assert.strictEqual(seed.prMonitor, 'pr_monitor');
  assert.strictEqual(seed.prMonitorChangedAt, Date.parse('2026-11-01T10:00:00.000Z'));
  assert.strictEqual(seed.prMonitorCard.checked_at, '2026-11-01T10:10:00.000Z');
  assert.deepStrictEqual(seed.prMonitorCard.ci, CARD.ci);
  assert.strictEqual(prMonitorSeed([], 'pr_monitor').prMonitorCard, null);
});

test('#809 GitHub: changes requested with no review required still block the merge', async () => {
  const pr = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [], reviewDecision: '', comments: [],
    latestReviews: [{ state: 'APPROVED', author: { login: 'ann' } }, { state: 'CHANGES_REQUESTED', author: { login: 'bob' } }] };
  const reader = async (cmd, args) => { if (args[0] === 'api') throw new Error('no scope'); return pr; };
  const m = await runPr.fetchPrMonitor({ url: 'https://github.com/acme/widgets/pull/9' }, { reader });
  assert.deepStrictEqual(m.review, { status: 'changes_requested', by: ['bob'] });
  assert.strictEqual(m.result.ready, false);
  assert.ok(m.result.blockers.some((b) => /changes requested by bob/.test(b)), JSON.stringify(m.result));
});

test('#809 GitLab: a pipeline waiting for a manual job is manual, and the discussions are read 100 a page', async () => {
  const routes = [];
  const mr = { iid: 9, project_id: 7, state: 'opened', draft: false, has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { id: 3, status: 'manual' } };
  const reader = async (cmd, args) => {
    if (args[0] !== 'api') return mr;
    routes.push(args[1]);
    if (/approvals$/.test(args[1])) return { approved: true, approvals_left: 0, approved_by: [] };
    return [];
  };
  const m = await runPr.fetchPrMonitor({ url: 'https://gitlab.com/acme/widgets/-/merge_requests/9' }, { reader });
  assert.strictEqual(m.ci.status, 'manual');
  assert.ok(m.result.blockers.includes('CI waits for a manual job'), JSON.stringify(m.result));
  assert.ok(routes.some((r) => /discussions\?per_page=100$/.test(r)), routes.join(' '));
  assert.ok(PrCard.lines(m).find((l) => l.key === 'ci').text !== 'manual', 'the manual status has its own text');
});

test('#809 PrCard.lineHtml and title: one line HTML for both cards, the title follows the state', () => {
  const html = PrCard.lineHtml({ key: 'ci', label: 'CI', text: 'failed (<lint>)', tone: 'bad' }, 'pr-card-line');
  assert.match(html, /data-testid="pr-card-line"/);
  assert.match(html, /data-line="ci"/);
  assert.match(html, /pill pill-failed/);
  assert.match(html, /&lt;lint&gt;/);
  assert.notStrictEqual(PrCard.title('merged'), PrCard.title('open'));
  assert.notStrictEqual(PrCard.title('closed'), PrCard.title('merged'));
});
