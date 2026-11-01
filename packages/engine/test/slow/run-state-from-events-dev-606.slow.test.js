// #606 acceptance: a run's resume state is a pure function of its event log, for the bundled
// development workflows (they work on a repository). Same check as run-state-from-events-606.slow.test.js:
// runStateFromEvents over the recorded events.jsonl (and summary.json) gives the state the
// WorkflowRun held in memory. The seam is described in test/run-state-606.js.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { root, liveState, replayState, recordedRun } = require('../run-state-606');

const bundled = (name) => path.join(root, 'workflows', name);
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository on main with one production file, the run's branch checked out
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-606-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

function assertReplayMatches(run) {
  const live = liveState(run);
  assert.deepEqual(replayState(run, live), live);
}

test('software-development: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('software-development.yaml'), inputs: { task: 'Engine test', repo_path: root }, mockSequences: { preview_status: ['success'] } });
  assertReplayMatches(run);
});

test('software-development-local-hero: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('feature.yaml'), inputs: { task: 'Engine test', repo_path: root } });
  assertReplayMatches(run);
});

test('ai-development-local-hero: the replay of its mock run gives the in-memory state, vars included', async (t) => {
  const run = await recordedRun(t, {
    file: bundled('feature.yaml'),
    inputs: { task: 'Add the feature', repo_path: makeRepo(t), unit_tests: 'run_existing', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] } },
  });
  assertReplayMatches(run);
});

test('test-batch: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('test-backfill.yaml'), inputs: { repo_path: root } });
  assertReplayMatches(run);
});

test('e2e-release: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('release.yaml'), inputs: { task: 'Release check', repo_path: root }, mockSequences: { verdict: ['approved'], suite: { e2e: ['fail', 'pass'] } } });
  assertReplayMatches(run);
});
