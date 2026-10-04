// Run costs (#233), internal details next to the acceptance tests of test/run-costs.test.js:
// src/run-costs.js reading old runs (a new CLI session in the same engine session, failures before
// the CLI ran, the session a stopped attempt belongs to), parseClaude on a total below the previous
// one, and the engine's killed attempt without a price for its model ("cost not recorded").
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { correctSessions, runCosts } = require('../src/run-costs');
const { parseClaude } = require('../src/engine/providers');
const { WorkflowRun } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const at = (min) => new Date(Date.parse('2026-09-20T10:00:00.000Z') + min * 60e3).toISOString();
const received = (min, turn, cost, cli) => ({
  ts: at(min), type: 'session.message_received', session_id: 's1', turn, step_id: 'work', cost_usd: cost,
  session: { id: 's1', agent: 'developer', provider: 'claude', provider_session_id: cli },
});

test('runCosts: a turn in a new CLI session (another provider_session_id) keeps its recorded cost', () => {
  const costs = runCosts([received(1, 1, 2, 'cli-a'), received(2, 2, 3, 'cli-a'), received(3, 3, 1.5, 'cli-b')]);
  assert.deepEqual([...costs.overcount], [['s1', 2]], 'only turn 2 counted turn 1 again');
  assert.equal(costs.overcountUsd, 2);
});

test('runCosts: a run with cost_accounting per_turn is read as recorded', () => {
  const costs = runCosts([{ ts: at(0), type: 'workflow.started', cost_accounting: 'per_turn' }, received(1, 1, 2, 'cli-a'), received(2, 2, 3, 'cli-a'),
    { ts: at(3), type: 'log', level: 'error', message: '[developer] attempt 1/2 failed: Timed out after 60s (US$ 0.10, estimated from 3 model calls)' }]);
  assert.equal(costs.overcountUsd, 0);
  assert.equal(costs.stopped.length, 0, 'its stopped attempts have their own events');
});

test('runCosts: an old run\'s failure before the CLI ran is not a cost "not recorded"', () => {
  const costs = runCosts([
    { ts: at(1), type: 'log', level: 'error', message: '[developer] attempt 1/2 failed: Command "claude" not found in PATH.' },
    { ts: at(2), type: 'log', level: 'error', message: '[developer] attempt 2/2 failed: Timed out after 1800s' },
  ]);
  assert.deepEqual(costs.stopped.map((x) => [x.agent, x.notRecorded]), [['developer', true]]);
});

test('correctSessions: an old run\'s stopped attempt flags the agent\'s session open at that time only', () => {
  const costs = runCosts([{ ts: at(30), type: 'log', level: 'error', message: '[developer] attempt 1/2 failed: Timed out after 1800s' }]);
  const sessions = [
    { id: 's1', agent: 'developer', opened_at: at(0), closed_at: at(10), cost_usd: 1 },
    { id: 's2', agent: 'developer', opened_at: at(10), closed_at: at(40), cost_usd: 2 },
    { id: 's3', agent: 'reviewer', opened_at: at(0), closed_at: null, cost_usd: 3 },
  ];
  assert.deepEqual(correctSessions(sessions, costs).map((s) => !!s.cost_not_recorded), [false, true, false]);
});

test('parseClaude: a total below the session\'s previous one (a new count) is taken whole', () => {
  const sid = `sess-${crypto.randomUUID()}`;
  const turn = (total) => {
    const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId: sid, error: null };
    parseClaude({ type: 'result', subtype: 'success', session_id: sid, result: 'ok', total_cost_usd: total, usage: {} }, () => {}, acc);
    return acc.costUsd;
  };
  assert.equal(turn(2), 2);
  assert.equal(turn(2.5), 0.5);
  assert.equal(turn(0.4), 0.4);
});

test('engine: a killed attempt without a price for its model is "cost not recorded", not a zero cost', { timeout: 60000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-costs-int-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'attempt-timeout.yaml'), inputs: {}, mock: true, runsDir, mockSequences: { timeouts: { work: 1 } } });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const log = events.find((e) => e.type === 'log' && /attempt 1\/2 failed/.test(e.message));
  assert.match(log.message, /\(cost not recorded: no price for mock-model, 2 model calls\)/);
  const stopped = events.find((e) => e.type === 'session.attempt_stopped');
  assert.equal(stopped.cost_usd, null);
  assert.equal(stopped.cost_not_recorded, true);
  assert.equal(finished.summary.sessions.find((s) => s.agent === 'a').cost_not_recorded, true);
  assert.equal(finished.summary.cost_accounting, 'per_turn');
});
