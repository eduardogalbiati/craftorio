// #809 the PR card in the run chat (fronts/build/views/runchat/run-chat-model.js): while the run waits in the PR
// monitor, one card with a link to the PR and five lines (CI, Review, Conflicts, Comments, Result), updated on each
// read. Acceptance tests, written before the code, on the model fed the engine's events.
//
// The interface these tests assume:
// - The engine's event `pr.monitor` { step_id, url, number, state, checked_at, ci, review, conflicts, comments,
//   result, fork?, error? } (run/transitions.js pollPrMonitor; the fields' shape is run-pr.js fetchPrMonitor's).
// - The model keeps ONE item `kind: 'pr_card'` per run (each event updates it in place) with `url`, `number`,
//   `checkedAt` (the last read that succeeded), `error` (null, or why the last read failed) and
//   `lines: [{ key, text }]`, keys in order ci, review, conflicts, comments, result (texts from the i18n catalog).
// - Result reads "Ready to merge" (pr_card.ready_to_merge) when nothing blocks the merge, else names the blockers;
//   in Fork + PR it says it waits for the maintainers (pr_card.waits_for_maintainers).
const test = require('node:test');
const assert = require('node:assert/strict');
const { RunChatModel } = require('../views/runchat/run-chat-model.js');

const URL = 'https://github.com/acme/app/pull/42';
const TS = '2026-11-07T10:00:00.000Z';
const start = { type: 'workflow.started', run_id: 'r809', workflow: 'feature', ts: TS, inputs: {} };
const monitor = (extra = {}) => ({
  type: 'pr.monitor', step_id: 'pr_monitor', ts: TS, url: URL, number: 42, state: 'failing', checked_at: TS,
  ci: { status: 'failed', failed: ['lint'] },
  review: { status: 'changes_requested', by: ['alice'] },
  conflicts: { status: 'base' },
  comments: { unanswered: 3 },
  result: { ready: false, blockers: ['CI failed (lint)', 'changes requested by alice'] },
  ...extra,
});
function model(...events) {
  const m = new RunChatModel();
  for (const ev of [start, ...events]) m.apply(ev);
  return m;
}
const cards = (m) => m.items.filter((i) => i.kind === 'pr_card');
const lineText = (card, key) => String((card?.lines || []).find((l) => l.key === key)?.text || '');

test('#809 run chat: a monitor read shows one PR card with a link to the PR and its five lines in order', () => {
  const card = cards(model(monitor()))[0];
  assert.deepEqual([card?.url, card?.number, (card?.lines || []).map((l) => l.key)], [URL, 42, ['ci', 'review', 'conflicts', 'comments', 'result']]);
  // the lines say which job failed, who asked for changes, the conflict with the base and how many comments are unanswered
  assert.deepEqual(
    [/lint/.test(lineText(card, 'ci')), /alice/.test(lineText(card, 'review')), /base/i.test(lineText(card, 'conflicts')), /\b3\b/.test(lineText(card, 'comments'))],
    [true, true, true, true],
  );
});

test('#809 run chat: a later read updates the same card; nothing blocking reads "Ready to merge"', () => {
  const ready = monitor({ state: 'ready', ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: ['bob'] }, conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: true, blockers: [] } });
  const m = model(monitor(), ready);
  assert.deepEqual([cards(m).length, /Ready to merge/.test(lineText(cards(m)[0], 'result'))], [1, true]);
});

test('#809 run chat: a read that failed keeps the last lines and says when the PR was last read', () => {
  const failed = { type: 'pr.monitor', step_id: 'pr_monitor', ts: '2026-11-07T10:05:00.000Z', url: URL, number: 42, state: 'failing', checked_at: TS, error: 'gh: HTTP 502' };
  const card = cards(model(monitor(), failed))[0];
  assert.deepEqual([/lint/.test(lineText(card, 'ci')), card?.checkedAt, /502/.test(String(card?.error || ''))], [true, TS, true]);
});

test('#809 run chat: in Fork + PR the result says the PR waits for the maintainers', () => {
  const card = cards(model(monitor({ fork: true, url: 'https://github.com/upstream/app/pull/42' })))[0];
  assert.match(lineText(card, 'result'), /maintainer/i);
});
