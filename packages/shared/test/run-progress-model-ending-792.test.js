// #792: a run ending in a PR draws its last station under another name than Merge (Abrir PR, Open PR
// or Pull request: the developer picks), and #614's rule follows it: the station where the work lands
// is done with the merged commit, whichever name it has. Acceptance tests written before the code.
// The groups are ai-development-remote-hero's, shortened to the steps used here, with the renamed group.
const test = require('node:test');
const assert = require('node:assert/strict');

const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'code_review', type: 'agent', agent: 'reviewer' },
  { id: 'pr_open', type: 'agent', agent: 'ci_pusher' },
  { id: 'pr_review', type: 'human_approval' },
  { id: 'resolve_merge', type: 'agent', agent: 'developer' },
  { id: 'merge_blocked', type: 'human_approval' },
];
const groups = (name) => [
  { name: 'Develop', steps: ['develop'] },
  { name: 'Review', steps: ['code_review'] },
  { name, steps: ['pr_open', 'pr_review', 'resolve_merge', 'merge_blocked'] },
];
const entry = (step, status = 'done') => ({ step, status, type: 'agent', agents: [{ agent: step, provider: 'claude', cost: 1, durationMs: 1000 }] });
const COMMIT = 'abc1234def567890abc1234def567890abc12345';
const pipeline = (name, opts) => require('../run-progress-model').pipeline({ steps: STEPS, groups: groups(name), mode: 'auto', ...opts });
const TRAIL = [entry('develop'), entry('code_review')];

test('#792 a run that merged: the last station is done with its commit, under any of the PR names', () => {
  const lasts = ['Abrir PR', 'Open PR', 'Pull request'].map((name) => pipeline(name, { status: 'success', progress: TRAIL, merged: COMMIT }).at(-1));
  assert.deepEqual(lasts.map((st) => [st.name, st.state, st.merged]), [
    ['Abrir PR', 'done', COMMIT],
    ['Open PR', 'done', COMMIT],
    ['Pull request', 'done', COMMIT],
  ]);
});

test('#792 a run that merged: only the last station carries the commit', () => {
  const list = pipeline('Pull request', { status: 'success', progress: TRAIL, merged: COMMIT });
  assert.deepEqual(list.map((st) => [st.name, st.merged ?? null]), [['Develop', null], ['Review', null], ['Pull request', COMMIT]]);
});

test('#792 a PR not merged yet (merged null, a run that ended before the station): the station is not done and carries no commit', () => {
  const last = pipeline('Pull request', { status: 'success', progress: TRAIL, merged: null }).at(-1);
  assert.deepEqual([last.state === 'done', last.merged ?? null], [false, null]);
});

test('#792 a run at work on its PR (merged null): the station says so and carries no commit', () => {
  const last = pipeline('Pull request', { status: 'running', progress: [...TRAIL, entry('pr_open', 'running')], merged: null }).at(-1);
  assert.deepEqual([last.state, last.merged ?? null], ['running', null]);
});
