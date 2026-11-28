// #130 workflows/refactor.yaml in Remote mode, a whole mock run: the characterization and the review as in
// Local, then the pull-request half (fragments/pr-pipeline.yaml: push, PR/MR, CI, PR monitor) instead of the
// local merge. One Local run beside it checks the local merge is still the ending there (the runs of
// refactor-workflow-355.slow.test.js check its success, not how it lands). Acceptance tests, written before
// the code: the workflow is loaded inside each run.
// Repositories in a temp folder (with a bare `origin`, so Remote has somewhere to fetch from); gates get
// their first choice (approved), as with --auto-approve.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { runUntilStall } = require('../helpers/run-watch');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'refactor.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// the file the pin step reports (the mock's placeholder name for tests_added)
const PINNED = '(simulated) tests_added';

// a repository on main (pushed to a bare origin) with one production file and one test, the run's branch
// checked out with the pinned test committed, as a real test writer commits it
function makeRepo(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-130-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const origin = path.join(tmp, 'origin.git');
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(dir);
  git(tmp, 'init', '-q', '--bare', origin);
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'app.test.js'), "require('node:test');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'switch', '-q', '-c', 'feat');
  fs.writeFileSync(path.join(dir, PINNED), "require('node:test');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pin the behaviour');
  return { dir, tmp };
}

async function runRefactor(t, inputs) {
  const { dir, tmp } = makeRepo(t);
  const runsDir = path.join(tmp, 'runs');
  fs.mkdirSync(runsDir);
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Split the click handler', target: 'src/app.js', repo_path: dir, check_command: 'node --version', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { green_check: ['pass'], suite: ['pass'] } },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = (ev.choices || []).length ? ev.choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user'));
    }
  });
  await runUntilStall(run, { stallMs: 15000 });
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  return { events, transitions, visited: transitions.map((x) => x.split('>')[0]), finished: events.find((e) => e.type === 'workflow.finished') };
}

test.describe('#130 refactor.yaml whole mock runs, by mode', { concurrency: true }, () => {
  test('#130 refactor.yaml (remote): an approved refactor pins, reviews, then goes to the PR (ci, pr_monitor), never merged locally', { timeout: 180000 }, async (t) => {
    const { transitions, visited, finished } = await runRefactor(t, { mode: 'remote' });
    assert.equal(finished?.status, 'success', `${finished?.error || ''} ${transitions.join(' ')}`);
    assert.deepEqual(transitions.slice(0, 2), ['pin_behaviour>green_check', 'green_check>refactor']);
    assert.equal(transitions.includes('review>ci'), true, transitions.join(' '));
    assert.deepEqual(transitions.slice(-2), ['ci>pr_monitor', 'pr_monitor>end']);
    assert.equal(visited.indexOf('review') < visited.indexOf('ci'), true, transitions.join(' '));
    assert.equal(finished.summary?.local_merge ?? null, null, 'no local merge in remote mode');
  });

  test('#130 refactor.yaml (local): an approved refactor still ends with the local merge, no PR step', { timeout: 180000 }, async (t) => {
    const { transitions, visited, finished } = await runRefactor(t, { mode: 'local' });
    assert.equal(finished?.status, 'success', `${finished?.error || ''} ${transitions.join(' ')}`);
    assert.equal(transitions.at(-1), 'review>end', transitions.join(' '));
    assert.deepEqual(['ci', 'pr_monitor'].filter((id) => visited.includes(id)), []);
  });
});
