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
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'refactor.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository on main with one production file and one existing test, and the run's branch checked out
function makeRepo(t) {
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
  return dir;
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) { const found = findFile(full, name); if (found) return found; }
  }
  return null;
}

// A mock run of the workflow; `onTurn(repo, n)` plays the developer's side effects before its n-th
// refactor turn. Gates get their first choice.
async function runRefactor(t, { mockSequences = {}, onTurn, inputs = {} } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Split the click handler', target: 'src/app.js', repo_path: repo, ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
    if (ev.type === 'session.message_sent' && ev.step_id === 'refactor' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const visited = transitions.map((x) => x.split('>')[0]);
  return { events, transitions, visited, finished: events.find((e) => e.type === 'workflow.finished'), repo, runsDir };
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
  // the pinned file is the one the pin step reports (the mock's placeholder name)
  const pinned = '(simulated) tests_added';
  const { events, finished } = await runRefactor(t, {
    mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, pinned), 'changed by the developer\n');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'refactor: change the pinned test');
      }
      if (n === 2) {
        git(repo, 'rm', '-q', pinned);
        git(repo, 'commit', '-q', '-m', 'put the pinned test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused' && e.step_id === 'refactor');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0].files, [pinned]);
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
  const { finished, runsDir } = await runRefactor(t, { mockSequences: { suite: { green_check: ['pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  const file = findFile(runsDir, 'summary.json');
  assert.ok(file, 'summary.json written');
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(summary.workflow, 'refactor');
  assert.ok(summary.outputs && 'before' in summary.outputs && 'after' in summary.outputs, JSON.stringify(summary.outputs));
  assert.equal(typeof summary.cost_usd, 'number');
});
