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

// A run built but not started: its sessions and stopped attempts are driven directly, the way a real
// (non-mock) turn reaches them (a mock run never prices a CLI error result nor checks budgets).
function idleRun(opts = {}) {
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'attempt-timeout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(), ...opts });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  const session = run.openSession({ agent: 'a', provider: 'claude', model: 'm', stepId: 'work' });
  return { run, events, session };
}
const stoppedError = (message, partial) => Object.assign(new Error(message), { partial });

test('countStoppedAttempt: an error result that reported its cost counts that cost, not an estimate', () => {
  const { run, events, session } = idleRun({ prices: { m: { input: 1000, output: 1000 } } });
  const { costUsd, note } = run.countStoppedAttempt({ session, agent: { model: 'm' }, stepId: 'work', turn: 1, attempt: 1 },
    stoppedError('Claude reported an error', { usage: { input: 10, output: 5 }, costUsd: 0.42, modelCalls: 3 }));
  assert.equal(costUsd, 0.42);
  assert.equal(note, ' (US$ 0.42)');
  const stopped = events.find((e) => e.type === 'session.attempt_stopped');
  assert.equal(stopped.cost_usd, 0.42);
  assert.equal(stopped.estimated, false);
  assert.equal(stopped.session.cost_usd, 0.42);
  assert.equal(stopped.session.estimated_cost_usd, undefined, 'a reported cost is not estimated');
  assert.equal(stopped.session.tokens.input, 10, 'its tokens are counted in the session');
});

test('countStoppedAttempt: an attempt with no model call and no cost (failed before the CLI ran) counts nothing', () => {
  const { run, events, session } = idleRun({ prices: { m: { input: 1000 } } });
  const res = run.countStoppedAttempt({ session, agent: { model: 'm' }, stepId: 'work', turn: 1, attempt: 1 },
    stoppedError('Command "claude" not found in PATH.', { usage: null, costUsd: null, modelCalls: 0 }));
  assert.deepEqual(res, { costUsd: 0, note: '' });
  assert.equal(events.some((e) => e.type === 'session.attempt_stopped'), false);
  assert.equal(session.costUsd, 0);
});

test('checkBudget: the provider budget sees the estimated cost of a stopped attempt', () => {
  // US$ 1 per million input tokens: 9 M tokens = US$ 9 of a US$ 10 budget
  const { run, events, session } = idleRun({
    prices: { m: { input: 1, output: 1 } },
    budget: { claude: { name: 'Claude Code', limitUsd: 10, usedUsd: 0, blockOnLimit: true } },
  });
  run.checkBudget('claude');
  assert.equal(events.some((e) => e.type === 'log' && /monthly budget/.test(e.message)), false, 'nothing spent yet');
  run.countStoppedAttempt({ session, agent: { model: 'm' }, stepId: 'work', turn: 1, attempt: 1 },
    stoppedError('Timed out after 1800s', { usage: { input: 9e6 }, costUsd: null, modelCalls: 359 }));
  run.checkBudget('claude');
  assert.ok(events.some((e) => e.type === 'log' && /90% of its monthly budget \(\$9\.00 of \$10\)/.test(e.message)));
  run.countStoppedAttempt({ session, agent: { model: 'm' }, stepId: 'work', turn: 1, attempt: 2 },
    stoppedError('Timed out after 1800s', { usage: { input: 2e6 }, costUsd: null, modelCalls: 40 }));
  assert.throws(() => run.checkBudget('claude'), /Monthly budget for Claude Code reached \(\$11\.00 of \$10\)/);
});
