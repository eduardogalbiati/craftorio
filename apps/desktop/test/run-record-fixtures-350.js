// Recorded runs for the run record normalizer (#350): one run per historical shape of summary.json
// and events.jsonl, plus a current run and a run still going (no summary.json). A helper module:
// it never calls test(). Each fixture is { name, runId, events, summary } (summary null: no file).
// The golden outputs of the readers on these runs are in fixtures/run-record-golden-350.json; they
// were computed by the readers as they were before #350 (base 5609d09): changing a fixture means
// computing them again on that commit.
const fs = require('fs');
const os = require('os');
const path = require('path');

const T0 = Date.parse('2026-09-20T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString();
const NOW = T0 + 24 * 3600e3;
const tokens = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite, reasoning: 0 });
const ZERO = tokens(0, 0);
const snap = (id, agent, provider, mode, step, turns, cost, tk, extra = {}) => ({
  id, agent, provider, model: provider === 'codex' ? 'gpt-5.5' : 'claude-opus-5-5', effort: null, parent_id: 'orchestrator', step_id: step,
  opened_at: at(0), closed_at: null, duration_ms: 0, active_ms: 0, idle_ms: 0,
  turns, tokens: tk, cost_usd: cost, status: 'idle', provider_session_id: `${id}-cli`, cwd: 'C:/repo', mode, ...extra,
});
const received = (min, sessionId, turn, step, cost, usage, session, extra = {}) => ({
  ts: at(min), type: 'session.message_received', session_id: sessionId, turn, step_id: step, text: 'done', usage, cost_usd: cost,
  duration_ms: 5 * 60e3, active_ms: 5 * 60e3, waiting_ms: 0, stalled_ms: 0, session, ...extra,
});
const started = (runId, extra = {}) => ({ ts: at(0), type: 'workflow.started', run_id: runId, workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Task' }, ...extra });
const stepStarted = (min, step, agent) => ({ ts: at(min), type: 'step.started', step_id: step, visit: 1, step_type: 'agent', agent });
const stepFinished = (min, step, minutes, output = {}) => ({ ts: at(min), type: 'step.finished', step_id: step, visit: 1, duration_ms: minutes * 60e3, output });
const sent = (min, sessionId, turn, step) => ({ ts: at(min), type: 'session.message_sent', session_id: sessionId, turn, step_id: step, prompt: 'do it' });
const finished = (events, summary) => { events.push({ ts: summary.finished_at, type: 'workflow.finished', status: summary.status, error: null, summary }); return { events, summary }; };

// Today's shape: per-turn costs, turn_cost max_result, sessions in the summary, a stopped attempt
// recorded as session.attempt_stopped, sub-agent usage, a Codex reviewer.
function current() {
  const runId = 'r-current';
  const d1 = tokens(10, 2000, 100000, 5000);
  const d2 = tokens(5, 800, 60000, 1000);
  const dev = tokens(15, 2800, 160000, 6000);
  const rv = tokens(3000, 400);
  const devSnap = (turns, cost, tk) => snap('s1', 'developer', 'claude', 'persistent', 'implement', turns, cost, tk);
  const revSnap = (turns, cost, tk) => snap('s2', 'reviewer', 'codex', 'handoff', 'review', turns, cost, tk);
  const events = [
    started(runId, { issues: [350], cost_accounting: 'per_turn', agent_names: { developer: 'Developer', reviewer: 'Reviewer' } }),
    stepStarted(0, 'implement', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: devSnap(0, 0, ZERO) },
    sent(1, 's1', 1, 'implement'),
    { ts: at(4), type: 'session.attempt_stopped', session_id: 's1', turn: 1, step_id: 'implement', attempt: 1, error: 'Timed out after 180s', usage: tokens(2, 100), model_calls: 1, cost_usd: 0.05, estimated: true, session: devSnap(0, 0, ZERO) },
    { ts: at(5), type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'usage', usage: d1, costUsd: 1.1 } },
    received(5, 's1', 1, 'implement', 1.1, d1, devSnap(1, 1.1, d1), { subagents: { calls: 1, usage: tokens(1, 300) }, usage_main: d1, model_calls: 4, subagent_calls: 1 }),
    stepFinished(5, 'implement', 5),
    stepStarted(5, 'review', 'reviewer'),
    { ts: at(5), type: 'session.opened', session_id: 's2', session: revSnap(0, 0, ZERO) },
    sent(6, 's2', 1, 'review'),
    received(9, 's2', 1, 'review', 0.3, rv, revSnap(1, 0.3, rv)),
    { ts: at(9), type: 'session.closed', session_id: 's2', status: 'success', session: revSnap(1, 0.3, rv) },
    stepFinished(9, 'review', 4, { status: 'changes_requested' }),
    stepStarted(9, 'fix', 'developer'),
    sent(10, 's1', 2, 'fix'),
    { ts: at(12), type: 'session.stream', session_id: 's1', turn: 2, item: { kind: 'usage', usage: d2, costUsd: 0.4 } },
    received(12, 's1', 2, 'fix', 0.4, d2, devSnap(2, 1.5, dev)),
    stepFinished(12, 'fix', 3),
    { ts: at(12), type: 'session.closed', session_id: 's1', status: 'success', session: devSnap(2, 1.5, dev) },
  ];
  const summary = {
    run_id: runId, workflow: 'AI Development', issues: [350], status: 'success', mock: false, started_at: at(0), finished_at: at(12), duration_ms: 12 * 60e3,
    inputs: { task: 'Task' }, tokens: tokens(3015, 3200, 160000, 6000), cost_usd: 1.85, cost_accounting: 'per_turn', turn_cost: 'max_result',
    timing: { duration_ms: 12 * 60e3, gate_wait_ms: 0, waiting_ms: 0 },
    sessions: [{ ...devSnap(2, 1.5, dev), status: 'success' }, { ...revSnap(1, 0.3, rv), status: 'success' }],
  };
  return { name: 'current', runId, ...finished(events, summary) };
}

// #233: a persistent Claude session of two turns recorded the CLI session's cumulative cost
// (3.21, then 3.56): the second turn's own cost is 0.35, the session's 3.56.
function cumulative233(provider = 'claude') {
  const runId = provider === 'claude' ? 'r-cumulative' : 'r-cumulative-codex';
  const t1 = tokens(12, 3000, 340000, 41000);
  const t2 = tokens(8, 1200, 90000, 5000);
  const sum = tokens(20, 4200, 430000, 46000);
  const s = (step, turns, cost, tk) => snap('s1', 'developer', provider, 'persistent', step, turns, cost, tk);
  const events = [
    started(runId),
    stepStarted(0, 'plan', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s('plan', 0, 0, ZERO) },
    sent(1, 's1', 1, 'plan'),
    received(10, 's1', 1, 'plan', 3.21, t1, s('plan', 1, 3.21, t1)),
    stepFinished(10, 'plan', 10),
    stepStarted(10, 'implement', 'developer'),
    sent(11, 's1', 2, 'implement'),
    received(20, 's1', 2, 'implement', 3.56, t2, s('plan', 2, 6.77, sum)),
    stepFinished(20, 'implement', 10),
    { ts: at(20), type: 'session.closed', session_id: 's1', status: 'success', session: s('plan', 2, 6.77, sum) },
  ];
  const summary = {
    run_id: runId, workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(20), duration_ms: 20 * 60e3,
    inputs: { task: 'Task' }, tokens: sum, cost_usd: 6.77, sessions: [{ ...s('plan', 2, 6.77, sum), status: 'success' }],
  };
  return { name: provider === 'claude' ? '#233 cumulative cost' : '#233 cumulative cost, Codex session', runId, ...finished(events, summary) };
}

// #233: an attempt killed before its result, recorded only as an error log line.
function stoppedAttempt233() {
  const runId = 'r-stopped';
  const s = (turns, status) => ({ ...snap('s1', 'developer', 'claude', 'persistent', 'work', turns, 0, ZERO), status });
  const events = [
    started(runId),
    stepStarted(0, 'work', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s(0, 'idle') },
    { ...sent(1, 's1', 1, 'work'), timeout_ms: 1800e3 },
    { ts: at(31), type: 'log', level: 'error', message: '[developer] attempt 1/1 failed: Timed out after 1800s' },
    { ts: at(31), type: 'session.status', session_id: 's1', status: 'error' },
    stepFinished(31, 'work', 31, { error: 'Timed out after 1800s' }),
  ];
  events[events.length - 1].error = true;
  const summary = {
    run_id: runId, workflow: 'AI Development', status: 'failed', mock: false, started_at: at(0), finished_at: at(31), duration_ms: 31 * 60e3,
    inputs: { task: 'Task' }, tokens: ZERO, cost_usd: 0, sessions: [s(1, 'failed')],
  };
  return { name: '#233 stopped attempt in a log line', runId, ...finished(events, summary) };
}

// #277: a per-turn run recorded before turn_cost 'max_result': the turn streamed two usage items
// (15.123904, then 0) and recorded cost_usd 0; the turn costs 15.123904.
function multiResult277() {
  const runId = 'r-multi-result';
  const big = tokens(102, 84376, 7714400, 198504);
  const small = tokens(22, 18805, 1203311, 40211);
  const s = (turns, cost) => snap('s1', 'developer', 'claude', 'persistent', 'implement', turns, cost, small);
  const events = [
    started(runId, { cost_accounting: 'per_turn' }),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s(0, 0) },
    stepStarted(1, 'implement', 'developer'),
    sent(2, 's1', 1, 'implement'),
    { ts: at(30), type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'usage', usage: big, costUsd: 15.123904 } },
    { ts: at(30), type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'usage', usage: small, costUsd: 0 } },
    received(30, 's1', 1, 'implement', 0, small, s(1, 0)),
    stepFinished(30, 'implement', 29),
    { ts: at(30), type: 'session.closed', session_id: 's1', status: 'success', session: s(1, 0) },
  ];
  const summary = {
    run_id: runId, workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(30), duration_ms: 30 * 60e3,
    inputs: { task: 'Task' }, tokens: small, cost_usd: 0, cost_accounting: 'per_turn', sessions: [{ ...s(1, 0), status: 'success' }],
  };
  return { name: '#277 multi-result turn', runId, ...finished(events, summary) };
}

// A run recorded before the summary listed its sessions: a Claude handoff session and a Codex one.
function noSessions() {
  const runId = 'r-no-sessions';
  const a = tokens(400, 900, 20000, 3000);
  const b = tokens(5000, 700);
  const s1 = (turns, cost, tk) => snap('s1', 'developer', 'claude', 'handoff', 'implement', turns, cost, tk);
  const s2 = (turns, cost, tk) => snap('s2', 'reviewer', 'codex', 'handoff', 'review', turns, cost, tk);
  const events = [
    started(runId),
    stepStarted(0, 'implement', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s1(0, 0, ZERO) },
    sent(1, 's1', 1, 'implement'),
    received(8, 's1', 1, 'implement', 0.8, a, s1(1, 0.8, a)),
    { ts: at(8), type: 'session.closed', session_id: 's1', status: 'success', session: s1(1, 0.8, a) },
    stepFinished(8, 'implement', 8),
    stepStarted(8, 'review', 'reviewer'),
    { ts: at(8), type: 'session.opened', session_id: 's2', session: s2(0, 0, ZERO) },
    sent(9, 's2', 1, 'review'),
    received(12, 's2', 1, 'review', 0.2, b, s2(1, 0.2, b)),
    { ts: at(12), type: 'session.closed', session_id: 's2', status: 'success', session: s2(1, 0.2, b) },
    stepFinished(12, 'review', 4, { status: 'approved' }),
  ];
  const summary = {
    run_id: runId, workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(12), duration_ms: 12 * 60e3,
    inputs: { task: 'Task' }, tokens: tokens(5400, 1600, 20000, 3000), cost_usd: 1,
  };
  return { name: 'no sessions in the summary', runId, ...finished(events, summary) };
}

// A run from before multi-issue runs (a single `issue`), its duration only under timing.
function singleIssue() {
  const runId = 'r-single-issue';
  const a = tokens(100, 300);
  const s = (turns, cost, tk) => snap('s1', 'developer', 'claude', 'handoff', 'implement', turns, cost, tk);
  const events = [
    started(runId, { issue: 42 }),
    stepStarted(0, 'implement', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s(0, 0, ZERO) },
    sent(1, 's1', 1, 'implement'),
    received(6, 's1', 1, 'implement', 0.25, a, s(1, 0.25, a)),
    { ts: at(6), type: 'session.closed', session_id: 's1', status: 'success', session: s(1, 0.25, a) },
    stepFinished(6, 'implement', 6),
  ];
  const summary = {
    run_id: runId, workflow: 'AI Development', issue: 42, status: 'success', mock: false, started_at: at(0), finished_at: at(6),
    timing: { duration_ms: 6 * 60e3, gate_wait_ms: 0 },
    inputs: { task: 'Task' }, tokens: a, cost_usd: 0.25, sessions: [{ ...s(1, 0.25, a), status: 'success' }],
  };
  return { name: 'single issue', runId, ...finished(events, summary) };
}

// A run still going: no summary.json yet, an old (cumulative) Claude session mid-run.
function running() {
  const runId = 'r-running';
  const t1 = tokens(12, 3000, 340000, 41000);
  const t2 = tokens(8, 1200, 90000, 5000);
  const sum = tokens(20, 4200, 430000, 46000);
  const s = (turns, cost, tk) => snap('s1', 'developer', 'claude', 'persistent', 'plan', turns, cost, tk);
  const events = [
    started(runId),
    stepStarted(0, 'plan', 'developer'),
    { ts: at(0), type: 'session.opened', session_id: 's1', session: s(0, 0, ZERO) },
    sent(1, 's1', 1, 'plan'),
    received(10, 's1', 1, 'plan', 3.21, t1, s(1, 3.21, t1)),
    stepFinished(10, 'plan', 10),
    stepStarted(10, 'implement', 'developer'),
    sent(11, 's1', 2, 'implement'),
    received(20, 's1', 2, 'implement', 3.56, t2, s(2, 6.77, sum)),
    stepFinished(20, 'implement', 10),
    stepStarted(20, 'review', 'reviewer'),
  ];
  return { name: 'running (no summary.json)', runId, events, summary: null };
}

const FIXTURES = [current, () => cumulative233('claude'), () => cumulative233('codex'), stoppedAttempt233, multiResult277, noSessions, singleIssue, running];

// A fresh copy of every fixture (tests may not share objects).
function fixtures() { return FIXTURES.map((f) => f()); }
function fixture(name) { return fixtures().find((f) => f.name === name); }

// Writes <runsDir>/<runId>/events.jsonl and summary.json (none when summary is null) in a temp
// folder removed after the test; returns { runsDir, dir, eventsText, summaryText }.
function writeRun(t, fx) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-record-350-'));
  if (t) t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = path.join(runsDir, fx.runId);
  fs.mkdirSync(dir);
  const eventsText = `${fx.events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'events.jsonl'), eventsText);
  const summaryText = fx.summary ? JSON.stringify(fx.summary, null, 2) : null;
  if (summaryText) fs.writeFileSync(path.join(dir, 'summary.json'), summaryText);
  return { runsDir, dir, eventsText, summaryText };
}

// Rounds every number to 9 decimals (a sum in another order may differ in the last bits) and
// turns the value into plain JSON.
function plain(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => {
    if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) return Math.round(v * 1e9) / 1e9;
    if (v instanceof Map) return Object.fromEntries(v);
    return v;
  }));
}

// The figures the run list, the roadmap's estimates and the Analytics screen show for a run.
const RUN_ROW_FIELDS = ['runId', 'status', 'issues', 'costUsd', 'childrenCostUsd', 'durationMs', 'gateWaitMs'];
const SESSION_FIELDS = ['id', 'agent', 'provider', 'turns', 'tokens', 'cost_usd', 'cost_not_recorded'];
function runRow(info) {
  const row = {};
  for (const k of RUN_ROW_FIELDS) row[k] = info ? info[k] : undefined;
  row.sessions = ((info && info.sessions) || []).map((s) => Object.fromEntries(SESSION_FIELDS.map((k) => [k, s[k]])));
  return plain(row);
}

const ANALYTICS_RANGE = { from: '2026-09-01', to: '2026-09-30', now: new Date('2026-09-30T12:00:00Z') };
const ANALYTICS_LOCAL = { sessions: new Map(), records: [], found: { claude: false, codex: false, grok: false } };

module.exports = { fixtures, fixture, writeRun, plain, runRow, NOW, ANALYTICS_RANGE, ANALYTICS_LOCAL };
