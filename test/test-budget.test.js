// #101: the test step must fit its time budget on grouped runs, and a failure that already exists
// on the base is reported, not chased inside an unrelated run.
// Seams: WorkflowRun#turnTimeout (defaults.timeout template + clamp), WorkflowRun#notePreexistingFailures
// (via a full mock run's events and summary), attemptSummary (a killed attempt's tool calls for the retry).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, attemptSummary } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

// An agent's fully resolved options: what the engine builds before every turn (workflow.js's own
// `{ ...defaults, ...agent }` merge), so turnTimeout sees the same object invokeTurn does.
function resolvedAgent(run, agentName) {
  return { ...(run.wf.defaults || {}), ...run.wf.agents[agentName] };
}

function makeGroupedRun(issues, runsDir, file = 'software-development-local-hero.yaml') {
  return new WorkflowRun({
    file: path.join(root, 'workflows', file),
    inputs: { task: 'Fix things', repo_path: root, issues },
    mock: true,
    runsDir,
  });
}

test('turnTimeout grows with the number of issues of a grouped run, clamped at 60m (#101)', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const timeoutFor = (n, file) => {
    const issues = Array.from({ length: n }, (_, i) => `https://github.com/o/r/issues/${i + 1}`);
    const run = makeGroupedRun(issues, runsDir, file);
    return run.turnTimeout(resolvedAgent(run, 'test_writer'));
  };
  // 30m + 10m per extra issue, capped at 60m
  assert.equal(timeoutFor(1), 30 * 60e3);
  assert.equal(timeoutFor(3), 50 * 60e3);
  assert.equal(timeoutFor(5), 60 * 60e3);
  assert.equal(timeoutFor(8), 60 * 60e3); // still capped

  // the same expression is used by software-development.yaml (not only the local-hero variant)
  assert.equal(timeoutFor(3, 'software-development.yaml'), 50 * 60e3);
});

test('turnTimeout: an agent\'s own plain timeout wins over defaults, and an explicit null falls back to the 30m engine default', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'timeout-budget.yaml'), inputs: {}, mock: true, runsDir });
  assert.equal(run.turnTimeout(resolvedAgent(run, 'inherits_default')), 45 * 60e3);
  assert.equal(run.turnTimeout(resolvedAgent(run, 'own_timeout')), 20 * 60e3);
  assert.equal(run.turnTimeout(resolvedAgent(run, 'no_timeout')), 30 * 60e3);
});

test('a step reporting preexisting_failures passes, the run continues, and a duplicate across steps is not listed twice (#101)', { timeout: 60000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'preexisting-failures.yaml'),
    inputs: {},
    mock: true,
    runsDir,
    mockSequences: { preexisting_failures: true },
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();

  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const testSteps = events.filter((e) => e.type === 'step.finished' && (e.step_id === 'test' || e.step_id === 'test_again'));
  assert.equal(testSteps.length, 2);
  assert.ok(testSteps.every((e) => !e.error), 'preexisting_failures does not fail the step');

  const expected = { step: 'test', test: '(simulated) test', file: 'src/auth/login.ts', reason: '(simulated) reason' };
  const warns = events.filter((e) => e.type === 'log' && e.kind === 'preexisting_failures');
  assert.equal(warns.length, 1, 'the 2nd step reports the same failure, which is a duplicate, not a new warning');
  assert.equal(warns[0].level, 'warn');
  assert.equal(warns[0].step_id, 'test');
  assert.deepEqual(warns[0].failures, [expected]);
  assert.match(warns[0].message, /also failing on the base, not chased in this run/);

  assert.deepEqual(finished.summary.preexisting_failures, [expected]);
});

test('attemptSummary lists a killed attempt\'s tool calls (with results, or "still running" for none) and the error', () => {
  const calls = new Map([
    ['t1', { name: 'Bash', input: { command: 'npm test' }, result: { output: 'Tests: 42 passed', is_error: false } }],
    ['t2', { name: 'Bash', input: { command: 'node --test test/service.test.js' } }], // killed mid-flight: no result
  ]);
  const err = new Error('Timed out after 1800s');
  const summary = attemptSummary(calls, err, 1);
  assert.match(summary, /^<previous_attempt>/);
  assert.match(summary, /attempt 1.*Timed out after 1800s/s);
  assert.match(summary, /Bash: npm test → Tests: 42 passed/);
  assert.match(summary, /Bash: node --test test\/service\.test\.js → no result: still running when the attempt stopped/);
  assert.match(summary, /do not re-orient from `git status`/);
});

test('a turn killed at its timeout retries with the attempt summary, and the retry succeeds (#101)', { timeout: 60000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'attempt-timeout.yaml'),
    inputs: {},
    mock: true,
    runsDir,
    mockSequences: { timeouts: { work: 1 } }, // the 1st attempt of "work" is killed
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();

  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const errorLog = events.find((e) => e.type === 'log' && e.level === 'error' && /attempt 1\/2 failed/.test(e.message));
  assert.ok(errorLog, 'the 1st attempt is logged as failed');
  const summaryLog = events.find((e) => e.type === 'log' && e.kind === 'attempt_summary');
  assert.ok(summaryLog, 'the 2nd attempt starts with the summary of the 1st');
  assert.equal(summaryLog.step_id, 'work');
  assert.ok(summaryLog.tool_calls >= 1);
  assert.match(summaryLog.message, /attempt 2 starts with the summary of attempt 1/);
});
