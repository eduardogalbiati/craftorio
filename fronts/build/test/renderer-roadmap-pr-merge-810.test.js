// #810 merge a pull request from the app: the same buttons on the Roadmap's PR card (fronts/build/views/backlog/
// backlog-roadmap.js / backlog-roadmap-pr-card.js, #809's roadmap-item-pr-card). Acceptance tests, written before the
// code; backlog-roadmap.js evaluated in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap, as
// renderer-roadmap-pr-card-809.test.js).
//
// The interface these tests assume:
// - The service's item `pr` (roadmap.js mergeGateOf / monitorCardOf) also carries `mergeOptions` (the pr.monitor
//   event's merge_options: run-pr.js mergeOptions → { merge, bypass, close, blockers, ignores }) and `mergeError`
//   (the platform's message of the last merge from the app that failed, else absent).
// - Inside the item: a button `data-testid="pr-merge"` when mergeOptions.merge, `pr-merge-admin` when
//   mergeOptions.bypass (its text names what it ignores, `data-confirm` holds the confirmation question),
//   `pr-close` when mergeOptions.close (with `data-confirm`); the failed merge's message is shown on the card.
// - New catalog keys in packages/shared/i18n/en.json and pt-BR.json: pr_card.merge, pr_card.merge_admin,
//   pr_card.close, pr_card.merge_failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const PR_URL = 'https://github.com/o/r/pull/7';
const runTitle = (r) => (r && (r.title || r.runId)) || 'workflow';
const opts = (extra = {}) => ({ merge: false, bypass: false, close: true, blockers: [], ignores: [], ...extra });
const readyPr = (extra = {}) => ({
  number: 7, url: PR_URL, state: 'ready', detail: 'ready to merge', checkedAt: H.iso(H.NOW - 1 * H.MIN),
  ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: ['bob'] }, conflicts: { status: 'none' },
  comments: { unanswered: 0 }, result: { ready: true, blockers: [] }, mergeOptions: opts({ merge: true }), ...extra,
});
const waitingItem = (pr) => H.item('a', 'waiting_merge', 1, 'Login page', {
  runId: 'run-810', runs: ['run-810'], origin: H.iso(H.NOW - 2 * H.HOUR), error: null, pr,
  run: H.run({ status: 'running', startedAt: H.iso(H.NOW - 40 * H.MIN) }),
});
function itemBox(pr) {
  const { R } = H.loadRoadmap({ runTitle });
  return H.itemEl(R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items: [waitingItem(pr)] }]), () => {}, view), 'a');
}
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const shown = (box, id) => byTestId(box.outer, id) !== null;

test('#810 roadmap: a mergeable PR\'s card has Merge and Close, no bypass', () => {
  const box = itemBox(readyPr());
  assert.deepEqual([shown(box, 'pr-merge'), shown(box, 'pr-merge-admin'), shown(box, 'pr-close')], [true, false, true]);
});

test('#810 roadmap: a blocked PR (CI failed) has no Merge, the card still offers Close', () => {
  const box = itemBox(readyPr({ state: 'failing', ci: { status: 'failed', failed: ['lint'] }, result: { ready: false, blockers: ['CI failed (lint)'] }, mergeOptions: opts({ blockers: ['ci_failed'] }) }));
  assert.deepEqual([shown(box, 'pr-merge'), shown(box, 'pr-merge-admin'), shown(box, 'pr-close')], [false, false, true]);
});

test('#810 roadmap: bypass allowed → a separate button naming what it ignores, with a confirmation', () => {
  const pr = readyPr({ state: 'open', review: { status: 'required', by: [] }, result: { ready: false, blockers: ['approvals missing'] }, mergeOptions: opts({ bypass: true, blockers: ['approvals_missing'], ignores: ['approvals_missing'] }) });
  const box = itemBox(pr);
  const b = byTestId(box.outer, 'pr-merge-admin');
  assert.deepEqual(
    [shown(box, 'pr-merge'), b !== null, /approv/i.test(`${b ? H.visibleText(b.inner) : ''} ${b?.attrs.title || ''}`), String(b?.attrs['data-confirm'] || '').length > 0],
    [false, true, true, true],
  );
});

test('#810 roadmap: Close asks for confirmation', () => {
  const b = byTestId(itemBox(readyPr()).outer, 'pr-close');
  assert.equal(String(b?.attrs['data-confirm'] || '').length > 0, true);
});

test('#810 roadmap: a merge that failed shows the platform\'s message on the card, the item still waits for the merge', () => {
  const msg = 'Pull Request is not mergeable';
  const box = itemBox(readyPr({ mergeError: msg }));
  const card = byTestId(box.outer, 'roadmap-item-pr-card');
  assert.deepEqual([box.attrs['data-status'], card ? H.visibleText(card.inner).includes(msg) : false], ['waiting_merge', true]);
});

const catalog = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', name), 'utf8'));
const KEYS = ['pr_card.merge', 'pr_card.merge_admin', 'pr_card.close', 'pr_card.merge_failed'];

test('#810 i18n: the merge buttons\' texts are in en.json and pt-BR.json', () => {
  const en = catalog('en.json');
  const pt = catalog('pt-BR.json');
  assert.deepEqual([KEYS.filter((k) => typeof en[k] === 'string' && en[k]), KEYS.filter((k) => typeof pt[k] === 'string' && pt[k])], [KEYS, KEYS]);
});
