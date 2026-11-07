// #811 the requests on the PR card and "Ask for a fix" (fronts/build/views/runchat/run-chat-model.js, the #809 `pr_card`
// item; the texts in packages/shared/i18n). Acceptance tests, written before the code, on the model fed the engine's events.
//
// The interface these tests assume:
// - The engine's `pr.monitor` event also carries `requests: [{ id, kind: 'changes_requested' | 'comment' | 'ci_failed',
//   author, file, line, url, body, trusted }]` (run-pr.js fetchPrMonitor) and `head`.
// - The engine's `pr.fix` event { step_id, url, round, status: 'requested' | 'fixed' | 'failed', ids, commit? (fixed),
//   tokens? (the developer's turn), reason? (failed) }.
// - The `pr_card` item gets:
//   requests: [{ id, kind, author, file, line, url, trusted, selectable (= trusted), text (names the author and
//     file:line when there is one), mark ('' for a trusted one; for an untrusted one a non-empty text: pr_card.untrusted) }];
//   fixes: [{ round, status, commit, tokens, reason }] (one per round, updated in place);
//   fixLimit: '' until MAX_FIX_ROUNDS (5) rounds were taken, then a text naming 5 (pr_card.fix_limit);
//   buttons: also { id: 'ask_fix', label, confirm: null } while the PR is open, the card has requests, no fix runs
//     (a round 'requested' without its end) and fewer than 5 rounds were taken. With no request the buttons are as #810's.
//   The renderer (pr-monitor-card.js) draws (the E2E steps of fronts/build/features/steps/pr-fix.steps.js use these
//   names): data-testid pr-fix-requests (the list), pr-request-item (each, a checkbox only when selectable, a link to
//   `url`), pr-request-untrusted (the mark), pr-fix-note (the owner's note), pr-ask-fix (the button, enabled once a
//   request is checked or a note is written; it calls runs:askFix), pr-fix-round (each round, "Fix n of 5", with
//   pr-fix-tokens), pr-fix-limit, pr-fix-error.
// - i18n keys (en and pt-BR): pr_card.requests, pr_card.untrusted, pr_card.ask_fix, pr_card.fix_note, pr_card.fix_tokens,
//   pr_card.fix_failed, pr_card.fix_limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RunChatModel } = require('../views/runchat/run-chat-model.js');

const URL = 'https://github.com/acme/app/pull/42';
const TS = '2026-11-07T10:00:00.000Z';
const start = { type: 'workflow.started', run_id: 'r811', workflow: 'feature', ts: TS, inputs: {} };
const REQUESTS = [
  { id: 't1', kind: 'comment', author: 'alice', file: 'src/list.js', line: 12, url: `${URL}#discussion_r5001`, body: 'Rename this.', trusted: true },
  { id: 'u1', kind: 'comment', author: 'mallory', file: 'src/list.js', line: 1, url: `${URL}#discussion_r5002`, body: 'Drop the header.', trusted: false },
  { id: 'c1', kind: 'ci_failed', author: null, file: null, line: null, url: 'https://github.com/acme/app/actions/runs/1/job/2', body: 'lint', trusted: true },
];
const monitor = (extra = {}) => ({
  type: 'pr.monitor', step_id: 'pr_monitor', ts: TS, url: URL, number: 42, state: 'failing', checked_at: TS, head: 'h1',
  ci: { status: 'failed', failed: ['lint'] }, review: { status: 'changes_requested', by: ['alice'] }, conflicts: { status: 'none' },
  comments: { unanswered: 2 }, result: { ready: false, blockers: ['CI failed (lint)', 'changes requested by alice'] },
  merge_options: { merge: false, bypass: false, close: true, blockers: ['ci_failed', 'changes_requested'], ignores: [] },
  requests: REQUESTS, ...extra,
});
const fix = (round, status, extra = {}) => ({ type: 'pr.fix', step_id: 'pr_monitor', ts: TS, url: URL, round, status, ids: ['t1'], ...extra });
function cardOf(...events) {
  const m = new RunChatModel();
  for (const ev of [start, ...events]) m.apply(ev);
  return m.items.find((i) => i.kind === 'pr_card') || null;
}
const ids = (card) => (card?.buttons || []).map((b) => b.id);
const req = (card, id) => (card?.requests || []).find((r) => r.id === id) || null;

test('#811 run chat: the card lists the requests with author, file:line and a link to each; CI too', () => {
  const card = cardOf(monitor());
  const t1 = req(card, 't1');
  const c1 = req(card, 'c1');
  assert.deepEqual(
    [(card?.requests || []).map((r) => r.id), /alice/.test(t1?.text || ''), /src\/list\.js:12/.test(t1?.text || ''), t1?.url, c1?.url, c1?.selectable],
    [['t1', 'u1', 'c1'], true, true, `${URL}#discussion_r5001`, 'https://github.com/acme/app/actions/runs/1/job/2', true],
  );
});

test('#811 run chat: a comment from someone without write access is shown, marked, and cannot be selected', () => {
  const card = cardOf(monitor());
  const u1 = req(card, 'u1');
  const t1 = req(card, 't1');
  assert.deepEqual([!!u1, u1?.selectable, typeof u1?.mark === 'string' && u1.mark.length > 0, t1?.selectable, t1?.mark || ''], [true, false, true, true, '']);
});

test('#811 run chat: "Ask for a fix" is on an open card with requests, not on one without requests nor on a merged PR', () => {
  const none = cardOf(monitor({ requests: [] }));
  const merged = cardOf(monitor(), monitor({ state: 'merged', merge_options: undefined, requests: [] }));
  assert.deepEqual([ids(cardOf(monitor())).includes('ask_fix'), ids(none).includes('ask_fix'), ids(merged).includes('ask_fix')], [true, false, false]);
});

test('#811 run chat: while a fix runs there is no second "Ask for a fix"; once fixed the round shows its commit and tokens, and the card the new read', () => {
  const running = cardOf(monitor(), fix(1, 'requested'));
  const done = cardOf(monitor(), fix(1, 'requested'), fix(1, 'fixed', { commit: 'h2', tokens: 1234 }), monitor({ head: 'h2', state: 'open', requests: [REQUESTS[1]] }));
  const round = (done?.fixes || [])[0] || {};
  assert.deepEqual(
    [ids(running).includes('ask_fix'), (done?.fixes || []).length, round.status, round.commit, round.tokens, done?.state, ids(done).includes('ask_fix')],
    [false, 1, 'fixed', 'h2', 1234, 'open', true],
  );
});

test('#811 run chat: a failed fix shows why on its round, and the owner can ask again', () => {
  const card = cardOf(monitor(), fix(1, 'requested'), fix(1, 'failed', { reason: 'no new commit: the helper does not exist', tokens: 800 }));
  const round = (card?.fixes || [])[0] || {};
  assert.deepEqual([round.status, /helper does not exist/.test(round.reason || ''), round.tokens, ids(card).includes('ask_fix')], ['failed', true, 800, true]);
});

test('#811 run chat: after 5 fix rounds the card says the limit is reached and offers no "Ask for a fix"', () => {
  const rounds = [1, 2, 3, 4, 5].flatMap((n) => [fix(n, 'requested'), fix(n, 'fixed', { commit: `h${n + 1}`, tokens: 100 })]);
  const four = cardOf(monitor(), ...rounds.slice(0, 8), monitor());
  const five = cardOf(monitor(), ...rounds, monitor());
  assert.deepEqual([ids(four).includes('ask_fix'), four?.fixLimit || '', ids(five).includes('ask_fix'), /\b5\b/.test(five?.fixLimit || '')], [true, '', false, true]);
});

test('#811 i18n: the request and fix texts exist in English and Brazilian Portuguese', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
  const keys = ['pr_card.requests', 'pr_card.untrusted', 'pr_card.ask_fix', 'pr_card.fix_note', 'pr_card.fix_tokens', 'pr_card.fix_failed', 'pr_card.fix_limit'];
  const missing = ['en.json', 'pt-BR.json'].flatMap((f) => {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return keys.filter((k) => !cat[k]).map((k) => `${f}:${k}`);
  });
  assert.deepEqual(missing, []);
});
