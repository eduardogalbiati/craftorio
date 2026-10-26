// #614: the Merge station is done on a run that merged cleanly. RunProgress.pipeline marks a station
// the run never entered `skipped` once it is over; a clean merge (no resolve_merge, no merge_blocked)
// never enters the Merge group, so the card drew Merge as "not run" although the run merged.
// Acceptance tests written before the code.
//
// Interface assumed (the option's name is this test's choice): pipeline({ ..., merged }) where
// `merged` is the merged commit (a string; null / absent: the run did not merge). With it the
// station of the group named Merge is `done`, whether or not the run entered one of its steps; the
// other stations, a run that did not merge and a workflow without a Merge group draw as before.
// The groups are the ones of workflows/ai-development-local-hero.yaml, shortened to the steps used here.
const test = require('node:test');
const assert = require('node:assert/strict');

const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'code_review', type: 'agent', agent: 'reviewer' },
  { id: 'test', type: 'agent', agent: 'tester' },
  { id: 'resolve_merge', type: 'agent', agent: 'developer' },
  { id: 'merge_blocked', type: 'human_approval' },
];
const GROUPS = [
  { name: 'Develop', steps: ['develop'] },
  { name: 'Review', steps: ['code_review'] },
  { name: 'Validate', steps: ['test'] },
  { name: 'Merge', steps: ['resolve_merge', 'merge_blocked'] },
];
const entry = (step, status = 'done') => ({ step, status, type: 'agent', agents: [{ agent: step, provider: 'claude', cost: 1, durationMs: 1000 }] });
const COMMIT = 'abc1234def567890abc1234def567890abc12345';
const pipeline = (opts) => require('../run-progress-model').pipeline({ steps: STEPS, groups: GROUPS, mode: 'auto', ...opts });
const mergeState = (list) => list.find((st) => st.name === 'Merge')?.state;

test('#614 a run that merged cleanly (never entered the Merge group): the Merge station is done', () => {
  const list = pipeline({ status: 'success', progress: [entry('develop'), entry('code_review'), entry('test')], merged: COMMIT });
  assert.equal(mergeState(list), 'done');
});

test('#614 a run that merged after resolve_merge: the Merge station is done', () => {
  const list = pipeline({ status: 'success', progress: [entry('develop'), entry('code_review'), entry('test'), entry('resolve_merge')], merged: COMMIT });
  assert.equal(mergeState(list), 'done');
});

test('#614 a run that failed before merging: the Merge station is not done', () => {
  const list = pipeline({ status: 'failed', progress: [entry('develop'), entry('test', 'failed')], merged: null });
  assert.notEqual(mergeState(list), 'done');
});

test('#614 a run that succeeded without merging (merge_blocked, no merged commit) keeps today\'s Merge state', () => {
  const list = pipeline({ status: 'success', progress: [entry('develop'), entry('code_review'), entry('test')] });
  assert.equal(mergeState(list), 'skipped');
});

test('#614 a running run: the Merge station is still to come (todo)', () => {
  const list = pipeline({ status: 'running', progress: [entry('develop'), entry('code_review', 'running')], merged: null });
  assert.equal(mergeState(list), 'todo');
});

test('#614 a workflow without a Merge group draws the same with or without a merged commit', () => {
  const { pipeline: raw } = require('../run-progress-model');
  const groups = GROUPS.filter((g) => g.name !== 'Merge');
  const steps = STEPS.filter((s) => !['resolve_merge', 'merge_blocked'].includes(s.id));
  const opts = { steps, groups, mode: 'auto', status: 'success', progress: [entry('develop'), entry('code_review'), entry('test')] };
  assert.deepEqual(raw({ ...opts, merged: COMMIT }).map((st) => `${st.name}:${st.state}`), raw(opts).map((st) => `${st.name}:${st.state}`));
});
