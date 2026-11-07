// #810 merge a pull request from the app: the buttons on the run chat's PR card (fronts/build/views/runchat/run-chat-model.js,
// the #809 `pr_card` item). Acceptance tests, written before the code, on the model fed the engine's events.
//
// The interface these tests assume:
// - The engine's `pr.monitor` event (#809) also carries `merge_options` = run-pr.js mergeOptions(card, permissions):
//   { merge, bypass, close, blockers: [codes], ignores: [codes] } (codes: draft, ci_failed, changes_requested,
//   approvals_missing, conflict, protection).
// - A merge tried from the app gives the event `pr.merge` { step_id, url, number, admin, merged: boolean,
//   commit? (merged), error? (the platform's message when it did not merge), by? }.
// - The `pr_card` item gets `buttons: [{ id, label, confirm }]`, ids in this order among 'merge', 'merge_admin', 'close':
//   'merge' when merge_options.merge, 'merge_admin' when merge_options.bypass (its label or confirm names what it
//   ignores; confirm: a non-empty question), 'close' when merge_options.close (confirm: a non-empty question);
//   never 'merge' / 'merge_admin' in Fork + PR; [] once the PR is merged. Rendered with data-testid pr-merge,
//   pr-merge-admin, pr-close (pr-monitor-card.js).
// - A failed `pr.merge` sets `mergeError` (its message) and leaves the card's state and buttons as they were.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RunChatModel } = require('../views/runchat/run-chat-model.js');

const URL = 'https://github.com/acme/app/pull/42';
const TS = '2026-11-07T10:00:00.000Z';
const start = { type: 'workflow.started', run_id: 'r810', workflow: 'feature', ts: TS, inputs: {} };
const opts = (extra = {}) => ({ merge: false, bypass: false, close: true, blockers: [], ignores: [], ...extra });
const READY = {
  type: 'pr.monitor', step_id: 'pr_monitor', ts: TS, url: URL, number: 42, state: 'ready', checked_at: TS,
  ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: ['bob'] }, conflicts: { status: 'none' },
  comments: { unanswered: 0 }, result: { ready: true, blockers: [] }, merge_options: opts({ merge: true }),
};
const NEEDS_APPROVAL = {
  ...READY, state: 'open', review: { status: 'required', by: [] }, result: { ready: false, blockers: ['approvals missing'] },
  merge_options: opts({ bypass: true, blockers: ['approvals_missing'], ignores: ['approvals_missing'] }),
};
const CI_FAILED = {
  ...READY, state: 'failing', ci: { status: 'failed', failed: ['lint'] }, result: { ready: false, blockers: ['CI failed (lint)'] },
  merge_options: opts({ blockers: ['ci_failed'] }),
};
function cardOf(...events) {
  const m = new RunChatModel();
  for (const ev of [start, ...events]) m.apply(ev);
  return m.items.find((i) => i.kind === 'pr_card') || null;
}
const ids = (card) => (Array.isArray(card?.buttons) ? card.buttons.map((b) => b.id) : null);
const button = (card, id) => (card?.buttons || []).find((b) => b.id === id) || null;
const resultText = (card) => String((card?.lines || []).find((l) => l.key === 'result')?.text || '');

test('#810 run chat: a mergeable PR\'s card has Merge and Close, no bypass', () => {
  assert.deepEqual(ids(cardOf(READY)), ['merge', 'close']);
});

test('#810 run chat: Close asks for confirmation; a plain Merge does not need one', () => {
  const card = cardOf(READY);
  assert.deepEqual([typeof button(card, 'close')?.confirm === 'string' && button(card, 'close').confirm.length > 0, button(card, 'merge')?.confirm ?? null], [true, null]);
});

test('#810 run chat: CI failed → the result names it and the card has no Merge', () => {
  const card = cardOf(CI_FAILED);
  assert.deepEqual([/CI failed/.test(resultText(card)), ids(card)], [true, ['close']]);
});

test('#810 run chat: only approvals missing and the account can bypass → a separate button that names what it ignores and asks first', () => {
  const card = cardOf(NEEDS_APPROVAL);
  const b = button(card, 'merge_admin');
  assert.deepEqual(
    [ids(card), /approv/i.test(`${b?.label || ''} ${b?.confirm || ''}`), typeof b?.confirm === 'string' && b.confirm.length > 0],
    [['merge_admin', 'close'], true, true],
  );
});

test('#810 run chat: a person without the merge permission sees the card without merge buttons', () => {
  const card = cardOf({ ...READY, merge_options: opts() });
  assert.deepEqual([ids(card), card?.lines?.length], [['close'], 5]);
});

test('#810 run chat: Fork + PR (#738) never shows a merge button', () => {
  const card = cardOf({ ...READY, fork: true, url: 'https://github.com/upstream/app/pull/42', merge_options: opts({ close: false }) });
  const list = ids(card);
  assert.deepEqual([Array.isArray(list), (list || []).includes('merge'), (list || []).includes('merge_admin')], [true, false, false]);
});

test('#810 run chat: a merge that failed shows the platform\'s message; the card is not merged and still offers Merge', () => {
  const msg = 'GraphQL: Pull Request is not mergeable (mergePullRequest)';
  const failed = { type: 'pr.merge', step_id: 'pr_monitor', ts: '2026-11-07T10:01:00.000Z', url: URL, number: 42, admin: false, merged: false, error: msg };
  const card = cardOf(READY, failed);
  assert.deepEqual([String(card?.mergeError || '').includes(msg), card?.state, ids(card)], [true, 'ready', ['merge', 'close']]);
});

test('#810 run chat: a merge from the app that landed leaves no buttons and the card reads merged', () => {
  const done = { type: 'pr.merge', step_id: 'pr_monitor', ts: '2026-11-07T10:01:00.000Z', url: URL, number: 42, admin: false, merged: true, commit: 'abc1234' };
  const card = cardOf(READY, done);
  assert.deepEqual([card?.state, ids(card), card?.mergeError ?? null], ['merged', [], null]);
});
