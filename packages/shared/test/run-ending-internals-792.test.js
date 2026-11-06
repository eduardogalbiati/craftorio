// #792: the rules under the card's badge and last station: DefaultWorkflow.ending, RunProgress.endingGroups
// and which station a merged commit lands on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ending } = require('../default-workflow');
const { OPEN_PR, endingGroups, pipeline } = require('../run-progress-model');

const MODE = { mode: { enum: ['local', 'remote', 'fork'], default: 'local' } };
const engine = (tree) => ({ orchestrator: { worktree: tree }, steps: [] });

test('#792 ending reads a workflow in the engine\'s shape and in the workflows:list summary', () => {
  assert.equal(ending(engine({ repo: 'r' }), {}), 'pr');
  assert.equal(ending(engine({ repo: 'r', remote: false }), {}), 'local');
  assert.equal(ending({ merge: 'remote' }, {}), 'pr');
  assert.equal(ending({ merge: 'local' }, {}), 'local');
});

test('#792 ending: nothing for a workflow that does not merge, or that is not known', () => {
  assert.equal(ending({ merge: 'none' }, {}), null);
  assert.equal(ending({ ...engine({ repo: 'r' }), metadata: { merges: false } }, {}), null);
  assert.equal(ending({}, {}), null);
  assert.equal(ending(undefined, {}), null);
});

test('#792 ending follows the mode of a workflow that has local | remote | fork, its default without one', () => {
  const wf = { merge: 'local', inputs: MODE };
  assert.deepEqual([{ mode: 'remote' }, { mode: 'fork' }, { mode: 'local' }, {}, null, { mode: 'auto' }].map((i) => ending(wf, i)), ['pr', 'fork', 'local', 'local', 'local', 'local']);
  assert.equal(ending({ merge: 'local', inputs: { mode: { ...MODE.mode, default: 'remote' } } }, {}), 'pr');
});

test('#792 ending: a `mode` that only names the validation leaves the workflow\'s merge to decide', () => {
  assert.equal(ending({ merge: 'remote', inputs: { mode: { enum: ['auto', 'validated'] } } }, { mode: 'validated' }), 'pr');
});

test('#792 endingGroups renames the Merge group for a PR or a fork, and nothing else', () => {
  const groups = [{ name: 'Review', steps: ['a'] }, { name: 'Merge', steps: ['b'] }];
  assert.deepEqual(['pr', 'fork'].map((e) => endingGroups(groups, e).map((g) => g.name)), [['Review', OPEN_PR], ['Review', OPEN_PR]]);
  assert.equal(endingGroups(groups, 'local'), groups);
  assert.equal(endingGroups(groups, null), groups);
  assert.deepEqual(groups.map((g) => g.name), ['Review', 'Merge']);
  assert.deepEqual(endingGroups(undefined, 'pr'), []);
});

const merged = (groups, steps) => pipeline({ steps: steps.map((id) => ({ id, type: 'agent' })), groups, status: 'success', merged: 'abc1234' }).filter((st) => st.merged).map((st) => st.name);

test('#792 a merged commit lands on a custom Merge group renamed for a PR, whatever its steps', () => {
  assert.deepEqual(merged(endingGroups([{ name: 'Merge', steps: ['ship'] }], 'pr'), ['ship']), [OPEN_PR]);
});

test('#792 a merged commit does not land on a Review group that only holds merge_blocked (write-doc)', () => {
  assert.deepEqual(merged([{ name: 'Review', steps: ['review', 'merge_blocked'] }], ['review', 'merge_blocked']), []);
});
