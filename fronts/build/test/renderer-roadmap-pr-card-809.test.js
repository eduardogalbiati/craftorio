// #809 the PR card on the Roadmap (fronts/build/views/backlog/backlog-roadmap.js): an item whose run waits in the
// PR monitor waits for its merge (#797) and shows the monitor's card. Acceptance tests, written before the code;
// backlog-roadmap.js evaluated in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap, as
// renderer-roadmap-waiting-merge-797.test.js; a new view file for the card is loaded there too).
//
// The interface these tests assume:
// - The service's item: `status: 'waiting_merge'`, `pr: { number, url, state, detail, checkedAt, ci, review,
//   conflicts, comments, result }` (the monitor's last read, run-pr.js fetchPrMonitor's shape).
// - The card: `data-testid="roadmap-item-pr-card"` inside the item, with one `data-testid="pr-card-line"` per line,
//   `data-line` ci | review | conflicts | comments | result, in that order; the PR link stays (roadmap-item-pr-link).
// - New catalog keys in packages/shared/i18n/en.json and pt-BR.json: pr_card.ready_to_merge ("Ready to merge"),
//   pr_card.waits_for_maintainers, pr_card.read_failed (the read failed, last read at <time>).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const PR_URL = 'https://github.com/o/r/pull/7';
const runTitle = (r) => (r && (r.title || r.runId)) || 'workflow';
const monitorPr = (extra = {}) => ({
  number: 7, url: PR_URL, state: 'failing', detail: 'CI failed', checkedAt: H.iso(H.NOW - 1 * H.MIN),
  ci: { status: 'failed', failed: ['lint'] }, review: { status: 'approved', by: ['bob'] }, conflicts: { status: 'none' },
  comments: { unanswered: 1 }, result: { ready: false, blockers: ['CI failed (lint)'] }, ...extra,
});
const waitingItem = (pr) => H.item('a', 'waiting_merge', 1, 'Login page', {
  runId: 'run-809', runs: ['run-809'], origin: H.iso(H.NOW - 2 * H.HOUR), error: null, pr,
  run: H.run({ status: 'running', startedAt: H.iso(H.NOW - 40 * H.MIN) }),
});
function render(items) {
  const { R } = H.loadRoadmap({ runTitle });
  return R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items }]), () => {}, view);
}
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

test('#809 roadmap: an item in the PR monitor waits for merge and shows the PR card with its five lines', () => {
  const box = H.itemEl(render([waitingItem(monitorPr())]), 'a');
  const card = byTestId(box.outer, 'roadmap-item-pr-card');
  const lines = card ? H.findAll(card.outer, (e) => e.attrs['data-testid'] === 'pr-card-line').map((e) => e.attrs['data-line']) : [];
  assert.deepEqual([box.attrs['data-status'], card === null, lines], ['waiting_merge', false, ['ci', 'review', 'conflicts', 'comments', 'result']]);
});

test('#809 roadmap: the card names the failing job and keeps the link to the PR', () => {
  const box = H.itemEl(render([waitingItem(monitorPr())]), 'a');
  const card = byTestId(box.outer, 'roadmap-item-pr-card');
  const link = byTestId(box.outer, 'roadmap-item-pr-link');
  assert.deepEqual([card ? /lint/.test(H.visibleText(card.inner)) : false, link?.attrs.href ?? null], [true, PR_URL]);
});

test('#809 roadmap: a PR nothing blocks reads "Ready to merge" on the card', () => {
  const pr = monitorPr({ state: 'ready', ci: { status: 'passed', failed: [] }, result: { ready: true, blockers: [] }, comments: { unanswered: 0 } });
  const card = byTestId(H.itemEl(render([waitingItem(pr)]), 'a').outer, 'roadmap-item-pr-card');
  assert.match(card ? H.visibleText(card.inner) : '', /Ready to merge/);
});

const catalog = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', name), 'utf8'));
const KEYS = ['pr_card.ready_to_merge', 'pr_card.waits_for_maintainers', 'pr_card.read_failed'];

test('#809 i18n: the PR card\'s texts are in en.json and pt-BR.json, translated', () => {
  const en = catalog('en.json');
  const pt = catalog('pt-BR.json');
  assert.deepEqual(
    [KEYS.filter((k) => typeof en[k] === 'string' && en[k]), KEYS.filter((k) => typeof pt[k] === 'string' && pt[k]), en['pr_card.ready_to_merge'], pt['pr_card.ready_to_merge'] !== en['pr_card.ready_to_merge']],
    [KEYS, KEYS, 'Ready to merge', true],
  );
});
