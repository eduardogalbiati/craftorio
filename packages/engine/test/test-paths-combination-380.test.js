// #380 internals of packages/engine/engine/test-paths.js `changedTestFiles`: a rebase resolution that drops a line
// one side added is still a change, and a test file left unmerged in the rebase is not the agent's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const testPaths = require('../engine/test-paths');

const FILE = 'features/a.feature';
const BASE = 'Feature: A\n  Scenario: one\n    Given one\n';
const MAIN_SIDE = '  Scenario: from main\n    Given the other run\n';
const BRANCH_SIDE = '  Scenario: from the branch\n    Given this run\n';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'core.editor=true', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(dir, message, text) {
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), text);
  git(dir, 'add', FILE);
  git(dir, 'commit', '-q', '-m', message);
}

// `feat` and main both appended a scenario to FILE; `feat` is checked out and its snapshot taken
async function conflicting(t, base = BASE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-380-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  commit(dir, 'base', base);
  git(dir, 'switch', '-q', '-c', 'feat');
  commit(dir, 'branch', BASE + BRANCH_SIDE);
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main', BASE + MAIN_SIDE);
  git(dir, 'switch', '-q', 'feat');
  const snap = await testPaths.snapshot(dir, [FILE]);
  assert.throws(() => git(dir, 'rebase', 'main'));
  return { dir, snap };
}

const check = (snap) => testPaths.changedTestFiles(snap, { bases: ['refs/heads/main'] });

test('#380 changedTestFiles: a resolution that drops a line the branch added is still a change', async (t) => {
  const { dir, snap } = await conflicting(t);
  fs.writeFileSync(path.join(dir, FILE), BASE + MAIN_SIDE + '  Scenario: from the branch\n');
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), [FILE]);
});

test('#380 changedTestFiles: a test file left unmerged in the rebase is not counted', async (t) => {
  const { snap } = await conflicting(t);
  assert.deepEqual(await check(snap), []);
});

test('#380 changedTestFiles: a pure combination in the other order is accepted', async (t) => {
  const { dir, snap } = await conflicting(t);
  fs.writeFileSync(path.join(dir, FILE), BASE + BRANCH_SIDE + MAIN_SIDE);
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), []);
});

test('#380 changedTestFiles: a resolution that drops a line both sides kept from the base is still a change', async (t) => {
  const { dir, snap } = await conflicting(t);
  fs.writeFileSync(path.join(dir, FILE), (BASE + MAIN_SIDE + BRANCH_SIDE).replace('    Given one\n', ''));
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), [FILE]);
});

test('#380 changedTestFiles: a base without a trailing newline does not refuse a pure combination', async (t) => {
  const { dir, snap } = await conflicting(t, BASE.trimEnd());
  fs.writeFileSync(path.join(dir, FILE), BASE + MAIN_SIDE + BRANCH_SIDE);
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), []);
});

test('#380 changedTestFiles: a snapshot taken inside the rebase compares with the rebase\'s original head', async (t) => {
  const { dir } = await conflicting(t);
  const snap = await testPaths.snapshot(dir, [FILE]);
  fs.writeFileSync(path.join(dir, FILE), BASE + MAIN_SIDE + BRANCH_SIDE);
  git(dir, 'add', FILE);
  assert.deepEqual(await check(snap), []);
});

// A second resolve_merge visit (after the test writer's turn, or a later commit of the branch that
// conflicts again) starts inside the rebase and ends with `git rebase --continue`: the rebase's
// original head is gone by the check, and the branch's side must still be the branch's.
test('#380 changedTestFiles: a snapshot taken inside the rebase accepts a pure combination committed with rebase --continue', async (t) => {
  const { dir } = await conflicting(t);
  const snap = await testPaths.snapshot(dir, [FILE]);
  fs.writeFileSync(path.join(dir, FILE), BASE + MAIN_SIDE + BRANCH_SIDE);
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), []);
});

test('#380 changedTestFiles: a snapshot taken inside the rebase still refuses a new line committed with rebase --continue', async (t) => {
  const { dir } = await conflicting(t);
  const snap = await testPaths.snapshot(dir, [FILE]);
  fs.writeFileSync(path.join(dir, FILE), BASE + MAIN_SIDE + BRANCH_SIDE + '    And a step neither side wrote\n');
  git(dir, 'add', FILE);
  git(dir, 'rebase', '--continue');
  assert.deepEqual(await check(snap), [FILE]);
});
