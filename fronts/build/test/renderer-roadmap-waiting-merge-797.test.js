// #797 "A run that ended with a PR a person merges": the Roadmap card and bar of an item that waits for its PR's
// merge. Acceptance tests written before the code. fronts/build/views/backlog/backlog-roadmap.js is evaluated whole
// in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap), with the real status pill and RoadmapModel.
//
// Contract (the seam these tests assume):
// - The service's item: `status: 'waiting_merge'`, `error: null`, `pr: { number, url, state, detail, checkedAt }`
//   (`state: 'unknown'` with a detail matching /could not read the PR/ after a failed read).
// - The card: `roadmap-item` and its `status-label` carry data-status 'waiting_merge'; the label reads
//   'Waiting for PR merge' (en) and 'Aguardando merge do PR' (pt-BR), the catalogs' `status_pill.status_waiting_merge`.
// - A link `data-testid="roadmap-item-pr-link"` to pr.url whose text has `#<number>`.
// - No error line, no failure banner; Skip offered, no Retry.
// - After a failed read `data-testid="roadmap-item-merge-wait"` says why, not styled as an error.
// - The roadmap says what it waits for: `data-testid="roadmap-merge-wait"` with `#<number>` and "merge", only when an
//   item waits.
// - A failed item ('closed without merging') keeps today's Retry and Skip.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const PR_URL = 'https://github.com/o/r/pull/7';
const READ_FAILED = 'could not read the PR: gh is not installed';
const CLOSED = 'PR #7 was closed without merging';
const runTitle = (r) => (r && (r.title || r.runId)) || 'workflow';

const pr = (extra = {}) => ({ number: 7, url: PR_URL, state: 'open', detail: 'open', checkedAt: H.iso(H.NOW - 5 * H.MIN), ...extra });
function ended(id, status, extra = {}) {
  return H.item(id, status, 1, 'Login page', {
    runId: 'run-42', runs: ['run-42'], origin: H.iso(H.NOW - 2 * H.HOUR), error: null,
    run: H.run({ status: 'success', startedAt: H.iso(H.NOW - 40 * H.MIN), finishedAt: H.iso(H.NOW - 10 * H.MIN) }),
    ...extra,
  });
}
const waitingItem = (extra = {}) => ended('a', 'waiting_merge', { pr: pr(), ...extra });
const dataOf = (items, roadmap) => H.roadmapOf([{ id: 'st1', name: '', note: '', items }], roadmap);
function render(items, roadmap) {
  const { R } = H.loadRoadmap({ runTitle });
  return R.html(dataOf(items, roadmap), () => {}, view);
}
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const classes = (el) => String(el.attrs.class || '').split(/\s+/);
const itemButton = (box, action) => H.findEl(box.outer, (e) => e.attrs['data-rm-item'] === action);

test('#797 roadmap card: a waiting item carries data-status waiting_merge and its pill reads "Waiting for PR merge"', () => {
  const box = H.itemEl(render([waitingItem()]), 'a');
  assert.equal(box.attrs['data-status'], 'waiting_merge');
  const labels = H.findAll(box.outer, (e) => e.attrs['data-testid'] === 'status-label' && e.attrs['data-status'] === 'waiting_merge');
  assert.ok(labels.length > 0, 'a status label with data-status="waiting_merge"');
  assert.deepEqual([...new Set(labels.map((e) => H.visibleText(e.inner)))], ['Waiting for PR merge']);
});

test('#797 roadmap card: a waiting item links its PR', () => {
  const link = byTestId(H.itemEl(render([waitingItem()]), 'a').outer, 'roadmap-item-pr-link');
  assert.equal(link === null, false, 'the card has the PR link');
  assert.equal(link.attrs.href, PR_URL);
  assert.ok(H.visibleText(link.inner).includes('#7'), H.visibleText(link.inner));
});

test('#797 roadmap card: a waiting item shows nothing red: no error line, no failed pill', () => {
  const box = H.itemEl(render([waitingItem()]), 'a');
  assert.equal(H.findEl(box.outer, (e) => classes(e).includes('rm-error') && classes(e).includes('error')), null);
  assert.equal(H.findEl(box.outer, (e) => classes(e).includes('pill-failed')), null);
  assert.doesNotMatch(H.visibleText(box.outer), /\bFailed\b/);
});

test('#797 roadmap alerts: a waiting item raises no failure banner', () => {
  const { R } = H.loadRoadmap({ runTitle });
  assert.equal(R.alerts(dataOf([waitingItem()]), H.makeCtx().ctx).length, 0);
});

test('#797 roadmap card: a waiting item offers Skip and no Retry', () => {
  const box = H.itemEl(render([waitingItem()]), 'a');
  assert.equal(itemButton(box, 'skip') === null, false, 'the owner can go on without the merge');
  assert.equal(itemButton(box, 'retry'), null, 'its run succeeded: nothing to run again');
});

test('#797 roadmap card: a failed read says why on a waiting item, not styled as an error', () => {
  const box = H.itemEl(render([waitingItem({ pr: pr({ state: 'unknown', detail: READ_FAILED }) })]), 'a');
  assert.equal(box.attrs['data-status'], 'waiting_merge');
  const line = byTestId(box.outer, 'roadmap-item-merge-wait');
  assert.equal(line === null, false, 'the card has the wait line');
  assert.ok(H.visibleText(line.inner).includes(READ_FAILED), H.visibleText(line.inner));
  assert.equal(classes(line).includes('error'), false);
  assert.equal(H.findEl(box.outer, (e) => classes(e).includes('rm-error') && classes(e).includes('error')), null);
});

test('#797 roadmap: while an item waits the roadmap says what it waits for', () => {
  const line = byTestId(render([waitingItem()]), 'roadmap-merge-wait');
  assert.equal(line === null, false, 'the roadmap has the wait line');
  const text = H.visibleText(line.inner);
  assert.ok(text.includes('#7'), text);
  assert.match(text, /merge/i);
});

test('#797 roadmap: with no item waiting there is no merge wait line', () => {
  assert.equal(byTestId(render([ended('a', 'done')]), 'roadmap-merge-wait'), null);
});

test('#797 roadmap card: an item whose PR was closed without merging keeps Retry, Skip and its error', () => {
  const x = ended('a', 'failed', { error: CLOSED });
  const box = H.itemEl(render([x], { state: 'paused', pausedBy: 'a', error: CLOSED }), 'a');
  assert.equal(itemButton(box, 'retry') === null, false, 'Retry stays');
  assert.equal(itemButton(box, 'skip') === null, false, 'Skip stays');
  assert.ok(H.visibleText(box.outer).includes(CLOSED));
});

const catalog = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', name), 'utf8'));

test('#797 roadmap card: a PR with no URL has no link, and the item still waits with nothing red', () => {
  const box = H.itemEl(render([waitingItem({ pr: pr({ url: null }) })]), 'a');
  assert.equal(box.attrs['data-status'], 'waiting_merge');
  assert.equal(byTestId(box.outer, 'roadmap-item-pr-link'), null);
});

test('#797 roadmap card: a PR with no number links with the words of the catalog', () => {
  const link = byTestId(H.itemEl(render([waitingItem({ pr: pr({ number: null }) })]), 'a').outer, 'roadmap-item-pr-link');
  assert.equal(link === null, false, 'the card has the PR link');
  assert.equal(H.visibleText(link.inner), catalog('en.json')['backlog_roadmap.open_pr']);
});

test('#797 roadmap card: a parked item whose run waits for its merge links its PR and says why a read failed', () => {
  const box = H.itemEl(render([ended('a', 'parked', { parked: { at: null, gate: 'Check' }, pr: pr({ state: 'unknown', detail: READ_FAILED }) })]), 'a');
  assert.equal(box.attrs['data-status'], 'parked');
  assert.equal(byTestId(box.outer, 'roadmap-item-pr-link') === null, false, 'the card has the PR link');
  assert.ok(H.visibleText(byTestId(box.outer, 'roadmap-item-merge-wait').inner).includes(READ_FAILED));
});

test('#797 i18n: the catalogs hold the state\'s label in English and Portuguese', () => {
  assert.equal(catalog('en.json')['status_pill.status_waiting_merge'], 'Waiting for PR merge');
  assert.equal(catalog('pt-BR.json')['status_pill.status_waiting_merge'], 'Aguardando merge do PR');
});
