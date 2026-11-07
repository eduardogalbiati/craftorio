// #812 The PR card's rules moved into the platform adapters (github.pullState / gitlab.pullState, one copy for the
// run's PR monitor and the PRs screen). Each case's state is the one run-pr.js ghPrDisplay / glMrDisplay gave on main
// before the move, so the run's card and the list keep saying the same thing: draft, conflict, failing, pending,
// ready, open, merged, and GitLab's manual pipeline (someone has to act: open, never ready).
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('@multiagent/shared/platforms/github');
const gitlab = () => require('@multiagent/shared/platforms/gitlab');
const runPr = () => require('../../domains/run/run-pr');

const run = (name, status, conclusion = null) => ({ __typename: 'CheckRun', name, status, conclusion });
const passed = [run('test', 'COMPLETED', 'SUCCESS')];
const ghPr = (over) => ({ number: 7, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: passed, ...over });

const GH_CASES = [
  ['a draft', ghPr({ isDraft: true }), 'draft'],
  ['a conflict (CONFLICTING)', ghPr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), 'conflict'],
  ['a conflict (DIRTY only)', ghPr({ mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY' }), 'conflict'],
  ['a failed check', ghPr({ statusCheckRollup: [run('test', 'COMPLETED', 'FAILURE'), run('lint', 'COMPLETED', 'SUCCESS')] }), 'failing'],
  ['a failed commit status', ghPr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' }] }), 'failing'],
  ['a check still running', ghPr({ statusCheckRollup: [run('test', 'IN_PROGRESS'), run('lint', 'COMPLETED', 'SUCCESS')] }), 'pending'],
  ['a pending commit status', ghPr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' }] }), 'pending'],
  ['mergeable, clean, checks passed', ghPr({}), 'ready'],
  ['mergeable, clean, no check', ghPr({ statusCheckRollup: [] }), 'ready'],
  ['checks passed, blocked by protection', ghPr({ mergeStateStatus: 'BLOCKED' }), 'open'],
  ['merged', ghPr({ state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), 'merged'],
  ['closed', ghPr({ state: 'CLOSED' }), 'closed'],
];

const glMr = (over) => ({ iid: 7, state: 'opened', draft: false, has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { status: 'success' }, ...over });

const GL_CASES = [
  ['a draft', glMr({ draft: true }), 'draft'],
  ['a work in progress', glMr({ work_in_progress: true }), 'draft'],
  ['a conflict (has_conflicts)', glMr({ has_conflicts: true }), 'conflict'],
  ['a conflict (detailed_merge_status)', glMr({ detailed_merge_status: 'conflict' }), 'conflict'],
  ['a failed pipeline', glMr({ head_pipeline: { status: 'failed' } }), 'failing'],
  ['a running pipeline', glMr({ head_pipeline: { status: 'running' } }), 'pending'],
  ['a pipeline passed, mergeable', glMr({}), 'ready'],
  ['no pipeline, merge_status can_be_merged (before GitLab 15.6)', glMr({ head_pipeline: null, detailed_merge_status: undefined, merge_status: 'can_be_merged' }), 'ready'],
  ['a manual pipeline, mergeable', glMr({ head_pipeline: { status: 'manual' } }), 'open'],
  ['a pipeline passed, not approved', glMr({ detailed_merge_status: 'not_approved' }), 'open'],
  ['merged', glMr({ state: 'merged' }), 'merged'],
];

test('#812 github.pullState: draft, conflict, failing, pending, ready, open, merged and closed', () => {
  const got = GH_CASES.map(([name, pr]) => [name, github().pullState(pr)]);
  assert.deepEqual(got, GH_CASES.map(([name, , want]) => [name, want]));
});

test('#812 gitlab.pullState: draft, conflict, failing, pending, ready, manual (open), open and merged', () => {
  const got = GL_CASES.map(([name, mr]) => [name, gitlab().pullState(mr)]);
  assert.deepEqual(got, GL_CASES.map(([name, , want]) => [name, want]));
});

test('#812 the run\'s PR card (ghPrDisplay) says the same state as before the rules moved', () => {
  const got = GH_CASES.map(([name, pr]) => [name, runPr().ghPrDisplay(pr).state]);
  assert.deepEqual(got, GH_CASES.map(([name, , want]) => [name, want]));
});

test('#812 the run\'s MR card (glMrDisplay) says the same state as before the rules moved', () => {
  const got = GL_CASES.map(([name, mr]) => [name, runPr().glMrDisplay(mr).state]);
  assert.deepEqual(got, GL_CASES.map(([name, , want]) => [name, want]));
});
