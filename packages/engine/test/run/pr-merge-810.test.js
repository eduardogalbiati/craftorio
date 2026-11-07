// #810 merge a pull request from the app when it is mergeable (packages/engine/domains/run/run-pr.js): whether the
// person can merge (and why not), the "merge ignoring protection" choice, and the merge itself with a re-check right
// before it. Acceptance tests, written before the code; the CLIs are replaced by `reader(cmd, args)` (JSON reads, as
// fetchPrMonitor's tests) and `run(cmd, args)` (the merge command), answering fake gh output.
//
// The interface these tests assume (new exports of run-pr.js, the developer implements them as named):
//   mergeOptions(card, { canMerge = true, canBypass = false, fork = false }) → {
//     merge: boolean,       // Merge button: the card is `ready`, nothing blocks it, the account can merge, not Fork + PR
//     bypass: boolean,      // "Merge ignoring protection": ONLY approvals_missing / protection block it, canBypass, not a fork
//     close: boolean,       // Close without merging (not asserted here)
//     blockers: [codes],    // in this order of checks, each at most once:
//                           //   'draft' (state draft), 'ci_failed' (ci.status failed), 'changes_requested',
//                           //   'approvals_missing' (review.status required), 'conflict' (conflicts.status base),
//                           //   'protection' (state open and none of the above: a branch rule blocks it);
//                           //   CI still running may add another code ('ci_running'), not asserted here
//     ignores: [codes],     // what the bypass ignores (= blockers when bypass, else [])
//   }
//   `card` is fetchPrMonitor's shape (#809): { state, detail, ci, review, conflicts, comments, result }.
//
//   mergePr({ url }, { admin = false, canMerge = true, canBypass = false, fork = false, deleteBranch = false, reader, run })
//     → Promise<{ merged: boolean, commit?: string, error?: string, blockers?: [codes] }>, never rejects on a platform
//     failure. It reads the PR again (reader) and refuses (run never called, merged false, blockers) unless
//     mergeOptions allows `merge` (or `bypass` when admin); runs the adapter's requestMergeCommand
//     (`gh pr merge <n> ... --merge`, `--admin` when admin) through `run(cli, args)` → { exit_code, output };
//     a non-zero exit is { merged: false, error: <the platform's message> }; after a merge it reads the PR once
//     more for its merge commit (commit: mergeCommit.oid).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/run/run-pr');

// ---- mergeOptions ------------------------------------------------------------------------------
const card = (extra = {}) => ({
  state: 'ready', detail: 'ready to merge (all 1 checks passed)',
  ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: ['bob'] },
  conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: true, blockers: [] }, ...extra,
});
const options = (c, perms) => {
  const o = load().mergeOptions(c, perms);
  return { merge: o.merge, bypass: o.bypass, blockers: o.blockers, ignores: o.ignores };
};
const CAN = { canMerge: true, canBypass: false };
const ADMIN = { canMerge: true, canBypass: true };

const CI_FAILED = { state: 'failing', ci: { status: 'failed', failed: ['lint'] }, result: { ready: false, blockers: ['CI failed (lint)'] } };
const CHANGES = { state: 'open', review: { status: 'changes_requested', by: ['alice'] }, result: { ready: false, blockers: ['changes requested by alice'] } };
const APPROVALS = { state: 'open', review: { status: 'required', by: [] }, result: { ready: false, blockers: ['approvals missing'] } };
const CONFLICT = { state: 'conflict', conflicts: { status: 'base' }, result: { ready: false, blockers: ['conflict with the base'] } };
const DRAFT = { state: 'draft', result: { ready: false, blockers: ['draft'] } };
const PROTECTION = { state: 'open', detail: 'open, all 1 checks passed (blocked)', result: { ready: false, blockers: ['open, all 1 checks passed (blocked)'] } };

test('#810 mergeOptions: a ready PR the account can merge gets Merge, no bypass, no blockers', () => {
  assert.deepEqual(options(card(), CAN), { merge: true, bypass: false, blockers: [], ignores: [] });
});

for (const [name, extra, code] of [
  ['CI failed', CI_FAILED, 'ci_failed'],
  ['changes requested', CHANGES, 'changes_requested'],
  ['approvals missing', APPROVALS, 'approvals_missing'],
  ['a conflict with the base', CONFLICT, 'conflict'],
  ['a draft', DRAFT, 'draft'],
]) {
  test(`#810 mergeOptions: ${name} blocks the merge and is named (${code}), no Merge`, () => {
    const o = options(card(extra), CAN);
    assert.deepEqual([o.merge, o.blockers], [false, [code]]);
  });
}

test('#810 mergeOptions: only approvals missing and the account can bypass → bypass naming what it ignores', () => {
  assert.deepEqual(options(card(APPROVALS), ADMIN), { merge: false, bypass: true, blockers: ['approvals_missing'], ignores: ['approvals_missing'] });
});

test('#810 mergeOptions: only a branch protection rule blocks (state open, nothing else) → protection, bypass with the permission', () => {
  assert.deepEqual(options(card(PROTECTION), ADMIN), { merge: false, bypass: true, blockers: ['protection'], ignores: ['protection'] });
});

test('#810 mergeOptions: never a bypass without the permission', () => {
  const o = options(card(APPROVALS), CAN);
  assert.deepEqual([o.merge, o.bypass, o.ignores], [false, false, []]);
});

for (const [name, extra] of [['a conflict', CONFLICT], ['CI failed', CI_FAILED], ['changes requested', CHANGES], ['a draft', DRAFT]]) {
  test(`#810 mergeOptions: approvals missing plus ${name} → no bypass, even with the permission`, () => {
    const c = card({ ...APPROVALS, ...extra, review: extra.review || APPROVALS.review });
    const o = options(c, ADMIN);
    assert.deepEqual([o.merge, o.bypass, o.blockers.length > 0], [false, false, true]);
  });
}

test('#810 mergeOptions: a person with no merge permission gets no merge choice on a ready PR', () => {
  const o = options(card(), { canMerge: false, canBypass: false });
  assert.deepEqual([o.merge, o.bypass], [false, false]);
});

test('#810 mergeOptions: Fork + PR (#738) gets no merge choice, even when the PR is ready', () => {
  const o = options(card(), { canMerge: true, canBypass: true, fork: true });
  assert.deepEqual([o.merge, o.bypass], [false, false]);
});

// ---- mergePr -----------------------------------------------------------------------------------
const URL = 'https://github.com/acme/app/pull/42';
const check = (name, conclusion) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion });
const ghPr = (extra = {}) => ({
  number: 42, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], comments: [], reviews: [], headRefOid: 'h1',
  statusCheckRollup: [check('test', 'SUCCESS')], ...extra,
});
const MERGED = { number: 42, state: 'MERGED', isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', statusCheckRollup: [], mergeCommit: { oid: 'abc1234' } };

// gh answers: the PR as `before` until a merge command exits 0, then merged; the review threads: none open
function fakeGh(before, { exit = 0, output = '' } = {}) {
  const calls = [];
  let merged = false;
  const reader = async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return merged ? MERGED : before;
    if (cmd === 'gh' && args[0] === 'api') return { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } };
    throw new Error(`unexpected read: ${cmd} ${args.join(' ')}`);
  };
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (exit === 0) merged = true;
    return { exit_code: exit, output };
  };
  return { reader, run, calls };
}
const mergeCalls = (calls) => calls.filter((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge');

test('#810 mergePr: a ready PR is merged with a merge commit (gh pr merge --merge) and gives the merge commit', async () => {
  const gh = fakeGh(ghPr());
  const r = await load().mergePr({ url: URL }, { reader: gh.reader, run: gh.run });
  const m = mergeCalls(gh.calls);
  assert.deepEqual([r.merged, r.commit, m.length, m[0]?.[3], m[0]?.includes('--merge'), m[0]?.includes('--squash')], [true, 'abc1234', 1, '42', true, false]);
});

test('#810 mergePr: the PR is read again right before merging: CI failed since the card → no merge, the blocker named', async () => {
  const gh = fakeGh(ghPr({ statusCheckRollup: [check('lint', 'FAILURE')] }));
  const r = await load().mergePr({ url: URL }, { reader: gh.reader, run: gh.run });
  assert.deepEqual([r.merged, gh.calls.length, (r.blockers || []).includes('ci_failed')], [false, 0, true]);
});

test('#810 mergePr: a merge the platform refuses says the platform\'s message and is not merged', async () => {
  const msg = 'GraphQL: Pull Request is not mergeable (mergePullRequest)';
  const gh = fakeGh(ghPr(), { exit: 1, output: msg });
  const r = await load().mergePr({ url: URL }, { reader: gh.reader, run: gh.run });
  assert.deepEqual([r.merged, String(r.error || '').includes(msg), r.commit ?? null], [false, true, null]);
});

const NEEDS_APPROVAL = { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: [] };

test('#810 mergePr: admin with only approvals missing and the permission → gh pr merge --merge --admin', async () => {
  const gh = fakeGh(ghPr(NEEDS_APPROVAL));
  const r = await load().mergePr({ url: URL }, { admin: true, canBypass: true, reader: gh.reader, run: gh.run });
  const m = mergeCalls(gh.calls)[0] || [];
  assert.deepEqual([r.merged, m.includes('--admin'), m.includes('--merge')], [true, true, true]);
});

test('#810 mergePr: admin without the permission merges nothing', async () => {
  const gh = fakeGh(ghPr(NEEDS_APPROVAL));
  const r = await load().mergePr({ url: URL }, { admin: true, canBypass: false, reader: gh.reader, run: gh.run });
  assert.deepEqual([r.merged, gh.calls.length], [false, 0]);
});

test('#810 mergePr: admin never merges over a conflict, even with the permission', async () => {
  const gh = fakeGh(ghPr({ ...NEEDS_APPROVAL, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }));
  const r = await load().mergePr({ url: URL }, { admin: true, canBypass: true, reader: gh.reader, run: gh.run });
  assert.deepEqual([r.merged, gh.calls.length, (r.blockers || []).includes('conflict')], [false, 0, true]);
});
