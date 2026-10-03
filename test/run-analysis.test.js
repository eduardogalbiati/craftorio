// src/run-analysis.js (#228): one run in depth for Analytics' Run tab (and the roadmap estimates),
// from the run's summary.json and events.jsonl, and its comparison with the other runs of the same
// workflow. Seams: runFigures({ summary, events }), compareWithWorkflow(figures, history).
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFigures, compareWithWorkflow } = require('../src/run-analysis');

const T0 = Date.parse('2026-10-03T14:00:00.000Z');
const MIN = 60e3;
const ts = (m) => new Date(T0 + m * MIN).toISOString();
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);

const usage = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write, reasoning: 0 });
const turn = (m, session_id, turnNo, step_id, cost_usd, u, durationMin, activeMin, waitingMin) => ({
  ts: ts(m), type: 'session.message_received', session_id, turn: turnNo, step_id, text: 'done', usage: u, cost_usd,
  duration_ms: durationMin * MIN, active_ms: activeMin * MIN, waiting_ms: waitingMin * MIN, stalled_ms: 0,
});
const toolCall = (m, session_id, id, command) => ({ ts: ts(m), type: 'session.stream', session_id, turn: 1, item: { kind: 'tool_call', id, name: 'Bash', input: { command } } });
const toolResult = (m, session_id, id) => ({ ts: ts(m), type: 'session.stream', session_id, turn: 1, item: { kind: 'tool_result', id, output: 'ok', is_error: false } });
const suiteOut = (round, status, failures, preexisting) => ({ kind: 'suite', status, round, duration_ms: 4 * MIN, failures, preexisting });

// A recorded AI Development run (#215 + #216): acceptance tests (test_writer), develop (developer, two
// visits), the suite twice (a machine step, run by the orchestrator), then 30 min at the "approve" gate.
// 0-5 tests · 5-20 develop · 20-24 suite (1 failure) · 24-29 develop · 29-33 suite (pass) · 33-63 gate.
const EVENTS = [
  { ts: ts(0), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', issues: [215, 216], mock: false },
  { ts: ts(0), type: 'step.started', step_id: 'tests', visit: 1, step_type: 'agent', agent: 'test_writer' },
  toolCall(1, 's1', 'c1', 'npm test -- test/a.test.js'),
  toolResult(3, 's1', 'c1'),
  turn(5, 's1', 1, 'tests', 1, usage(1000, 500, 8000, 500), 5, 3, 2),
  { ts: ts(5), type: 'step.finished', step_id: 'tests', visit: 1, duration_ms: 5 * MIN },
  { ts: ts(5), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
  toolCall(6, 's2', 'c2', 'npm run build'),
  toolResult(10, 's2', 'c2'),
  turn(15, 's2', 1, 'develop', 3, usage(200000, 20000, 700000, 80000), 10, 7, 3),
  turn(20, 's2', 2, 'develop', 1, usage(50000, 10000, 400000, 40000), 5, 4, 1),
  { ts: ts(20), type: 'step.finished', step_id: 'develop', visit: 1, duration_ms: 15 * MIN },
  { ts: ts(20), type: 'step.started', step_id: 'suite', visit: 1, step_type: 'suite', agent: '' },
  { ts: ts(24), type: 'step.finished', step_id: 'suite', visit: 1, duration_ms: 4 * MIN, output: suiteOut(1, 'fail', [{ test: 'adds', file: 'test/a.test.js' }], [{ test: 'old', file: 'test/b.test.js' }]) },
  { ts: ts(24), type: 'step.started', step_id: 'develop', visit: 2, step_type: 'agent', agent: 'developer' },
  turn(29, 's2', 3, 'develop', 1, usage(50000, 10000, 400000, 40000), 5, 5, 0),
  { ts: ts(29), type: 'step.finished', step_id: 'develop', visit: 2, duration_ms: 5 * MIN },
  { ts: ts(29), type: 'step.started', step_id: 'suite', visit: 2, step_type: 'suite', agent: '' },
  { ts: ts(33), type: 'step.finished', step_id: 'suite', visit: 2, duration_ms: 4 * MIN, output: suiteOut(2, 'pass', [], [{ test: 'old', file: 'test/b.test.js' }]) },
  { ts: ts(33), type: 'approval.requested', approval_id: 'a1', step_id: 'approve', message: 'Merge?' },
  { ts: ts(63), type: 'approval.resolved', approval_id: 'a1', step_id: 'approve', approved: true, by: 'user', wait_ms: 30 * MIN },
  { ts: ts(63), type: 'workflow.finished', status: 'success' },
];

const SUMMARY = {
  run_id: 'r-now', workflow: 'AI Development', status: 'success', mock: false, issues: [215, 216],
  started_at: ts(0), finished_at: ts(63), duration_ms: 63 * MIN, cost_usd: 6,
  tokens: usage(301000, 40500, 1508000, 160500),
  timing: {
    duration_ms: 63 * MIN, gate_wait_ms: 30 * MIN, gates: { approve: { waits: 1, wait_ms: 30 * MIN } },
    steps: { tests: { turns: 1, duration_ms: 5 * MIN, active_ms: 3 * MIN, waiting_ms: 2 * MIN, stalled_ms: 0 }, develop: { turns: 3, duration_ms: 20 * MIN, active_ms: 16 * MIN, waiting_ms: 4 * MIN, stalled_ms: 0 } },
  },
  steps: { tests: { visits: 1 }, develop: { visits: 2 }, suite: { visits: 2 }, approve: { visits: 1 } },
  sessions: [
    { id: 's1', agent: 'test_writer', step_id: 'tests', turns: 1, cost_usd: 1, tokens: usage(1000, 500, 8000, 500), active_ms: 3 * MIN },
    { id: 's2', agent: 'developer', step_id: 'develop', turns: 3, cost_usd: 5, tokens: usage(300000, 40000, 1500000, 160000), active_ms: 16 * MIN },
  ],
};

const figures = () => runFigures({ summary: SUMMARY, events: EVENTS });
const agent = (f, name) => f.agents.find((a) => a.agent === name);

test('runFigures: the run header: workflow, issues, total cost, duration, active vs waiting at gates', () => {
  const f = figures();
  assert.equal(f.workflow, 'AI Development');
  assert.deepEqual(f.issues, [215, 216]);
  assert.equal(f.status, 'success');
  near(f.costUsd, 6, 'total cost');
  near(f.costPerIssue, 3, 'cost per issue');
  assert.equal(f.durationMs, 63 * MIN);
  assert.equal(f.gateWaitMs, 30 * MIN);
});

test('runFigures: per agent, turns, cost, time active vs waiting on tools', () => {
  const f = figures();
  const dev = agent(f, 'developer');
  const tw = agent(f, 'test_writer');
  assert.equal(dev.turns, 3);
  assert.equal(tw.turns, 1);
  near(dev.costUsd, 5, 'developer cost');
  near(tw.costUsd, 1, 'test writer cost');
  assert.equal(dev.activeMs, 16 * MIN);
  assert.equal(dev.waitingMs, 4 * MIN);
  assert.equal(tw.activeMs, 3 * MIN);
  assert.equal(tw.waitingMs, 2 * MIN);
});

test('runFigures: per agent tokens split into new input, output, cache read and cache creation, and the effective $/M tokens', () => {
  const dev = agent(figures(), 'developer');
  assert.equal(dev.tokens.input, 300000);
  assert.equal(dev.tokens.output, 40000);
  assert.equal(dev.tokens.cache_read, 1500000);
  assert.equal(dev.tokens.cache_write, 160000);
  near(dev.usdPerMTokens, 2.5, 'developer $/M tokens'); // $5 for 2,000,000 tokens
  near(agent(figures(), 'test_writer').usdPerMTokens, 100, 'test writer $/M tokens'); // $1 for 10,000 tokens
});

test('runFigures: per step visits and total duration', () => {
  const steps = Object.fromEntries(figures().steps.map((s) => [s.step, s]));
  assert.equal(steps.develop.visits, 2);
  assert.equal(steps.develop.durationMs, 20 * MIN);
  assert.equal(steps.suite.visits, 2);
  assert.equal(steps.suite.durationMs, 8 * MIN);
  assert.equal(steps.tests.visits, 1);
});

test('runFigures: the suite rounds with their duration, failures and pre-existing failures', () => {
  const rounds = figures().suiteRounds;
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map((r) => [r.round, r.durationMs, r.failures, r.preexisting]), [[1, 4 * MIN, 1, 1], [2, 4 * MIN, 0, 1]]);
});

test('runFigures: the gate waits with the gate name', () => {
  const gates = figures().gates;
  assert.equal(gates.length, 1);
  assert.equal(gates[0].gate, 'approve');
  assert.equal(gates[0].waitMs, 30 * MIN);
});

test('runFigures: the slowest tool calls, slowest first, with command and time', () => {
  const tools = figures().slowestTools;
  assert.ok(tools.length <= 10);
  assert.deepEqual(tools.map((x) => [x.command, x.durationMs]), [['npm run build', 4 * MIN], ['npm test -- test/a.test.js', 2 * MIN]]);
});

test('runFigures: the timeline has one row per agent and machine steps (suite) on the orchestrator row', () => {
  const bars = figures().timeline;
  const of = (step) => bars.filter((b) => b.step === step);
  assert.equal(of('develop').length, 2);
  assert.ok(of('develop').every((b) => b.row === 'developer'));
  assert.ok(of('tests').every((b) => b.row === 'test_writer'));
  assert.equal(of('suite').length, 2);
  assert.ok(of('suite').every((b) => b.row === 'orchestrator'));
});

// ---- compareWithWorkflow -------------------------------------------------------------------------

const past = (runId, costUsd, durationMin, devCost, extra = {}) => ({
  runId, workflow: 'AI Development', status: 'success', mock: false, startedAt: ts(-1000 + durationMin),
  costUsd, durationMs: durationMin * MIN, costPerIssue: costUsd, issues: [1],
  agents: [{ agent: 'developer', costUsd: devCost, activeMs: durationMin * MIN / 2 }],
  ...extra,
});
const HISTORY = [
  past('h1', 2, 40, 1), past('h2', 4, 50, 2), past('h3', 6, 60, 3), past('h4', 8, 70, 4), past('h5', 10, 80, 5),
  past('failed', 100, 500, 50, { status: 'failed' }),
  past('other-wf', 100, 500, 50, { workflow: 'Software Development' }),
  past('simulated', 100, 500, 50, { mock: true }),
];
const NOW_RUN = past('r-now', 9, 30, 5, { costPerIssue: 9 });

test('compareWithWorkflow: compares only with real successful runs of the same workflow, and says how many', () => {
  const cmp = compareWithWorkflow(NOW_RUN, [...HISTORY, NOW_RUN]);
  assert.equal(cmp.count, 5);
  assert.equal(cmp.tooFew, false);
});

test('compareWithWorkflow: median and p25-p75 per figure, marked worse or better with the difference', () => {
  const cmp = compareWithWorkflow(NOW_RUN, HISTORY);
  const cost = cmp.metrics.costUsd;
  assert.equal(cost.median, 6);
  assert.equal(cost.p25, 4);
  assert.equal(cost.p75, 8);
  assert.equal(cost.verdict, 'worse');
  near(cost.diff, 3, 'cost difference');
  near(cost.diffPct, 50, 'cost difference %');

  const duration = cmp.metrics.durationMs;
  assert.equal(duration.median, 60 * MIN);
  assert.equal(duration.verdict, 'better');
  near(duration.diff, -30 * MIN, 'duration difference');
});

test('compareWithWorkflow: each agent\'s cost against the same agent in the other runs', () => {
  const dev = compareWithWorkflow(NOW_RUN, HISTORY).agents.developer;
  assert.equal(dev.costUsd.median, 3);
  assert.equal(dev.costUsd.verdict, 'worse');
});

test('compareWithWorkflow: too few runs of the workflow is reported, not compared', () => {
  const cmp = compareWithWorkflow(NOW_RUN, HISTORY.slice(0, 2));
  assert.equal(cmp.count, 2);
  assert.equal(cmp.tooFew, true);
});
