// #396: workflows/feature.yaml with the owner's policy `suite_red_outside_change`.
// Whole mock runs (docs/agents/testing.md: a new transition suite → build and a new way a run is
// recorded): with `continue`, a suite red only outside the change goes on to build and the local
// merge without opening test_failed, and the run's summary.json says it was not tested green; a
// failure in the change still opens test_failed, and the owner's Continue there is recorded the same way.
// The simulated suite: mockSequences.suite.suite `outside` = a failing test in a file outside the
// change whose base rerun passes (assumed name of the new simulated result); `fail` = the failing
// test/simulated.test.js, which the simulated import graph puts in the change (machine-actions.js).
// The definition test (the input, its default) is in test/suite-red-outside-change-396.test.js; the
// routing and classification edges are in test/suite-outside-change-396.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { repoFromTemplate } = require('../helpers/git-fixture');
const { Recorder } = require('../../engine/recorder');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// #737: a copy of the template repository (src/app.js on main), then the run's branch
function makeRepo(t) {
  const dir = repoFromTemplate(t);
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run, recorded as the app records it (a Recorder writes summary.json). Gates get their
// first choice (test_failed: "Continue to the build anyway").
async function runLocalHero(t, { suite, inputs = {} }) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-396-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite } },
  });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices?.length ? ev.choices[0].id : true, 'user'));
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const promptsOf = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  const gates = events.filter((e) => e.type === 'approval.requested').map((e) => e.step_id);
  const summary = JSON.parse(fs.readFileSync(path.join(run.runDir, 'summary.json'), 'utf8'));
  return { transitions, promptsOf, gates, summary, finished: events.find((e) => e.type === 'workflow.finished') };
}

// the summary's own record of the run (not the steps' outputs, the sessions or the trail)
const ownRecord = (summary) => {
  const { steps, sessions, progress, groups, ...rest } = summary;
  return JSON.stringify(rest);
};

test('#396 local hero, policy continue: a suite red only outside the change goes to build and the merge without test_failed; summary.json says not tested green', { timeout: 120000 }, async (t) => {
  const { transitions, promptsOf, gates, summary, finished } = await runLocalHero(t, { suite: ['outside'], inputs: { suite_red_outside_change: 'continue' } });
  assert.equal(finished.status, 'success', finished.error);
  // the suite really was red (the simulated `outside` result), its failures all outside the change
  const suiteOut = summary.steps.suite.output;
  assert.equal(suiteOut.status, 'fail', `the last suite round is red: ${suiteOut.message}`);
  assert.ok(suiteOut.failures.length > 0 && suiteOut.failures.every((f) => f.class === 'outside the change'), JSON.stringify(suiteOut.failures));
  assert.ok(!gates.includes('test_failed'), `test_failed never opens: gates ${gates.join(', ')}`);
  assert.ok(transitions.includes('suite>build'), `the suite goes on to build: ${transitions.join(', ')}`);
  assert.ok(!transitions.includes('suite>test_failed'), transitions.join(', '));
  // #630: the local merge is pushed to main before the end (verify_change → push_main → end)
  assert.equal(transitions[transitions.length - 1], 'push_main>end', 'the run reaches the local merge (push_main → end)');
  assert.equal(summary.tested, 'not green');
  assert.match(ownRecord(summary), /outside the change/, 'the summary records the failures with their class');
  const [build] = promptsOf('build');
  assert.match(build, /not tested green/i, 'the build prompt says the change is not tested green');
  assert.match(build, /outside the change/, 'the build prompt gets the failures with their class');
  const [verify] = promptsOf('verify_change');
  assert.match(verify, /not tested green/i, 'the verify prompt says the change is not tested green');
  assert.match(verify, /outside the change/, 'the verify prompt gets the failures with their class');
});

test('#396 local hero, policy continue with the issue\'s scenarios on: a suite red only outside the change goes through e2e to build, still not tested green; tested_failures names the suite\'s failures only', { timeout: 120000 }, async (t) => {
  const { transitions, gates, summary, finished } = await runLocalHero(t, { suite: ['outside'], inputs: { suite_red_outside_change: 'continue', e2e_tests: 'write_and_run' } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(summary.steps.acceptance_tests.output.e2e_scope, 'scenarios', 'the simulated acceptance tests wrote scenarios');
  assert.ok(transitions.includes('suite>e2e'), `the suite goes on to e2e: ${transitions.join(', ')}`);
  assert.ok(!gates.includes('test_failed'), `test_failed never opens: gates ${gates.join(', ')}`);
  assert.equal(summary.tested, 'not green', 'a green e2e after the policy does not clear not tested green');
  assert.ok(summary.tested_failures.length > 0, 'the suite\'s failures are recorded');
  assert.deepEqual([...new Set(summary.tested_failures.map((f) => f.step))], ['suite'], `only the suite step's failures (not red_check's expected red): ${JSON.stringify(summary.tested_failures)}`);
  assert.ok(summary.tested_failures.every((f) => f.class === 'outside the change'), JSON.stringify(summary.tested_failures));
});

test('#396 local hero, policy continue: a failure in the change still opens test_failed;the owner\'s Continue is recorded as not tested green', { timeout: 120000 }, async (t) => {
  const { transitions, gates, summary, finished } = await runLocalHero(t, { suite: ['fail'], inputs: { suite_red_outside_change: 'continue' } });
  assert.ok(summary.steps.suite.output.failures.some((f) => f.class === 'in the change'), JSON.stringify(summary.steps.suite.output.failures));
  assert.ok(gates.includes('test_failed'), `test_failed opens for a failure in the change: gates ${gates.join(', ')}`);
  assert.ok(transitions.includes('suite>test_failed'), transitions.join(', '));
  assert.ok(transitions.includes('test_failed>build'), 'the owner\'s Continue goes on to build');
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(summary.tested, 'not green');
  assert.match(ownRecord(summary), /in the change/, 'the summary records the failure with its class');
});
