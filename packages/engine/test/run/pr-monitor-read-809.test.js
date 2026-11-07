// #809 what the PR monitor reads of a PR/MR, with no LLM (packages/engine/domains/run/run-pr.js): the card's
// lines (CI, Review, Conflicts, Comments, Result) on GitHub and on GitLab. Acceptance tests, written before the
// code; the CLIs are replaced by `reader(cmd, args)` (as fetchPrState's tests), answering fake gh/glab JSON.
//
// The interface these tests assume (new export of run-pr.js, the developer implements it as named):
//   fetchPrMonitor({ url }, { reader }) → Promise<{
//     state,                       // as fetchPrState: ready | failing | conflict | draft | merged | closed | open | pending
//     ci:        { status: 'passed' | 'failed' | 'running' | 'none', failed: [job names] },   // none: CI does not run on PRs
//     review:    { status: 'approved' | 'changes_requested' | 'required', by: [logins] },     // required: approvals missing
//     conflicts: { status: 'none' | 'base' },
//     comments:  { unanswered: n },
//     result:    { ready: boolean, blockers: [what blocks the merge] },
//   }>; a reader error rejects (the engine keeps the last state, never ends the run on it).
// The CLI calls it may make (the fake reader answers these and refuses anything else):
//   GitHub: `gh pr view <n> ... --json <fields>` (fields include reviewDecision, latestReviews, statusCheckRollup,
//           mergeable, mergeStateStatus); `gh api graphql ...` for the review threads (unanswered = unresolved:
//           { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved }] } } } } }).
//   GitLab: `glab mr view <iid> ... --output json`; `glab api projects/<id>/merge_requests/<iid>/approvals`
//           ({ approved, approvals_left, approved_by: [{ user: { username } }] }), `.../reviewers`
//           ([{ user: { username }, state }]), `.../discussions` ([{ notes: [{ resolvable, resolved }] }]) and
//           `projects/<id>/pipelines/<id>/jobs` ([{ name, status }]).
const test = require('node:test');
const assert = require('node:assert/strict');
const runPr = require('../../domains/run/run-pr');

const GH_URL = 'https://github.com/acme/app/pull/42';
const GL_URL = 'https://gitlab.com/acme/app/-/merge_requests/7';
const read = (url, reader) => runPr.fetchPrMonitor({ url }, { reader });

// ---- GitHub ------------------------------------------------------------------------------------
const check = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion });
const ghPr = (extra) => ({
  state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], comments: [], reviews: [],
  statusCheckRollup: [check('test', 'COMPLETED', 'SUCCESS')], ...extra,
});
const threads = (resolved) => ({ data: { repository: { pullRequest: { reviewThreads: { nodes: resolved.map((isResolved) => ({ isResolved })) } } } } });
function ghReader(pr, resolved = []) {
  return async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return pr;
    if (cmd === 'gh' && args[0] === 'api') return threads(resolved);
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
}

test('#809 GitHub: an approved PR, CI passed, no conflict, no comment is "ready to merge" with no blockers', async () => {
  const m = await read(GH_URL, ghReader(ghPr({})));
  assert.deepEqual([m.ci?.status, m.review?.status, m.conflicts?.status, m.comments?.unanswered, m.result?.ready, (m.result?.blockers || []).length], ['passed', 'approved', 'none', 0, true, 0]);
});

test('#809 GitHub: changes requested says by whom and blocks the merge; a review still required reads as approvals missing', async () => {
  const pr = ghPr({ reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ author: { login: 'alice' }, state: 'CHANGES_REQUESTED' }], mergeStateStatus: 'BLOCKED' });
  const changes = await read(GH_URL, ghReader(pr));
  const required = await read(GH_URL, ghReader(ghPr({ reviewDecision: 'REVIEW_REQUIRED', latestReviews: [], mergeStateStatus: 'BLOCKED' })));
  assert.deepEqual(
    [changes.review?.status, (changes.review?.by || []).includes('alice'), changes.result?.ready, required.review?.status, required.result?.ready],
    ['changes_requested', true, false, 'required', false],
  );
});

test('#809 GitHub: a failed check names its job; one still running reads as running; no check at all is CI that does not run on PRs', async () => {
  const failed = await read(GH_URL, ghReader(ghPr({ statusCheckRollup: [check('test', 'COMPLETED', 'SUCCESS'), check('lint', 'COMPLETED', 'FAILURE')] })));
  const running = await read(GH_URL, ghReader(ghPr({ statusCheckRollup: [check('test', 'IN_PROGRESS', '')] })));
  const none = await read(GH_URL, ghReader(ghPr({ statusCheckRollup: [] })));
  assert.deepEqual([failed.ci?.status, (failed.ci?.failed || []).includes('lint'), running.ci?.status, none.ci?.status], ['failed', true, 'running', 'none']);
});

test('#809 GitHub: a conflict with the base, and the unresolved review threads counted as unanswered comments', async () => {
  const m = await read(GH_URL, ghReader(ghPr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), [false, false, true]));
  assert.deepEqual([m.conflicts?.status, m.comments?.unanswered, m.result?.ready], ['base', 2, false]);
});

test('#809 GitHub: what blocks the merge names the failing job and the reviewer who asked for changes', async () => {
  const pr = ghPr({
    reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ author: { login: 'alice' }, state: 'CHANGES_REQUESTED' }], mergeStateStatus: 'BLOCKED',
    statusCheckRollup: [check('lint', 'COMPLETED', 'FAILURE')],
  });
  const blockers = String((await read(GH_URL, ghReader(pr))).result?.blockers || '');
  assert.deepEqual([/lint/.test(blockers), /alice/.test(blockers)], [true, true], blockers);
});

test('#809 a read that fails rejects (the monitor keeps its last state), it never answers merged or closed', async () => {
  const reader = async () => { throw new Error('gh: HTTP 502'); };
  const r = await read(GH_URL, reader).then((m) => `resolved:${m?.state}`, (e) => `rejected:${e.message}`);
  assert.match(r, /^rejected:.*502/);
});

// ---- GitLab ------------------------------------------------------------------------------------
const glMr = (extra) => ({
  iid: 7, project_id: 99, state: 'opened', draft: false, work_in_progress: false, has_conflicts: false,
  detailed_merge_status: 'mergeable', head_pipeline: { id: 555, status: 'success' }, ...extra,
});
function glReader(mr, { approvals = { approved: true, approvals_required: 1, approvals_left: 0, approved_by: [{ user: { username: 'bob' } }] }, reviewers = [], discussions = [], jobs = [] } = {}) {
  return async (cmd, args) => {
    const line = args.join(' ');
    if (cmd === 'glab' && args[0] === 'mr' && args[1] === 'view') return mr;
    if (cmd === 'glab' && args[0] === 'api' && /\/approvals\b/.test(line)) return approvals;
    if (cmd === 'glab' && args[0] === 'api' && /\/reviewers\b/.test(line)) return reviewers;
    if (cmd === 'glab' && args[0] === 'api' && /\/discussions\b/.test(line)) return discussions;
    if (cmd === 'glab' && args[0] === 'api' && /\/jobs\b/.test(line)) return jobs;
    throw new Error(`unexpected command: ${cmd} ${line}`);
  };
}

test('#809 GitLab: an approved MR, pipeline passed, no conflict, no discussion is "ready to merge"', async () => {
  const m = await read(GL_URL, glReader(glMr({})));
  assert.deepEqual([m.ci?.status, m.review?.status, m.conflicts?.status, m.comments?.unanswered, m.result?.ready], ['passed', 'approved', 'none', 0, true]);
});

test('#809 GitLab: approvals left read as approvals missing; a reviewer who requested changes is named', async () => {
  const missing = await read(GL_URL, glReader(glMr({ detailed_merge_status: 'not_approved' }), { approvals: { approved: false, approvals_required: 1, approvals_left: 1, approved_by: [] } }));
  const changes = await read(GL_URL, glReader(glMr({ detailed_merge_status: 'requested_changes' }), {
    approvals: { approved: false, approvals_required: 1, approvals_left: 1, approved_by: [] },
    reviewers: [{ user: { username: 'carol' }, state: 'requested_changes' }],
  }));
  assert.deepEqual([missing.review?.status, missing.result?.ready, changes.review?.status, (changes.review?.by || []).includes('carol')], ['required', false, 'changes_requested', true]);
});

test('#809 GitLab: a failed pipeline names its failed job; no pipeline reads as CI that does not run on MRs', async () => {
  const failed = await read(GL_URL, glReader(glMr({ head_pipeline: { id: 555, status: 'failed' } }), { jobs: [{ name: 'test', status: 'success' }, { name: 'lint', status: 'failed' }] }));
  const none = await read(GL_URL, glReader(glMr({ head_pipeline: null })));
  assert.deepEqual([failed.ci?.status, (failed.ci?.failed || []).includes('lint'), none.ci?.status], ['failed', true, 'none']);
});

test('#809 GitLab: a conflict with the target branch, and the unresolved discussions counted as unanswered comments', async () => {
  const discussions = [
    { notes: [{ resolvable: true, resolved: false }] },
    { notes: [{ resolvable: true, resolved: true }] },
    { notes: [{ resolvable: true, resolved: false }] },
    { notes: [{ resolvable: false, resolved: false, system: true }] },
  ];
  const m = await read(GL_URL, glReader(glMr({ has_conflicts: true, detailed_merge_status: 'broken_status' }), { discussions }));
  assert.deepEqual([m.conflicts?.status, m.comments?.unanswered, m.result?.ready], ['base', 2, false]);
});
