// Runs already recorded with the #277 bug (packages/engine/domains/run/run-costs.js): a Claude turn that used sub-agents
// streamed two `usage` items (one per `result` event), the first with the turn's cost and the second
// with 0, and session.message_received recorded cost_usd 0. For a run with cost_accounting
// 'per_turn', a turn recorded with less than an earlier usage item of the same turn costs the highest
// cost among its session.stream usage items: in runCosts' turnCost, Analytics (runFigures) and the
// run list (readRun). events.jsonl is never rewritten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCosts } = require('../../domains/run/run-costs');
const { runFigures } = require('../../domains/run/run-analysis');
const runs = require('../../domains/run/runs');

const near = (actual, expected, msg) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);

const T0 = Date.parse('2026-10-03T16:40:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const snap = (turns, cost, tokens) => ({
  id: 's1', agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', effort: null, parent_id: 'orchestrator', step_id: 'implement',
  opened_at: at(0), closed_at: null, duration_ms: 0, active_ms: 0, idle_ms: 0, turns, tokens, cost_usd: cost, status: 'idle',
  provider_session_id: 'cli-277', cwd: 'C:/repo', mode: 'persistent',
});
const zero = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
const big = { input: 102, output: 84376, cache_read: 7714400, cache_write: 198504, reasoning: 0 };
const small = { input: 22, output: 18805, cache_read: 1203311, cache_write: 40211, reasoning: 0 };
const usageItem = (ts, turn, usage, costUsd) => ({ ts, type: 'session.stream', session_id: 's1', turn, item: { kind: 'usage', usage, costUsd } });

// One persistent Claude session; each turn: [step, streamed usage costs, recorded cost_usd]
function recordedRun(turns) {
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-277', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Task' }, cost_accounting: 'per_turn' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap(0, 0, zero) },
  ];
  let total = 0;
  let sec = 0;
  turns.forEach(([step, streamed, recorded], i) => {
    const n = i + 1;
    total += recorded;
    events.push({ ts: at(sec += 1), type: 'step.started', step_id: step, visit: 1, step_type: 'agent', agent: 'developer' });
    events.push({ ts: at(sec += 1), type: 'session.message_sent', session_id: 's1', turn: n, step_id: step, prompt: 'do it' });
    const ts = at(sec += 60);
    streamed.forEach((c, k) => events.push(usageItem(ts, n, k === 0 ? big : small, c)));
    events.push({ ts, type: 'session.message_received', session_id: 's1', turn: n, step_id: step, text: 'done', usage: small, cost_usd: recorded,
      duration_ms: 60e3, active_ms: 60e3, waiting_ms: 0, stalled_ms: 0, session: snap(n, total, small) });
    events.push({ ts, type: 'step.finished', step_id: step, visit: 1, duration_ms: 61e3, output: {} });
  });
  const summary = {
    run_id: 'r-277', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(sec), duration_ms: sec * 1000,
    inputs: { task: 'Task' }, tokens: small, cost_usd: total, cost_accounting: 'per_turn', sessions: [{ ...snap(turns.length, total, small), status: 'success' }],
  };
  events.push({ ts: at(sec), type: 'session.closed', session_id: 's1', status: 'success', session: snap(turns.length, total, small) });
  events.push({ ts: at(sec), type: 'workflow.finished', status: 'success', error: null, summary });
  return { events, summary };
}

function writeRun(t, events, summary) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-277-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = path.join(runsDir, 'r-277');
  fs.mkdirSync(dir);
  const eventsText = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'events.jsonl'), eventsText);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { runsDir, dir, eventsText };
}

const receivedOf = (events, turn) => events.find((e) => e.type === 'session.message_received' && e.turn === turn);

test('a recorded turn with cost_usd 0 after usage items of 15.123904 then 0 costs 15.123904', () => {
  const { events, summary } = recordedRun([['implement', [15.123904, 0], 0]]);
  near(runCosts(events, summary).turnCost(receivedOf(events, 1)), 15.123904, 'turnCost');
});

test('a recorded turn whose cost_usd is lower than an earlier usage item of the same turn costs the highest usage item', () => {
  const { events, summary } = recordedRun([['implement', [3.4, 1.2], 1.2]]);
  near(runCosts(events, summary).turnCost(receivedOf(events, 1)), 3.4, 'turnCost');
});

test('Analytics counts the recorded multi-result turn: the run, its agent and its step cost 15.123904', () => {
  const { events, summary } = recordedRun([['implement', [15.123904, 0], 0]]);
  const figures = runFigures({ summary, events });
  near(figures.costUsd, 15.123904, 'the run\'s cost');
  near(figures.agents.find((a) => a.agent === 'developer').costUsd, 15.123904, 'the agent\'s cost');
  near(figures.timeline.find((b) => b.step === 'implement').costUsd, 15.123904, 'the step\'s cost');
});

test('the run list reads the recorded multi-result turn at 15.123904 and never rewrites events.jsonl', (t) => {
  const { events, summary } = recordedRun([['implement', [15.123904, 0], 0]]);
  const { runsDir, dir, eventsText } = writeRun(t, events, summary);
  const info = runs.readRun(runsDir, 'r-277');
  near(info.costUsd, 15.123904, 'the run list\'s cost');
  near(info.sessions.find((s) => s.id === 's1').cost_usd, 15.123904, 'the session\'s cost');
  assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), eventsText);
});

// A turn whose first attempt ended on an error result (cost X, counted by its session.attempt_stopped)
// and whose retry succeeded with a smaller cost Y: the retry costs Y, the run X + Y (X never twice).
function stoppedThenRetried(summaryExtra = {}) {
  const X = 4.8;
  const Y = 1.3;
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-277', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Task' }, cost_accounting: 'per_turn' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap(0, 0, zero) },
    { ts: at(1), type: 'step.started', step_id: 'implement', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(2), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'implement', prompt: 'do it' },
    usageItem(at(60), 1, big, X),
    { ts: at(60), type: 'session.attempt_stopped', session_id: 's1', turn: 1, attempt: 1, step_id: 'implement', cost_usd: X, estimated: false, session: snap(0, X, big) },
    usageItem(at(120), 1, small, Y),
    { ts: at(120), type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'implement', text: 'done', usage: small, cost_usd: Y,
      duration_ms: 60e3, active_ms: 60e3, waiting_ms: 0, stalled_ms: 0, session: snap(1, X + Y, small) },
    { ts: at(121), type: 'step.finished', step_id: 'implement', visit: 1, duration_ms: 120e3, output: {} },
  ];
  const summary = {
    run_id: 'r-277', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(121), duration_ms: 121e3,
    inputs: { task: 'Task' }, tokens: small, cost_usd: X + Y, cost_accounting: 'per_turn', sessions: [{ ...snap(1, X + Y, small), status: 'success' }], ...summaryExtra,
  };
  events.push({ ts: at(121), type: 'workflow.finished', status: 'success', error: null, summary });
  return { events, summary, X, Y };
}

for (const [label, extra] of [['a run recorded before the fix', {}], ['a run recorded with the fix (turn_cost max_result)', { turn_cost: 'max_result' }]]) {
  test(`${label}: a retry after a stopped attempt costs its own result, and the stopped attempt is counted once`, () => {
    const { events, summary, X, Y } = stoppedThenRetried(extra);
    near(runCosts(events, summary).turnCost(receivedOf(events, 1)), Y, 'the retry\'s cost');
    near(runFigures({ summary, events }).costUsd, X + Y, 'the run\'s cost');
  });
}

test('recorded per-turn costs that match their usage items are read as recorded; a turn never takes another turn\'s usage item', () => {
  const { events, summary } = recordedRun([['plan', [15.123904], 15.123904], ['implement', [2.5], 2.5]]);
  const costs = runCosts(events, summary);
  near(costs.turnCost(receivedOf(events, 1)), 15.123904, 'turn 1');
  near(costs.turnCost(receivedOf(events, 2)), 2.5, 'turn 2');
  near(runFigures({ summary, events }).costUsd, 17.623904, 'the run\'s cost');
});
