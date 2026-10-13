// workflows/refactor.yaml (#355): whole mock runs of the Refactor workflow (pin the behaviour, green
// check, refactor, gates, review), on a git repository in a temp folder so the developer's turn can
// change files; the mock writes no real code. The cheaper checks are in test/refactor-workflow-355.test.js.
// The workflow file is written after these tests (tests first): each run loads it inside its test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
const { Recorder } = require('../../src/engine/recorder');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'refactor.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// the file the pin step reports (the mock's placeholder name for tests_added)
const PINNED = '(simulated) tests_added';

// a repository on main with one production file and one existing test, and the run's branch checked out;
// `pinned`: the pinned test the mock test writer reports is on the branch, as a real test writer commits it
function makeRepo(t, { pinned = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'app.test.js'), "require('node:test');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  if (pinned) {
    fs.writeFileSync(path.join(dir, PINNED), "require('node:test');\n");
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'pin the behaviour');
  }
  return dir;
}

// A mock run of the workflow, recorded as the app records it (a Recorder writes summary.json);
// `onTurn(repo, n)` plays the developer's side effects before its n-th refactor turn. Gates get their
// first choice, except the ones `reject` names (their last choice).
async function runRefactor(t, { mockSequences = {}, onTurn, inputs = {}, pinned = true, reject = [] } = {}) {
  const repo = makeRepo(t, { pinned });
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Split the click handler', target: 'src/app.js', repo_path: repo, ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const choice = reject.includes(ev.step_id) ? ev.choices[ev.choices.length - 1] : ev.choices[0];
      setImmediate(() => run.resolveApproval(ev.approval_id, choice.id, 'user'));
    }
    if (ev.type === 'session.message_sent' && ev.step_id === 'refactor' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const visited = transitions.map((x) => x.split('>')[0]);
  return { events, transitions, visited, finished: events.find((e) => e.type === 'workflow.finished'), repo, runDir: run.runDir };
}

test('refactor workflow: a mock run pins the behaviour, checks it is green, refactors, runs the gates and the review, and succeeds', { timeout: 120000 }, async (t) => {
  const { transitions, visited, finished } = await runRefactor(t, { mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 2), ['pin_behaviour>green_check', 'green_check>refactor']);
  for (const id of ['refactor', 'review']) assert.ok(visited.includes(id), `${id} in ${transitions.join(', ')}`);
  assert.ok(visited.indexOf('refactor') < visited.indexOf('review'));
});

test('refactor workflow: a pinned test that fails on the unchanged code goes back to the test writer before any refactor', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runRefactor(t, { mockSequences: { suite: { green_check: ['fail', 'pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 4), ['pin_behaviour>green_check', 'green_check>pin_behaviour', 'pin_behaviour>green_check', 'green_check>refactor']);
});

test('refactor workflow: a refactor turn that edits a pinned test is refused', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runRefactor(t, {
    mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, PINNED), 'changed by the developer\n');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'refactor: change the pinned test');
      }
      if (n === 2) {
        git(repo, 'checkout', '-q', 'HEAD~1', '--', PINNED);
        git(repo, 'commit', '-q', '-m', 'put the pinned test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused' && e.step_id === 'refactor');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0].files, [PINNED]);
});

test('refactor workflow: a green check whose pinned files are not in the worktree never goes on to the refactor', { timeout: 120000 }, async (t) => {
  // the pin step reports a test file it never wrote: a check of zero files proves nothing
  const { transitions, visited, finished } = await runRefactor(t, {
    pinned: false,
    reject: ['pin_failed'],
    mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } },
  });
  assert.equal(transitions.includes('green_check>refactor'), false, transitions.join(', '));
  assert.equal(visited.includes('refactor'), false, transitions.join(', '));
  assert.equal(finished.status, 'failed', transitions.join(', '));
});

test('refactor workflow: structure only, a refactor turn that edits an existing test is refused too', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runRefactor(t, {
    mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, 'test', 'app.test.js'), "require('node:test'); // weakened\n");
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'refactor: edit an existing test');
      }
      if (n === 2) {
        git(repo, 'checkout', '-q', 'main', '--', 'test/app.test.js');
        git(repo, 'commit', '-q', '-m', 'put the existing test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused' && e.step_id === 'refactor');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0].files, ['test/app.test.js']);
});

test('refactor workflow: summary.json records the target\'s before/after figures and the run\'s cost', { timeout: 120000 }, async (t) => {
  const { finished, runDir } = await runRefactor(t, { mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'success');
  assert.equal(summary.workflow, 'refactor');
  for (const side of ['before', 'after']) {
    assert.equal(typeof summary.outputs?.[side], 'object', side);
    assert.equal(typeof summary.outputs[side].lines, 'number', `${side}.lines`);
    assert.equal(typeof summary.outputs[side].files_touched, 'number', `${side}.files_touched`);
  }
  assert.equal(typeof summary.cost_usd, 'number');
});
