// workflows/test-batch.yaml (#203): writes the tests a run skipped (unit_tests: off/run_existing,
// e2e_tests: off) for a range of local commits in one test writer session, then the orchestrator
// runs the whole suite once per round (#177, src/engine/suite-step.js), merging locally when green.
// These are engine-level mock runs, the way test/engine.test.js checks software-development.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

async function runTestBatch({ mockSequences, answers = {}, inputs = {}, issues } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'test-batch.yaml'),
    inputs: { repo_path: root, ...inputs },
    mock: true,
    runsDir,
    mockSequences,
    issues,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const a = answers[ev.step_id];
      const answer = a ?? (ev.choices ? ev.choices[0].id : true);
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user'));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished, transitions };
}

const GROUP = [12, 34].map((n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `T${n}` }));

test('test-batch: a production-code failure delegates to the developer once, then the suite passes and merges after the owner approves', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runTestBatch({
    issues: GROUP, inputs: { issues: GROUP.map((i) => i.url) },
    mockSequences: { tests_status: ['fail', 'pass'], suite: { suite: ['pass'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['test>test', 'test>suite', 'suite>approve_fixes', 'approve_fixes>end']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'test delegated to developer'));
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'approve_fixes');
  assert.match(gate.message, /after the developer changed production code/);
  assert.equal(finished.summary.outputs.suite_status, 'pass');
});

test('test-batch: a suite that never passes exhausts max_rounds and stops at tests_failed; rejecting ends the run failed', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runTestBatch({
    inputs: { max_rounds: 2 },
    mockSequences: { tests_status: ['pass'], suite: { suite: ['fail'] } },
    answers: { tests_failed: false },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "tests_failed"/);
  assert.ok(transitions.includes('suite>tests_failed'), transitions.join(' '));
  assert.ok(!transitions.includes('suite>approve_fixes'));
});

test('test-batch: a green suite with no production fix merges straight away, no approval gate', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runTestBatch({
    mockSequences: { tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['test>suite', 'suite>end']);
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'approve_fixes'));
});

test('test-batch: a suite that cannot run (no test command) goes straight to tests_failed', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runTestBatch({
    mockSequences: { tests_status: ['pass'], suite: { suite: ['blocked'] } },
    answers: { tests_failed: false },
  });
  assert.deepEqual(transitions, ['test>suite', 'suite>tests_failed', 'tests_failed>end']);
  assert.equal(finished.status, 'failed');
});
