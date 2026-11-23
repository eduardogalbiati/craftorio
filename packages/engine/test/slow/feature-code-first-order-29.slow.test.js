// workflows/feature.yaml (#29): the `test_order` input decides who goes first. Code first (the
// local-code variant): the developer codes first and the test writer writes the acceptance tests
// after the code. E2E first (the default): the acceptance tests and the red check come before develop.
// Whole mock runs on a git repository in a temp folder (docs/agents/testing/simulated-runs.md).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { repoFromTemplate } = require('../helpers/git-fixture');
const { runUntilStall } = require('../helpers/run-watch');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a copy of the template repository (src/app.js on main), then the run's branch
function makeRepo(t) {
  const dir = repoFromTemplate(t);
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of the workflow (copied from ai-development-local-hero.slow.test.js, lean inputs):
// gates get their first choice; returns the transitions 'from>to' and the ordered step visits.
async function runFeature(t, { mockSequences = {}, inputs = {} } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-29-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await runUntilStall(run, { stallMs: 15000 });
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  // the steps in the order they were visited: the first step's `from`, then every `to`
  const visits = transitions.length ? [transitions[0].split('>')[0], ...transitions.map((x) => x.split('>')[1])] : [];
  return { events, transitions, visits, finished: events.find((e) => e.type === 'workflow.finished') };
}

describe('feature.yaml test order (#29)', { concurrency: true }, () => {
  test('#29 code first: develop runs before the test writer writes the acceptance tests', { timeout: 300000 }, async (t) => {
    // the red check (if the wiring keeps one after the tests) and the suite pass: the code already exists
    const { visits, transitions, finished } = await runFeature(t, {
      inputs: { test_order: 'code_first' },
      mockSequences: { suite: { red_check: ['pass', 'pass', 'pass'], suite: ['pass'] } },
    });
    assert.equal(finished.status, 'success', finished.error);
    const develop = visits.indexOf('develop');
    const tests = visits.indexOf('acceptance_tests');
    assert.ok(develop >= 0, `develop runs (visits: ${visits.join(', ')})`);
    assert.ok(tests >= 0, `acceptance_tests runs (visits: ${visits.join(', ')})`);
    assert.ok(develop < tests, `develop (visit ${develop}) comes before acceptance_tests (visit ${tests}): ${transitions.join(' ')}`);
    const red = visits.indexOf('red_check');
    assert.ok(red === -1 || red > develop, `red_check does not run before develop: ${transitions.join(' ')}`);
  });

  test('#29 E2E first (unchanged): the acceptance tests and the red check run before develop', { timeout: 300000 }, async (t) => {
    const { visits, transitions, finished } = await runFeature(t, {
      inputs: { test_order: 'e2e_first' },
      mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } },
    });
    assert.equal(finished.status, 'success', finished.error);
    const develop = visits.indexOf('develop');
    assert.ok(develop >= 0, 'develop runs');
    assert.ok(visits.indexOf('acceptance_tests') >= 0 && visits.indexOf('acceptance_tests') < develop, `acceptance_tests before develop: ${transitions.join(' ')}`);
    assert.ok(visits.indexOf('red_check') >= 0 && visits.indexOf('red_check') < develop, `red_check before develop: ${transitions.join(' ')}`);
    assert.deepEqual(transitions.slice(0, 3), ['acceptance_tests>red_check', 'red_check>warm_up', 'warm_up>develop']);
  });
});
