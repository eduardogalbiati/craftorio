// #606: a run's resume state is a pure function of its event log, for the other bundled workflows
// that work on a repository (project map, refactor proposals, multi-model review, refactor, release).
// Same check as run-state-from-events-606.slow.test.js: runStateFromEvents over the recorded
// events.jsonl (and summary.json) gives the state the WorkflowRun held in memory. The seam is
// described in test/run-state-606.js.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { root, readLog, liveState, replayState, recordedRun } = require('../run-state-606');
const projects = require('../../domains/project/projects');

const bundled = (name) => path.join(root, 'workflows', name);
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// a repository on main with a manifest, a production file and a test, tagged v1.0.0, then one more
// commit; `branch`: that branch checked out
function makeRepo(t, { branch } = {}) {
  const dir = tmp(t, 'run-state-606-repo-');
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "fixture", "version": "1.0.0", "scripts": { "test": "node --test" } }\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'app.test.js'), "require('node:test');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', 'v1.0.0');
  fs.writeFileSync(path.join(dir, 'src', 'changed.js'), 'module.exports = function changed(a, b) { return a ? b : a; };\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'after the release');
  if (branch) git(dir, 'switch', '-q', '-c', branch);
  return dir;
}

// a project for `repo` in a temp workspace: the run's options (runs in <ws>/runs)
async function projectOptions(t, repo) {
  const ws = tmp(t, 'run-state-606-ws-');
  const runsDir = path.join(ws, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const project = await projects.createProject(path.join(ws, 'projects'), { name: 'run-state-606', folder: repo });
  return { project, options: { runsDir, projectId: project.id } };
}

function assertReplayMatches(run) {
  const live = liveState(run);
  assert.deepEqual(replayState(run, live), live);
  return live;
}

test('project-map: the replay of its mock run gives the in-memory state', async (t) => {
  const repo = makeRepo(t);
  const { project, options } = await projectOptions(t, repo);
  const run = await recordedRun(t, { file: bundled('analyze-project.yaml'), inputs: { repo_path: repo, project_id: project.id, mode: 'validated' }, options });
  assertReplayMatches(run);
});

test('refactor-proposals: the replay of its mock run gives the in-memory state', async (t) => {
  const repo = makeRepo(t);
  const { project, options } = await projectOptions(t, repo);
  const run = await recordedRun(t, { file: bundled('analyze-project.yaml'), inputs: { repo_path: repo, project_id: project.id, mode: 'validated', since: 'v1.0.0' }, options });
  assertReplayMatches(run);
});

test('multi-model-review: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, { file: bundled('feature.yaml'), inputs: { task: 'Review the branch', repo_path: makeRepo(t, { branch: 'feat' }), branch: 'feat', review: 'multi_model' } });
  assertReplayMatches(run);
});

test('refactor: the replay of its mock run gives the in-memory state', async (t) => {
  const run = await recordedRun(t, {
    file: bundled('refactor.yaml'),
    inputs: { task: 'Split the click handler', target: 'src/app.js', repo_path: makeRepo(t, { branch: 'feat' }) },
    mockSequences: { verdict: ['approved'], suite: { green_check: ['pass'], suite: ['pass'] } },
  });
  assertReplayMatches(run);
});

test('release: the replay of its mock run gives the in-memory state, the red suite it set included', async (t) => {
  const repo = makeRepo(t);
  const run = await recordedRun(t, {
    file: bundled('release.yaml'),
    inputs: { task: 'Release v1.0', repo_path: repo, project_path: repo },
    mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } },
    // never ship from a test: the run ends at the ship gate, held
    answers: { ship: 'hold' },
  });
  const sets = readLog(run.runDir).events.filter((ev) => ev.type === 'step.transition' && ev.set).map((ev) => ev.set);
  assert.ok(sets.some((s) => s.red_suite === 'unit'), `the failed unit suite set red_suite: ${JSON.stringify(sets)}`);
  const live = assertReplayMatches(run);
  assert.equal(live.vars.red_suite, 'unit');
});
