// Run costs (#233): a resumed Claude turn costs only itself (the CLI's `total_cost_usd` is cumulative
// for the whole session on `--resume`), a turn killed before its `result` keeps the tokens of the
// model calls it made (priced with the run's price table, marked estimated), the limits use the
// corrected figures, and past runs recorded before the fix are read with corrected figures (their
// events.jsonl is never rewritten); handoff sessions and the mock provider's figures do not change.
// Seams:
// - parseClaude(ev, emit, acc) of src/engine/providers.js, exported like parseGrok (runTurn refuses
//   the real CLIs in simulation, so the adapter is fed the recorded stream-json events directly).
//   `acc` is what runCli gives it: { text, lastText, usage, costUsd, providerSessionId, error }, with
//   providerSessionId already set on a resumed turn.
// - WorkflowRun mock runs with mockSequences.timeouts (the mock kills the 1st attempt) and `prices`.
// - src/runs.js readRun (run lists, roadmap real cost via src/cost-estimate.js actualCost) and
//   src/run-analysis.js runFigures (Analytics' Run tab) on a run folder written here.
// Assumptions (the names the developer implements):
// - a turn killed before `result`: acc.streamUsage (tokens summed over the distinct assistant
//   messages, by message id: Claude Code repeats a message's usage on each of its content blocks)
//   and acc.modelCalls (how many model calls); acc.costUsd stays null (nothing reported).
// - the mock's killed attempt reports assistant usage too; the engine prices it with `prices`, logs
//   `attempt 1/2 failed: <error> (US$ X.XX, estimated from N model calls)`, and records an event of
//   the step with `estimated: true` and its `cost_usd`, which Analytics counts in the step's cost.
// - an old run's stopped attempt (a turn sent, never received): runFigures flags the agent and the
//   step bar with `costNotRecorded: true`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const runs = require('../src/runs');
const { runFigures } = require('../src/run-analysis');
const { actualCost } = require('../src/cost-estimate');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const near = (actual, expected, tol, msg) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < tol, `${msg}: expected ${expected}, got ${actual}`);

// ---------------------------------------------------------------------------
// The Claude adapter
// ---------------------------------------------------------------------------
function loadParseClaude() {
  const { parseClaude } = require('../src/engine/providers');
  assert.equal(typeof parseClaude, 'function', 'src/engine/providers.js exports parseClaude (like parseGrok)');
  return parseClaude;
}

// One CLI turn as runCli feeds it: a fresh acc per turn, with the resumed session id when resuming.
function claudeTurn(parse, events, resumeId = null) {
  const items = [];
  const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId: resumeId, error: null };
  for (const ev of events) parse(ev, (i) => items.push(i), acc);
  parse.flush?.((i) => items.push(i), acc);
  return { acc, items };
}

const init = (sid) => ({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-opus-5-5', cwd: 'C:/repo', tools: ['Bash', 'Read'] });
const apiUsage = (input, cacheWrite, cacheRead, output) => ({ input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output });
const assistant = (sid, id, usage, content) => ({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, usage } });
const toolResult = (sid, id) => ({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }] } });
const result = (sid, total, usage) => ({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'done', num_turns: 2, total_cost_usd: total, usage });

// turn 1 of a session, then turn 2 resumed in the same session (`claude -p --resume <id>`)
const turnOne = (sid) => [
  init(sid),
  assistant(sid, `${sid}-m1`, apiUsage(10, 40000, 150000, 2000), [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git status' } }]),
  toolResult(sid, 'tu1'),
  assistant(sid, `${sid}-m2`, apiUsage(2, 1000, 190000, 1000), [{ type: 'text', text: 'done' }]),
  result(sid, 3.21, apiUsage(12, 41000, 340000, 3000)),
];
const turnTwo = (sid) => [
  init(sid),
  assistant(sid, `${sid}-m3`, apiUsage(8, 5000, 90000, 1200), [{ type: 'text', text: 'done again' }]),
  result(sid, 3.56, apiUsage(8, 5000, 90000, 1200)),
];

test('parseClaude (#233): a resumed turn costs the difference of the cumulative total_cost_usd; its usage stays per turn', () => {
  const parse = loadParseClaude();
  const sid = `sess-${crypto.randomUUID()}`;
  const one = claudeTurn(parse, turnOne(sid));
  assert.equal(one.acc.costUsd, 3.21, 'the first turn of a session costs its total_cost_usd');
  assert.equal(one.acc.providerSessionId, sid);

  const two = claudeTurn(parse, turnTwo(sid), sid);
  near(two.acc.costUsd, 0.35, 1e-9, 'turn 2 = 3.56 - 3.21');
  const usageItem = two.items.find((i) => i.kind === 'usage');
  near(usageItem.costUsd, 0.35, 1e-9, 'the usage item streamed to the UI carries the turn\'s own cost');
  assert.deepEqual(two.acc.usage, { input: 8, output: 1200, cache_read: 90000, cache_write: 5000, reasoning: 0 }, 'tokens are per turn already: unchanged');
});

test('parseClaude (#233): turns of different sessions (handoff: one turn per session) keep their cost as reported', () => {
  const parse = loadParseClaude();
  const a = `sess-${crypto.randomUUID()}`;
  const b = `sess-${crypto.randomUUID()}`;
  assert.equal(claudeTurn(parse, turnOne(a)).acc.costUsd, 3.21);
  // a fresh session (not resumed) whose own total is 3.56: nothing of session a is subtracted
  const events = turnTwo(b);
  assert.equal(claudeTurn(parse, events).acc.costUsd, 3.56);
  assert.deepEqual(claudeTurn(parse, turnOne(`sess-${crypto.randomUUID()}`)).acc.usage, { input: 12, output: 3000, cache_read: 340000, cache_write: 41000, reasoning: 0 });
});

test('parseClaude (#233): a turn killed before its result still exposes the tokens and the model calls of its assistant messages', () => {
  const parse = loadParseClaude();
  const sid = `sess-${crypto.randomUUID()}`;
  const m1 = apiUsage(10, 40000, 150000, 2000);
  const m2 = apiUsage(2, 1000, 190000, 1000);
  const { acc } = claudeTurn(parse, [
    init(sid),
    // Claude Code sends one assistant event per content block, each with the message's usage: one model call
    assistant(sid, 'msg_1', m1, [{ type: 'text', text: 'Let me look.' }]),
    assistant(sid, 'msg_1', m1, [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm run build' } }]),
    toolResult(sid, 'tu1'),
    assistant(sid, 'msg_2', m2, [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'node --test test/a.test.js' } }]),
    // killed here: no `result`
  ]);
  assert.equal(acc.costUsd, null, 'no cost was reported');
  assert.deepEqual(acc.streamUsage, { input: 12, output: 3000, cache_read: 340000, cache_write: 41000, reasoning: 0 }, 'tokens of msg_1 (once) + msg_2');
  assert.equal(acc.modelCalls, 2);
});

// ---------------------------------------------------------------------------
// The engine: a timed-out attempt's estimated cost
// ---------------------------------------------------------------------------
// US$ 1000 per million tokens (US$ 0.001 a token): any token the killed attempt made costs far more
// than the mock's own turn (at most ~US$ 0.08), so the estimate is visible in every total
const PRICES = { 'mock-model': { input: 1000, output: 1000, cache_read: 1000 } };

function tempWorkflow(t, yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-costs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  return file;
}

async function mockRun(t, file, opts = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-costs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, ...opts });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('engine (#233): an attempt killed at its timeout adds its estimated cost to the session, step and run totals, and its log line says so', { timeout: 60000 }, async (t) => {
  const { events, finished } = await mockRun(t, path.join(__dirname, 'fixtures', 'attempt-timeout.yaml'), {
    mockSequences: { timeouts: { work: 1 } }, prices: PRICES,
  });
  assert.equal(finished.status, 'success', finished.error);

  const failLog = events.find((e) => e.type === 'log' && /attempt 1\/2 failed/.test(e.message));
  assert.ok(failLog, 'the 1st attempt is logged as failed');
  const m = failLog.message.match(/attempt 1\/2 failed: Timed out after \d+s \(US\$ (\d+\.\d\d), estimated from (\d+) model calls?\)/);
  assert.ok(m, `the failure line has the estimated cost: ${failLog.message}`);
  const est = Number(m[1]);
  assert.ok(est > 0, 'the killed attempt made model calls that cost something');
  assert.ok(Number(m[2]) >= 1);

  // the estimate is marked as such on an event of the step
  const marked = events.find((e) => e.type !== 'session.stream' && e.step_id === 'work' && e.estimated === true);
  assert.ok(marked, 'an event of the step records the estimated cost (estimated: true)');
  near(marked.cost_usd, est, 0.006, 'its cost_usd is the logged estimate');

  // attempt 2's own turn, as reported by the mock
  const answered = events.filter((e) => e.type === 'session.message_received' && e.step_id === 'work' && !e.estimated);
  assert.equal(answered.length, 1);
  const own = answered[0].cost_usd;

  const session = finished.summary.sessions.find((s) => s.agent === 'a');
  near(session.cost_usd, own + est, 0.006, 'session = attempt 2 + the estimate of attempt 1');
  assert.ok(session.cost_usd > own, 'more than attempt 2 alone');
  near(finished.summary.cost_usd, finished.summary.sessions.reduce((a, s) => a + s.cost_usd, 0), 1e-6, 'run total = its sessions');
  assert.ok(finished.summary.cost_usd > own);

  // the step's cost (Analytics' timeline bar of the step)
  const bar = runFigures({ summary: finished.summary, events }).timeline.find((b) => b.step === 'work');
  near(bar.costUsd, session.cost_usd, 1e-4, 'the step costs both attempts');
});

test('engine (#233): max_total_cost_usd counts the estimated cost of a killed attempt', { timeout: 60000 }, async (t) => {
  const file = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: cost-limit-timeout }
orchestrator:
  limits: { max_total_cost_usd: 0.5 }
agents:
  a:
    provider: claude
    model: mock-model
    session: ephemeral
    retry: { max_attempts: 2, initial_delay: 10ms }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: after
    agent: a
    prompt: "then this"
`);
  // without the estimate the two mock turns cost at most ~US$ 0.16: under the limit
  const { events, finished } = await mockRun(t, file, { mockSequences: { timeouts: { work: 1 } }, prices: PRICES });
  assert.notEqual(finished.status, 'success');
  assert.match(finished.error || '', /Maximum cost exceeded \(US\$ 0\.5\)/);
  const exceeded = events.find((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_cost_usd');
  assert.ok(exceeded && exceeded.current > 0.5);
});

test('engine (#233): the mock provider\'s figures and handoff sessions are unchanged: each session costs the sum of its turns', { timeout: 60000 }, async (t) => {
  const { events, finished } = await mockRun(t, path.join(__dirname, 'fixtures', 'handoff.yaml'));
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(finished.summary.sessions.some((s) => s.mode === 'handoff'));
  for (const s of finished.summary.sessions.filter((x) => x.turns)) {
    const turns = events.filter((e) => e.type === 'session.message_received' && e.session_id === s.id);
    near(s.cost_usd, turns.reduce((a, e) => a + (e.cost_usd || 0), 0), 1e-6, `session ${s.id} (${s.mode})`);
  }
});

// ---------------------------------------------------------------------------
// Past runs (recorded before the fix)
// ---------------------------------------------------------------------------
const T0 = Date.parse('2026-09-20T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString();
const tokens = (input, output, cacheRead, cacheWrite) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite, reasoning: 0 });
const snap = (id, agent, provider, mode, turns, cost, tk) => ({
  id, agent, provider, model: 'claude-opus-5-5', effort: null, parent_id: 'orchestrator', step_id: 'plan',
  opened_at: at(0), closed_at: null, duration_ms: 0, active_ms: 0, idle_ms: 0,
  turns, tokens: tk, cost_usd: cost, status: 'idle', provider_session_id: `${id}-cli`, cwd: 'C:/repo', mode,
});

// Writes runs/<id>/events.jsonl and summary.json; returns { runsDir, dir, eventsText }.
function oldRun(t, runId, events, summary) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-old-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir);
  const eventsText = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'events.jsonl'), eventsText);
  if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { runsDir, dir, eventsText };
}

// Two steps, one persistent Claude session of two turns: the 2nd recorded the session's cumulative 3.56.
function persistentClaudeRun(provider = 'claude') {
  const t1 = tokens(12, 3000, 340000, 41000);
  const t2 = tokens(8, 1200, 90000, 5000);
  const sum = tokens(20, 4200, 430000, 46000);
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-old', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Old task' } },
    { ts: at(0), type: 'step.started', step_id: 'plan', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap('s1', 'developer', provider, 'persistent', 0, 0, tokens(0, 0, 0, 0)) },
    { ts: at(1), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'plan', prompt: 'plan it' },
    { ts: at(10), type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'plan', text: 'planned', usage: t1, cost_usd: 3.21, duration_ms: 9 * 60e3, active_ms: 9 * 60e3, waiting_ms: 0, stalled_ms: 0, session: snap('s1', 'developer', provider, 'persistent', 1, 3.21, t1) },
    { ts: at(10), type: 'step.finished', step_id: 'plan', visit: 1, duration_ms: 10 * 60e3, output: {} },
    { ts: at(10), type: 'step.started', step_id: 'implement', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(11), type: 'session.message_sent', session_id: 's1', turn: 2, step_id: 'implement', prompt: 'implement it' },
    { ts: at(20), type: 'session.message_received', session_id: 's1', turn: 2, step_id: 'implement', text: 'implemented', usage: t2, cost_usd: 3.56, duration_ms: 9 * 60e3, active_ms: 9 * 60e3, waiting_ms: 0, stalled_ms: 0, session: snap('s1', 'developer', provider, 'persistent', 2, 6.77, sum) },
    { ts: at(20), type: 'step.finished', step_id: 'implement', visit: 1, duration_ms: 10 * 60e3, output: {} },
    { ts: at(20), type: 'session.closed', session_id: 's1', status: 'success', session: snap('s1', 'developer', provider, 'persistent', 2, 6.77, sum) },
  ];
  const summary = {
    run_id: 'r-old', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(20), duration_ms: 20 * 60e3,
    inputs: { task: 'Old task' }, tokens: sum, cost_usd: 6.77, sessions: [{ ...snap('s1', 'developer', provider, 'persistent', 2, 6.77, sum), status: 'success' }],
  };
  events.push({ ts: at(20), type: 'workflow.finished', status: 'success', error: null, summary });
  return { events, summary };
}

test('past runs (#233): a persistent Claude session recorded with cumulative costs reads 3.56, not 6.77 (run list, roadmap, Analytics); events.jsonl untouched', (t) => {
  const { events, summary } = persistentClaudeRun();
  const { runsDir, dir, eventsText } = oldRun(t, 'r-old', events, summary);

  const info = runs.readRun(runsDir, 'r-old');
  near(info.costUsd, 3.56, 1e-6, 'the run list\'s cost');
  near(info.sessions.find((s) => s.id === 's1').cost_usd, 3.56, 1e-6, 'the session\'s cost');
  // the roadmap's real cost of the item run by it
  near(actualCost({ runId: 'r-old' }, new Map([['r-old', info]])), 3.56, 1e-6, 'the roadmap\'s real cost');

  const figures = runFigures({ summary, events: runs.runEvents(dir) });
  near(figures.costUsd, 3.56, 1e-6, 'Analytics: the run\'s cost');
  near(figures.agents.find((a) => a.agent === 'developer').costUsd, 3.56, 1e-6, 'Analytics: the agent\'s cost');
  near(figures.timeline.find((b) => b.step === 'plan').costUsd, 3.21, 1e-6, 'turn 1');
  near(figures.timeline.find((b) => b.step === 'implement').costUsd, 0.35, 1e-6, 'turn 2 = 3.56 - 3.21');

  assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), eventsText, 'events.jsonl is never rewritten');
});

test('past runs (#233): handoff sessions (one turn each) and a Codex persistent session keep their recorded costs', (t) => {
  // the same two turns, but each in its own handoff session: 3.21 + 3.56
  const t1 = tokens(12, 3000, 340000, 41000);
  const t2 = tokens(8, 1200, 90000, 5000);
  const first = snap('s1', 'developer', 'claude', 'handoff', 1, 3.21, t1);
  const second = snap('s2', 'developer', 'claude', 'handoff', 1, 3.56, t2);
  const turn = (m, s, step, cost, u) => ({ ts: at(m), type: 'session.message_received', session_id: s.id, turn: 1, step_id: step, text: 'done', usage: u, cost_usd: cost, duration_ms: 9 * 60e3, active_ms: 9 * 60e3, waiting_ms: 0, stalled_ms: 0, session: s });
  const sum = {
    run_id: 'r-old', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(20), duration_ms: 20 * 60e3,
    inputs: { task: 'Old task' }, tokens: tokens(20, 4200, 430000, 46000), cost_usd: 6.77, sessions: [{ ...first, status: 'success' }, { ...second, status: 'success' }],
  };
  const evs = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-old', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Old task' } },
    { ts: at(0), type: 'step.started', step_id: 'plan', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap('s1', 'developer', 'claude', 'handoff', 0, 0, tokens(0, 0, 0, 0)) },
    { ts: at(1), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'plan', prompt: 'plan it' },
    turn(10, first, 'plan', 3.21, t1),
    { ts: at(10), type: 'session.closed', session_id: 's1', status: 'success', session: first },
    { ts: at(10), type: 'step.finished', step_id: 'plan', visit: 1, duration_ms: 10 * 60e3, output: {} },
    { ts: at(10), type: 'step.started', step_id: 'implement', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(10), type: 'session.opened', session_id: 's2', session: snap('s2', 'developer', 'claude', 'handoff', 0, 0, tokens(0, 0, 0, 0)) },
    { ts: at(11), type: 'session.message_sent', session_id: 's2', turn: 1, step_id: 'implement', prompt: 'implement it' },
    turn(20, second, 'implement', 3.56, t2),
    { ts: at(20), type: 'session.closed', session_id: 's2', status: 'success', session: second },
    { ts: at(20), type: 'step.finished', step_id: 'implement', visit: 1, duration_ms: 10 * 60e3, output: {} },
    { ts: at(20), type: 'workflow.finished', status: 'success', error: null, summary: sum },
  ];
  const a = oldRun(t, 'r-old', evs, sum);
  near(runs.readRun(a.runsDir, 'r-old').costUsd, 6.77, 1e-6, 'handoff: 3.21 + 3.56');
  const fa = runFigures({ summary: sum, events: runs.runEvents(a.dir) });
  near(fa.timeline.find((b) => b.step === 'implement').costUsd, 3.56, 1e-6, 'handoff: turn 2 keeps its cost');

  // Codex reports no cumulative cost: its persistent session is never recomputed
  const codex = persistentClaudeRun('codex');
  const b = oldRun(t, 'r-old', codex.events, codex.summary);
  near(runs.readRun(b.runsDir, 'r-old').costUsd, 6.77, 1e-6, 'codex: as recorded');
});

test('past runs (#233): a stopped attempt of an old run is "cost not recorded", not a zero cost', (t) => {
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-stopped', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Old task' } },
    { ts: at(0), type: 'step.started', step_id: 'work', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap('s1', 'developer', 'claude', 'persistent', 0, 0, tokens(0, 0, 0, 0)) },
    { ts: at(1), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'work', prompt: 'do it', timeout_ms: 1800e3 },
    { ts: at(31), type: 'log', level: 'error', message: '[developer] attempt 1/1 failed: Timed out after 1800s' },
    { ts: at(31), type: 'session.status', session_id: 's1', status: 'error' },
    { ts: at(31), type: 'step.finished', step_id: 'work', visit: 1, duration_ms: 31 * 60e3, output: { error: 'Timed out after 1800s' }, error: true },
  ];
  const summary = {
    run_id: 'r-stopped', workflow: 'AI Development', status: 'failed', mock: false, started_at: at(0), finished_at: at(31), duration_ms: 31 * 60e3,
    inputs: { task: 'Old task' }, tokens: tokens(0, 0, 0, 0), cost_usd: 0, sessions: [{ ...snap('s1', 'developer', 'claude', 'persistent', 1, 0, tokens(0, 0, 0, 0)), status: 'failed' }],
  };
  events.push({ ts: at(31), type: 'workflow.finished', status: 'failed', error: 'Timed out after 1800s', summary });
  const { dir, eventsText } = oldRun(t, 'r-stopped', events, summary);

  const figures = runFigures({ summary, events: runs.runEvents(dir) });
  assert.equal(figures.agents.find((a) => a.agent === 'developer').costNotRecorded, true, 'the agent\'s cost is flagged as not recorded');
  assert.equal(figures.timeline.find((b) => b.step === 'work').costNotRecorded, true, 'the step\'s bar is flagged as not recorded');
  assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), eventsText);
});

test('past runs (#233): an old run\'s stopped attempt flags only the bar of its agent\'s step running at that time', () => {
  const z = tokens(0, 0, 0, 0);
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-two', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Old task' } },
    { ts: at(0), type: 'step.started', step_id: 'plan', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap('s1', 'developer', 'claude', 'handoff', 0, 0, z) },
    { ts: at(10), type: 'step.finished', step_id: 'plan', visit: 1, duration_ms: 10 * 60e3, output: {} },
    { ts: at(10), type: 'step.started', step_id: 'implement', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(41), type: 'log', level: 'error', message: '[developer] attempt 1/2 failed: Timed out after 1800s' },
    { ts: at(45), type: 'step.finished', step_id: 'implement', visit: 1, duration_ms: 35 * 60e3, output: {} },
    { ts: at(45), type: 'step.started', step_id: 'review', visit: 1, step_type: 'agent', agent: 'reviewer' },
    { ts: at(50), type: 'step.finished', step_id: 'review', visit: 1, duration_ms: 5 * 60e3, output: {} },
  ];
  const summary = {
    run_id: 'r-two', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(50), duration_ms: 50 * 60e3,
    inputs: { task: 'Old task' }, tokens: z, cost_usd: 0, sessions: [{ ...snap('s1', 'developer', 'claude', 'handoff', 1, 0, z), status: 'success' }],
  };
  events.push({ ts: at(50), type: 'workflow.finished', status: 'success', error: null, summary });
  const bars = runFigures({ summary, events }).timeline;
  assert.deepEqual(['plan', 'implement', 'review'].map((s) => !!bars.find((b) => b.step === s).costNotRecorded), [false, true, false]);
});
