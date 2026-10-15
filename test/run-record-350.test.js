// Run record normalizer (#350): a recorded run's older shapes are upgraded once, on read, into the
// current shape, and every reader of recorded runs reads that shape instead of handling each old
// one itself. The run's files are never rewritten.
// Seams:
// - readRunRecord(runDir) of src/run-record.js: reads summary.json and events.jsonl, returns
//   { summary, events } in the current shape (summary null while the run has no summary.json).
// - upgradeRunRecord({ summary, events }) of src/shared/run-record.js: the same upgrade, pure, on
//   in-memory events (the renderer loads it for live events); UPGRADES: one { name, ... } per change.
// - The readers on a fixture run per historical shape (test/run-record-fixtures-350.js): runFigures,
//   analyzeRun, the run list (runs.readRun), the roadmap's figures (cost-estimate) and the Analytics
//   totals (computeAnalytics). Their outputs must equal the ones recorded before the change
//   (test/fixtures/run-record-golden-350.json, computed on 5609d09).
// Assumptions (the names and shapes the developer implements):
// - the upgraded #233 run reads like a current one: each turn's own cost on its
//   session.message_received, the sessions' and the summary's cost corrected, cost_accounting
//   'per_turn'; an old stopped attempt (an error log line) becomes a session.attempt_stopped with
//   cost_not_recorded; a #277 turn costs its highest usage item and the summary gets turn_cost
//   'max_result'; a summary without sessions gets them from the session snapshots of the events;
//   a single `issue` becomes `issues`.
// - Where the readers disagreed before the change on the same old run (KNOWN_DISAGREEMENTS below),
//   the expected figure is the corrected one the run list and the Run tab already showed: reading
//   one upgraded record makes them agree. Every other figure stays identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runFigures } = require('../src/run-analysis');
const { analyzeRun } = require('../src/oracle-run-analysis');
const runs = require('../src/runs');
const { actualCost, actualTime, stepMinutes } = require('../src/cost-estimate');
const { computeAnalytics } = require('../src/analytics');
const fx = require('./run-record-fixtures-350');
const GOLDEN = require('./fixtures/run-record-golden-350.json');

const loadReader = () => require('../src/run-record');
const loadUpgrade = () => require('../src/shared/run-record');

const near = (actual, expected, msg) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);
const received = (events, sessionId, turn) => events.find((e) => e.type === 'session.message_received' && e.session_id === sessionId && e.turn === turn);
const sessionOf = (summary, id) => (summary.sessions || []).find((s) => s.id === id);
const upgraded = (name) => { const f = fx.fixture(name); return loadUpgrade().upgradeRunRecord({ summary: f.summary, events: f.events }); };

// ---------------------------------------------------------------------------
// One test per upgrade, on its fixture
// ---------------------------------------------------------------------------

test('#233 per-turn cost: a resumed Claude turn recorded with the session\'s cumulative cost is upgraded to its own cost', () => {
  const { summary, events } = upgraded('#233 cumulative cost');
  near(received(events, 's1', 1).cost_usd, 3.21, 'turn 1');
  near(received(events, 's1', 2).cost_usd, 0.35, 'turn 2 = 3.56 - 3.21');
  near(sessionOf(summary, 's1').cost_usd, 3.56, 'the session\'s cost');
  near(summary.cost_usd, 3.56, 'the run\'s cost');
  assert.equal(summary.cost_accounting, 'per_turn');
  assert.equal(events.find((e) => e.type === 'workflow.started').cost_accounting, 'per_turn');
});

test('#233 per-turn cost: a non-Claude persistent session keeps its recorded costs', () => {
  const { summary, events } = upgraded('#233 cumulative cost, Codex session');
  near(received(events, 's1', 1).cost_usd, 3.21, 'turn 1');
  near(received(events, 's1', 2).cost_usd, 3.56, 'turn 2');
  near(sessionOf(summary, 's1').cost_usd, 6.77, 'the session\'s cost');
});

test('#233 stopped attempt: an old attempt recorded only as an error log line becomes a stopped attempt whose cost was not recorded', () => {
  const { events } = upgraded('#233 stopped attempt in a log line');
  const stopped = events.filter((e) => e.type === 'session.attempt_stopped');
  assert.equal(stopped.length, 1);
  assert.deepEqual([stopped[0].session_id, stopped[0].step_id, stopped[0].cost_not_recorded], ['s1', 'work', true]);
});

test('#233 stopped attempt: with two open sessions of the agent (a fan-out), both are flagged and the attempt sits on the one opened last', () => {
  const at = (min) => new Date(Date.parse('2026-09-20T10:00:00.000Z') + min * 60e3).toISOString();
  const snap = (id, min) => ({ id, agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', step_id: 'work', opened_at: at(min), closed_at: null, turns: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, cost_usd: 0, status: 'idle', provider_session_id: `${id}-cli`, mode: 'handoff' });
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: 'r-fanout', workflow: 'AI Development', mock: false, inputs: {} },
    { ts: at(0), type: 'step.started', step_id: 'work', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: snap('s1', 0) },
    { ts: at(1), type: 'session.opened', session_id: 's2', session: snap('s2', 1) },
    { ts: at(5), type: 'log', level: 'error', message: '[developer] attempt 1/2 failed: Timed out after 240s' },
    { ts: at(9), type: 'step.finished', step_id: 'work', visit: 1, duration_ms: 9 * 60e3, output: {} },
  ];
  const summary = {
    run_id: 'r-fanout', workflow: 'AI Development', status: 'success', mock: false, started_at: at(0), finished_at: at(9), duration_ms: 9 * 60e3,
    cost_usd: 0, sessions: [{ ...snap('s1', 0), status: 'success' }, { ...snap('s2', 1), status: 'success' }],
  };
  const out = loadUpgrade().upgradeRunRecord({ summary, events });
  assert.deepEqual(out.summary.sessions.map((s) => [s.id, s.cost_not_recorded === true]), [['s1', true], ['s2', true]]);
  const stopped = out.events.filter((e) => e.type === 'session.attempt_stopped');
  assert.deepEqual(stopped.map((e) => [e.session_id, e.step_id, e.cost_not_recorded]), [['s2', 'work', true]]);
});

test('#277 multi-result turn: a per-turn run recorded before turn_cost costs each turn its highest usage item', () => {
  const { summary, events } = upgraded('#277 multi-result turn');
  near(received(events, 's1', 1).cost_usd, 15.123904, 'the turn\'s cost');
  near(sessionOf(summary, 's1').cost_usd, 15.123904, 'the session\'s cost');
  near(summary.cost_usd, 15.123904, 'the run\'s cost');
  assert.equal(summary.turn_cost, 'max_result');
});

test('sessions in the summary: a summary without sessions gets them from the events\' session snapshots', () => {
  const { summary } = upgraded('no sessions in the summary');
  assert.deepEqual(
    (summary.sessions || []).map((s) => [s.id, s.agent, s.provider, s.turns, Math.round(s.cost_usd * 1e6) / 1e6]),
    [['s1', 'developer', 'claude', 1, 0.8], ['s2', 'reviewer', 'codex', 1, 0.2]],
  );
  assert.deepEqual(sessionOf(summary, 's2').tokens, { input: 5000, output: 700, cache_read: 0, cache_write: 0, reasoning: 0 });
});

test('single issue: a run from before multi-issue runs lists its issue in issues', () => {
  const { summary, events } = upgraded('single issue');
  assert.deepEqual(summary.issues, [42]);
  assert.deepEqual(events.find((e) => e.type === 'workflow.started').issues, [42]);
});

// ---------------------------------------------------------------------------
// The upgrade as a whole
// ---------------------------------------------------------------------------

test('a current run passes through the upgrade unchanged', () => {
  const f = fx.fixture('current');
  const out = loadUpgrade().upgradeRunRecord({ summary: f.summary, events: f.events });
  assert.deepEqual(fx.plain(out.summary), fx.plain(f.summary));
  assert.deepEqual(fx.plain(out.events), fx.plain(f.events));
});

test('the upgrade never changes the record it is given and is idempotent', () => {
  const { upgradeRunRecord } = loadUpgrade();
  for (const f of fx.fixtures()) {
    const before = JSON.stringify({ summary: f.summary, events: f.events });
    const once = upgradeRunRecord({ summary: f.summary, events: f.events });
    assert.equal(JSON.stringify({ summary: f.summary, events: f.events }), before, `${f.name}: the input is not mutated`);
    const twice = upgradeRunRecord({ summary: once.summary, events: once.events });
    assert.deepEqual(fx.plain(twice), fx.plain(once), `${f.name}: upgrading twice gives the same record`);
  }
});

test('live events without a summary (the renderer) are upgraded too: an old resumed turn costs only itself', () => {
  const { summary, events } = upgraded('running (no summary.json)');
  assert.equal(summary, null);
  near(received(events, 's1', 1).cost_usd, 3.21, 'turn 1');
  near(received(events, 's1', 2).cost_usd, 0.35, 'turn 2');
});

test('each upgrade is named after its change', () => {
  const names = loadUpgrade().UPGRADES.map((u) => u.name);
  assert.ok(names.some((n) => /#233/.test(n)), `a #233 upgrade in ${JSON.stringify(names)}`);
  assert.ok(names.some((n) => /#277/.test(n)), `a #277 upgrade in ${JSON.stringify(names)}`);
  assert.ok(names.some((n) => /sessions in the summary/i.test(n)), `a "sessions in the summary" upgrade in ${JSON.stringify(names)}`);
});

// ---------------------------------------------------------------------------
// readRunRecord: on read, files never changed
// ---------------------------------------------------------------------------

test('readRunRecord returns the upgraded record of a run folder and never changes its files', (t) => {
  const { readRunRecord } = loadReader();
  const { upgradeRunRecord } = loadUpgrade();
  for (const f of fx.fixtures()) {
    const { dir, eventsText, summaryText } = fx.writeRun(t, f);
    const stat = (name) => fs.statSync(path.join(dir, name)).mtimeMs;
    const mtimes = [stat('events.jsonl'), f.summary ? stat('summary.json') : null];
    const record = readRunRecord(dir);
    assert.deepEqual(fx.plain(record), fx.plain(upgradeRunRecord({ summary: f.summary, events: f.events })), f.name);
    assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), eventsText, `${f.name}: events.jsonl untouched`);
    if (summaryText) assert.equal(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'), summaryText, `${f.name}: summary.json untouched`);
    else assert.equal(fs.existsSync(path.join(dir, 'summary.json')), false, `${f.name}: no summary.json written`);
    assert.deepEqual([stat('events.jsonl'), f.summary ? stat('summary.json') : null], mtimes, `${f.name}: files not rewritten`);
    assert.deepEqual(fs.readdirSync(dir).sort(), f.summary ? ['events.jsonl', 'summary.json'] : ['events.jsonl'], `${f.name}: no file added`);
  }
});

test('readRunRecord of a run still going returns a null summary and its upgraded events', (t) => {
  const f = fx.fixture('running (no summary.json)');
  const { dir } = fx.writeRun(t, f);
  const record = loadReader().readRunRecord(dir);
  assert.equal(record.summary, null);
  assert.equal(record.events.length, f.events.length);
});

test('the run list lists the single issue of an old run that has no summary yet', (t) => {
  const f = fx.fixture('single issue');
  const { runsDir } = fx.writeRun(t, { ...f, summary: null, events: f.events.filter((e) => e.type !== 'workflow.finished') });
  assert.deepEqual(runs.readRun(runsDir, f.runId).issues, [42]);
});

// ---------------------------------------------------------------------------
// Nothing changes in the figures: each reader, each historical shape
// ---------------------------------------------------------------------------

// Figures on which the readers disagreed before the change for the same old run: the expected value
// is the corrected one (the run list's / the Run tab's), the one all readers give after it.
const NO_SESSIONS_ROWS = [
  { id: 's1', agent: 'developer', provider: 'claude', turns: 1, tokens: { input: 400, output: 900, cache_read: 20000, cache_write: 3000, reasoning: 0 }, cost_usd: 0.8 },
  { id: 's2', agent: 'reviewer', provider: 'codex', turns: 1, tokens: { input: 5000, output: 700, cache_read: 0, cache_write: 0, reasoning: 0 }, cost_usd: 0.2 },
];
const KNOWN_DISAGREEMENTS = {
  '#233 cumulative cost': { 'analyzeRun.costUsd': 3.56, 'analyticsTotals.costUsd': 3.56 },
  '#277 multi-result turn': { 'analyzeRun.costUsd': 15.123904, 'analyticsTotals.costUsd': 15.123904, 'analyticsTotals.unpricedTokens': 0 },
  'no sessions in the summary': {
    'runList.costUsd': 1,
    'runList.sessions': NO_SESSIONS_ROWS,
    'estimates.actualCost': 1,
    'analyticsTotals': { tokens: { input: 5400, output: 1600, cache_read: 20000, cache_write: 3000, reasoning: 0, total: 30000 }, costUsd: 1, unpricedTokens: 0, sessions: 2, cacheHitRate: 0.704225352 },
  },
  'single issue': { 'runFigures.issues': [42], 'runFigures.costPerIssue': 0.25 },
};

// The run list measures a run without summary.duration_ms against the clock: the golden's run list
// durations and the roadmap's real time were taken at fx.NOW.
const atFixedClock = (t) => t.mock.timers.enable({ apis: ['Date'], now: fx.NOW });

function expected(name, reader) {
  const value = structuredClone(GOLDEN[name][reader]);
  for (const [key, v] of Object.entries(KNOWN_DISAGREEMENTS[name] || {})) {
    const [r, ...rest] = key.split('.');
    if (r !== reader) continue;
    if (!rest.length) return fx.plain(v);
    let o = value;
    for (const k of rest.slice(0, -1)) o = o[k];
    o[rest[rest.length - 1]] = v;
  }
  return fx.plain(value);
}

test('runFigures (Analytics\' Run tab) on the upgraded record gives the figures it gave before, for every historical shape', (t) => {
  const { readRunRecord } = loadReader();
  for (const f of fx.fixtures().filter((x) => x.summary)) {
    const { dir } = fx.writeRun(t, f);
    assert.deepEqual(fx.plain(runFigures({ ...readRunRecord(dir), now: fx.NOW })), expected(f.name, 'runFigures'), f.name);
  }
});

test('analyzeRun (the Oracle) on the upgraded record gives the figures it gave before, for every historical shape', (t) => {
  const { readRunRecord } = loadReader();
  for (const f of fx.fixtures()) {
    const { dir } = fx.writeRun(t, f);
    const record = readRunRecord(dir);
    assert.deepEqual(fx.plain(analyzeRun(f.runId, record.summary, record.events)), expected(f.name, 'analyzeRun'), f.name);
  }
});

test('the run list (run costs) reads the same run ids, costs and tokens as before, for every historical shape', (t) => {
  atFixedClock(t);
  for (const f of fx.fixtures()) {
    const { runsDir } = fx.writeRun(t, f);
    assert.deepEqual(fx.runRow(runs.readRun(runsDir, f.runId)), expected(f.name, 'runList'), f.name);
  }
});

test('the roadmap\'s real cost and time (cost estimates) are the same as before, for every historical shape', (t) => {
  atFixedClock(t);
  for (const f of fx.fixtures()) {
    const { runsDir } = fx.writeRun(t, f);
    const info = runs.readRun(runsDir, f.runId);
    const byId = new Map([[f.runId, info]]);
    const got = { actualCost: actualCost({ runId: f.runId }, byId), actualTime: actualTime({ runId: f.runId }, byId), stepMinutes: stepMinutes(info) };
    assert.deepEqual(fx.plain(got), expected(f.name, 'estimates'), f.name);
  }
});

test('the Analytics totals are the same as before, for every historical shape', (t) => {
  for (const f of fx.fixtures().filter((x) => x.summary)) {
    const { runsDir } = fx.writeRun(t, f);
    const totals = computeAnalytics({ runsDir, local: fx.ANALYTICS_LOCAL, projects: [], ...fx.ANALYTICS_RANGE }).totals;
    assert.deepEqual(fx.plain(totals), expected(f.name, 'analyticsTotals'), f.name);
  }
});

// ---------------------------------------------------------------------------
// The renderer and the docs
// ---------------------------------------------------------------------------

test('the renderer loads the upgrade before app.js (past-turn costs of live events)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const upgrade = html.indexOf('src="../shared/run-record.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(upgrade >= 0, 'index.html loads ../shared/run-record.js');
  assert.ok(app < 0 || upgrade < app, 'before app.js');
});

test('docs/agents/storage.md says how to add an upgrade when a run\'s shape changes', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agents', 'storage.md'), 'utf8');
  assert.match(doc, /readRunRecord/);
  assert.match(doc, /upgrade/i);
});
