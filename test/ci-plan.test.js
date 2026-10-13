// scripts/ci-plan.js: which runners CI uses per event, and when preview/deploy may skip the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planOs, alreadyTested, testedStatus, testedStatusBody } = require('../scripts/ci-plan');

test('planOs: a PR runs on ubuntu and windows, not macOS', () => {
  assert.deepEqual(planOs({ event: 'pull_request', files: ['src/engine/workflow.js', 'test/engine.test.js'] }),
    ['ubuntu-latest', 'windows-latest']);
});

test('planOs: a PR touching a platform-sensitive path also runs on macOS', () => {
  for (const file of ['src/engine/worktree.js', 'scripts/package.js', 'package-lock.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(planOs({ event: 'pull_request', files: ['README.md', file] }),
      ['ubuntu-latest', 'windows-latest', 'macos-latest'], file);
  }
});

test('planOs: the ci:macos label adds macOS to a PR', () => {
  assert.deepEqual(planOs({ event: 'pull_request', files: ['src/main.js'], labels: ['bug', 'ci:macos'] }),
    ['ubuntu-latest', 'windows-latest', 'macos-latest']);
});

test('planOs: a docs-only PR runs no tests', () => {
  assert.deepEqual(planOs({ event: 'pull_request', files: ['README.md', 'docs/guide/Setup.MD'] }), []);
});

test('planOs: docs the tests read are not docs-only', () => {
  for (const file of [
    'CLAUDE.md', 'AGENTS.md', 'docs/agents/testing.md', 'docs/agents/decisions.md', 'skills/code-review/SKILL.md', 'skills/code-review/rules/js.md',
    'docs/features/software-development.md', 'docs/screens/backlog.md',
  ]) {
    assert.deepEqual(planOs({ event: 'pull_request', files: ['README.md', file] }), ['ubuntu-latest', 'windows-latest'], file);
  }
});

test('#341 planOs: every file of the cargo workspace (native/**) is code, its Markdown too', () => {
  for (const file of ['native/Cargo.toml', 'native/Cargo.lock', 'native/multiagent-mcp/src/main.rs', 'native/multiagent-mcp/README.md', 'native/README.md']) {
    const os = planOs({ event: 'pull_request', files: ['README.md', file] });
    assert.ok(os.includes('ubuntu-latest') && os.includes('windows-latest'), `${file}: ${JSON.stringify(os)}`);
  }
});

test('planOs: a PR that changes only AGENTS.md runs the tests, like CLAUDE.md (its size cap and links are tested, #331)', () => {
  assert.deepEqual(planOs({ event: 'pull_request', files: ['AGENTS.md'] }), ['ubuntu-latest', 'windows-latest']);
});

test('planOs: a PR whose file list is unknown runs the tests', () => {
  assert.deepEqual(planOs({ event: 'pull_request', files: [] }), ['ubuntu-latest', 'windows-latest']);
});

test('planOs: the weekly schedule runs macOS only, a manual run every OS', () => {
  assert.deepEqual(planOs({ event: 'schedule' }), ['macos-latest']);
  assert.deepEqual(planOs({ event: 'workflow_dispatch' }), ['ubuntu-latest', 'windows-latest', 'macos-latest']);
});

test('alreadyTested: a commit whose test check passed is tested', () => {
  assert.equal(alreadyTested({ testConclusion: 'success' }), true);
  for (const c of ['failure', 'cancelled', '', undefined]) assert.equal(alreadyTested({ testConclusion: c }), false, String(c));
});

test('alreadyTested: a merge result is tested only with the same tree as the tested PR head', () => {
  assert.equal(alreadyTested({ testConclusion: 'success', tree: 'abc', testedTree: 'abc' }), true);
  assert.equal(alreadyTested({ testConclusion: 'success', tree: 'abc', testedTree: 'def' }), false);
  assert.equal(alreadyTested({ testConclusion: 'success', tree: '', testedTree: '' }), false);
  assert.equal(alreadyTested({ testConclusion: 'failure', tree: 'abc', testedTree: 'abc' }), false);
});

test('testedStatus: reads the latest ci/tested status and the tree it names', () => {
  const tree = 'a'.repeat(40);
  const statuses = [
    { context: 'preview', state: 'success', description: `tree ${'b'.repeat(40)}` },
    { context: 'ci/tested', state: 'success', description: `CI passed on tree ${tree}` },
    { context: 'ci/tested', state: 'failure', description: 'older' },
  ];
  assert.deepEqual(testedStatus(statuses), { state: 'success', tree });
});

test('testedStatus: a head CI never marked has no state and no tree', () => {
  assert.deepEqual(testedStatus([{ context: 'test', state: 'success' }]), { state: '', tree: '' });
  assert.deepEqual(testedStatus([]), { state: '', tree: '' });
  assert.deepEqual(testedStatus([{ context: 'ci/tested', state: 'success', description: 'CI passed' }]), { state: 'success', tree: '' });
});

test('testedStatusBody: a run marks the head pending, then passed or failed, with the tree', () => {
  const tree = 'e'.repeat(40);
  assert.deepEqual(testedStatusBody('pending', tree), { state: 'pending', context: 'ci/tested', description: `CI running on tree ${tree}` });
  assert.deepEqual(testedStatusBody('success', tree), { state: 'success', context: 'ci/tested', description: `CI passed on tree ${tree}` });
  assert.deepEqual(testedStatusBody('failure', tree), { state: 'failure', context: 'ci/tested', description: `CI failed on tree ${tree}` });
  assert.equal(testedStatusBody('cancelled', tree).state, 'failure');
});

test('a head whose latest CI run is running or failed is not tested, even after an older success', () => {
  const tree = 'f'.repeat(40);
  const older = testedStatusBody('success', tree);
  for (const latest of ['pending', 'failure']) {
    const s = testedStatus([testedStatusBody(latest, tree), older]); // the API lists the newest first
    assert.equal(s.tree, tree);
    assert.equal(alreadyTested({ testConclusion: s.state }), false, latest);
    assert.equal(alreadyTested({ testConclusion: s.state, tree, testedTree: s.tree }), false, latest);
  }
  assert.equal(alreadyTested({ testConclusion: testedStatus([older]).state }), true);
});

test('a PR merged with the tree its CI tested skips the tests; merged after main moved, it does not', () => {
  const tested = testedStatus([{ context: 'ci/tested', state: 'success', description: `CI passed on tree ${'c'.repeat(40)}` }]);
  assert.equal(alreadyTested({ testConclusion: tested.state, tree: 'c'.repeat(40), testedTree: tested.tree }), true);
  assert.equal(alreadyTested({ testConclusion: tested.state, tree: 'd'.repeat(40), testedTree: tested.tree }), false);
  const unmarked = testedStatus([]);
  assert.equal(alreadyTested({ testConclusion: unmarked.state, tree: 'c'.repeat(40), testedTree: unmarked.tree }), false);
});
