// apps/desktop/renderer/default-workflow.js: the default development workflow (#195). resolve() picks the
// file among the workspace's workflows; mergeOf() reads how a loaded workflow's work lands (used by
// packages/engine/service/areas/workflows.js to label each entry local/remote/none).
const test = require('node:test');
const assert = require('node:assert/strict');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');

// ---- resolve(setting, files) --------------------------------------------------------------------

test('resolve: the saved setting wins when it names a workflow that still exists', () => {
  const out = DefaultWorkflow.resolve('software-development.yaml', ['feature.yaml', 'software-development.yaml']);
  assert.deepEqual(out, { file: 'software-development.yaml', missing: null });
});

test('resolve: unset falls back to the local workflow when the workspace has it', () => {
  const out = DefaultWorkflow.resolve(null, ['software-development.yaml', 'feature.yaml', 'issue-tracker.yaml']);
  assert.deepEqual(out, { file: 'feature.yaml', missing: null });
});

// #630: the GitHub workflow is feature's Remote mode, the same file: an old saved name resolves to it
test('resolve: a saved old workflow name resolves through its alias', () => {
  const out = DefaultWorkflow.resolve('software-development.yaml', ['issue-tracker.yaml', 'feature.yaml']);
  assert.deepEqual(out, { file: 'feature.yaml', missing: null });
});

test('resolve: unset and neither the local nor the GitHub workflow exists falls back to the first workflow listed', () => {
  const out = DefaultWorkflow.resolve(null, ['custom-flow.yaml', 'another.yaml']);
  assert.deepEqual(out, { file: 'custom-flow.yaml', missing: null });
});

test('resolve: a saved workflow that no longer exists reports it missing and falls back the same way as unset', () => {
  const out = DefaultWorkflow.resolve('deleted-workflow.yaml', ['software-development.yaml', 'feature.yaml']);
  assert.deepEqual(out, { file: 'feature.yaml', missing: 'deleted-workflow.yaml' });
});

test('resolve: an empty (or missing) workflow list falls back to the local workflow\'s name, even though it is not actually in the list', () => {
  assert.deepEqual(DefaultWorkflow.resolve(null, []), { file: 'feature.yaml', missing: null });
  assert.deepEqual(DefaultWorkflow.resolve(null, undefined), { file: 'feature.yaml', missing: null });
});

// ---- mergeOf(wf) ---------------------------------------------------------------------------------

test('mergeOf: no worktree at all (the workflow never checks anything out) is "none"', () => {
  assert.equal(DefaultWorkflow.mergeOf({ orchestrator: {}, steps: [] }), 'none');
  assert.equal(DefaultWorkflow.mergeOf({}), 'none');
});

test('mergeOf: orchestrator.worktree.remote: false is "local" (merged into the local base, never pushed)', () => {
  const wf = { orchestrator: { worktree: { repo: '.', base: 'main', remote: false } }, steps: [] };
  assert.equal(DefaultWorkflow.mergeOf(wf), 'local');
});

test('mergeOf: a step transition with merge: local is "local", even with a remote-capable worktree', () => {
  const wf = {
    orchestrator: { worktree: { repo: '.', base: 'main' } },
    steps: [{ id: 'gate', transitions: [{ when: 'approved', merge: 'local', goto: 'end' }] }],
  };
  assert.equal(DefaultWorkflow.mergeOf(wf), 'local');
});

test('mergeOf: a worktree with metadata.merges: false and no local transition is "none" (it never merges)', () => {
  const wf = { orchestrator: { worktree: { repo: '.', base: 'main' } }, steps: [], metadata: { merges: false } };
  assert.equal(DefaultWorkflow.mergeOf(wf), 'none');
});

test('mergeOf: an ordinary worktree workflow (no local override, merges not disabled) is "remote" (a branch and a PR/MR)', () => {
  const wf = { orchestrator: { worktree: { repo: '.', base: 'main' } }, steps: [{ id: 'gate', transitions: [{ when: 'approved', goto: 'end' }] }] };
  assert.equal(DefaultWorkflow.mergeOf(wf), 'remote');
});
