// #244 acceptance tests (written before the code): the Oracle's accurate per-turn cost, code-only
// wake notices, short fresh sessions seeded from oracle/state.md, and the queue behind a wake-up.
// Seams: spentOn / usageRuns (packages/engine/domains/oracle/oracle.js), createOracle's ask / wake / state / history, and
// createWake (packages/engine/domains/oracle/oracle-wake.js) wired to oracle.wake the way packages/engine/service/areas/oracle.js does
// (onWake gets { lines, runIds, kinds }). Everything is simulated (mock: true): "no model call" is
// observed as no provider session started (state().sessionId stays null) and no simulated answer.
// Time is the only thing mocked (node:test's Date mock) for the idle-session rule (55 min).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const oracle = require('../../domains/oracle/oracle');
const { createWake } = require('../../domains/oracle/oracle-wake');

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg || 'value'}: expected ${expected}, got ${actual}`);

function tmpDir(t, prefix = 'oracle-244-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// usage.jsonl lines as the app wrote them before #244: costUsd is Claude's total_cost_usd, cumulative
// for a resumed session
function writeUsage(dir, lines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), `${lines.map((l) => JSON.stringify({ provider: 'claude', model: 'claude-opus-5-5', tokens: {}, ...l })).join('\n')}\n`);
}

function makeOracle(dir, { settings = {} } = {}) {
  return oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('Simulation only: no real model in tests.'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => settings,
  });
}

// the service's wiring of the wake-ups (packages/engine/service/areas/oracle.js), simulated
function wire(t, o, dir) {
  const events = new EventEmitter();
  const wake = createWake({ events, settings: () => ({}), file: () => path.join(dir, 'wake.json'), onWake: (batch) => o.wake({ ...batch, mock: true }), batchMs: 60e3 });
  t.after(() => wake.stop());
  return { events, wake };
}

// ---- per-turn cost (task "Per-turn cost") -------------------------------------------------------

test('#244 spentOn: a resumed session\'s cumulative costs count once per turn (the difference with the previous line of the same session)', (t) => {
  const dir = tmpDir(t);
  writeUsage(dir, [
    { ts: '2026-10-02T08:00:00Z', sessionId: 's-a', costUsd: 0.5 },
    { ts: '2026-10-02T08:10:00Z', sessionId: 's-a', costUsd: 1.2 },
    { ts: '2026-10-02T08:20:00Z', sessionId: 's-a', costUsd: 2.0 },
    // a new provider session starts its own series
    { ts: '2026-10-02T09:00:00Z', sessionId: 's-b', costUsd: 0.3 },
    { ts: '2026-10-02T09:10:00Z', sessionId: 's-b', costUsd: 0.9 },
  ]);
  // real: 0.5 + 0.7 + 0.8 + 0.3 + 0.6 = 2.9 (the old sum, 4.9, counted every turn's whole session)
  near(oracle.spentOn(dir, new Date('2026-10-02T12:00:00Z')), 2.9, 'today\'s real spend');
});

test('#244 spentOn: a session that runs past midnight (UTC) counts each turn on the day it ran', (t) => {
  const dir = tmpDir(t);
  writeUsage(dir, [
    { ts: '2026-10-02T23:00:00Z', sessionId: 's-night', costUsd: 0.4 },
    { ts: '2026-10-02T23:30:00Z', sessionId: 's-night', costUsd: 1.0 },
    { ts: '2026-10-03T00:30:00Z', sessionId: 's-night', costUsd: 1.5 },
  ]);
  near(oracle.spentOn(dir, new Date('2026-10-02T23:59:00Z')), 1.0, 'Oct 2');
  near(oracle.spentOn(dir, new Date('2026-10-03T12:00:00Z')), 0.5, 'Oct 3 (only the third turn)');
});

test('#244 usageRuns: each session entry carries the turn\'s own cost (Usage and the monthly budgets read it), and the file is never rewritten', (t) => {
  const dir = tmpDir(t);
  writeUsage(dir, [
    { ts: '2026-10-02T08:00:00Z', sessionId: 's-a', costUsd: 0.5 },
    { ts: '2026-10-02T08:10:00Z', sessionId: 's-a', costUsd: 1.2 },
    { ts: '2026-10-02T08:20:00Z', sessionId: 's-a', costUsd: 2.0 },
  ]);
  const before = fs.readFileSync(path.join(dir, 'usage.jsonl'), 'utf8');
  const [day] = oracle.usageRuns(dir);
  assert.equal(day.run_id, 'oracle-2026-10-02');
  const costs = day.sessions.map((s) => s.cost_usd);
  assert.equal(costs.length, 3);
  near(costs[0], 0.5, 'turn 1');
  near(costs[1], 0.7, 'turn 2');
  near(costs[2], 0.8, 'turn 3');
  assert.equal(fs.readFileSync(path.join(dir, 'usage.jsonl'), 'utf8'), before, 'old lines are corrected when read, never rewritten');
});

test('#244 budget: a cumulative series whose real sum is under the daily cap does not pause the Oracle, and a question is answered', async (t) => {
  const dir = tmpDir(t);
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60e3).toISOString();
  // reported (old sum) 0.2 + 0.4 + 0.6 + 0.8 = 2.0 over a 1.0 cap; real 0.8
  writeUsage(dir, [
    { ts: at(4), sessionId: 's-a', costUsd: 0.2 },
    { ts: at(3), sessionId: 's-a', costUsd: 0.4 },
    { ts: at(2), sessionId: 's-a', costUsd: 0.6 },
    { ts: at(1), sessionId: 's-a', costUsd: 0.8 },
  ]);
  // the test's lines are today's unless it runs across midnight UTC (then they are partly yesterday's: still under the cap)
  const o = makeOracle(dir, { settings: { oracle: { dailyBudgetUsd: 1 } } });
  t.after(() => o.release());
  const st = o.state();
  assert.equal(st.paused, false, 'no false budget pause');
  assert.ok(st.today.spentUsd <= 0.8 + 1e-9, `today's spend is the real one (got ${st.today.spentUsd})`);
  const out = await o.ask({ question: 'Are you there?', mock: true });
  assert.equal(out.refused, undefined);
  assert.equal(out.message.role, 'oracle');
});

// ---- code-only notices for routine wake-ups (task "Code-only notices") ----------------------------

const ROUTINE = [
  ['a run that finished', { type: 'workflow.finished', run_id: 'r-ok', status: 'succeeded', summary: { cost_usd: 0.42 } }, [/r-ok/, /succeeded/, /\$0\.42/]],
  ['a run that was cancelled', { type: 'workflow.finished', run_id: 'r-cancel', status: 'cancelled' }, [/r-cancel/, /cancel/i]],
  ['a run that was interrupted', { type: 'run.interrupted', run_id: 'r-int' }, [/r-int/, /interrupt/i]],
  ['a supervisor retry', { type: 'supervisor.decision', run_id: 'r-retry', action: 'retry', step_id: 'build' }, [/r-retry/, /retry/i]],
  ['a supervisor resume', { type: 'supervisor.decision', run_id: 'r-resume', action: 'resume', step_id: 'build' }, [/r-resume/, /resume/i]],
];

for (const [label, ev, patterns] of ROUTINE) {
  test(`#244 wake: ${label} posts a code-only notice (run id, status) and makes no model call`, async (t) => {
    const dir = tmpDir(t);
    const o = makeOracle(dir);
    t.after(() => o.release());
    const { events, wake } = wire(t, o, dir);
    events.emit('run:event', { ts: '2026-10-03T10:00:00Z', ...ev });
    await wake.flush();

    assert.equal(o.state().sessionId, null, 'no model turn started a provider session');
    const msgs = o.history();
    assert.ok(!msgs.some((m) => /Simulated Oracle/.test(String(m.text || ''))), 'no (simulated) model answer was posted');
    const notice = msgs.find((m) => patterns.every((p) => p.test(String(m.text || ''))));
    assert.ok(notice, `a notice names the run and its status; got: ${JSON.stringify(msgs.map((m) => m.text))}`);
    assert.ok(!(Number(notice.costUsd) > 0), 'a notice costs nothing');
  });
}

test('#244 wake: a human gate still wakes the model (a decision kind starts a turn)', async (t) => {
  const dir = tmpDir(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  const { events, wake } = wire(t, o, dir);
  events.emit('run:event', { ts: '2026-10-03T10:00:00Z', type: 'approval.requested', run_id: 'r-gate', step_id: 'review', message: 'Approve the change?' });
  await wake.flush();
  assert.ok(o.state().sessionId, 'a model turn ran');
  assert.ok(o.history().some((m) => m.role === 'oracle' && m.wake), 'the Oracle answered the wake-up');
});

// ---- queue and refusals (task "Queue and refusals") ---------------------------------------------

test('#244 queue: an owner question sent during a wake turn waits for it and is answered, instead of failing', async (t) => {
  const dir = tmpDir(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  const waking = o.wake({ lines: ['10:00:00 r-gate: gate review waits for the owner'], runIds: ['r-gate'], kinds: ['gate'], mock: true });
  const asked = await o.ask({ question: 'What happened to r-gate?', mock: true });
  await waking;
  assert.equal(asked.message.role, 'oracle');
  const msgs = o.history();
  const q = msgs.findIndex((m) => m.role === 'user' && m.text === 'What happened to r-gate?');
  assert.ok(q >= 0, 'the question is in the conversation');
  assert.ok(!msgs[q].unanswered, 'and it got its answer');
});

test('#244 refusals: a question refused by the daily budget is logged in the conversation', async (t) => {
  const dir = tmpDir(t);
  writeUsage(dir, [{ ts: new Date().toISOString(), costUsd: 5 }]);
  const o = makeOracle(dir, { settings: { oracle: { dailyBudgetUsd: 1 } } });
  t.after(() => o.release());
  const out = await o.ask({ question: 'Refused question 244', mock: true });
  assert.equal(out.refused.reason, 'daily-budget');
  assert.ok(o.history().some((m) => String(m.text || '').includes('Refused question 244')), 'the refused question is kept');
});

test('#244 refusals: wake-ups refused by the budget go into one digest message, not 2 messages each', async (t) => {
  const dir = tmpDir(t);
  writeUsage(dir, [{ ts: new Date().toISOString(), costUsd: 5 }]);
  const o = makeOracle(dir, { settings: { oracle: { dailyBudgetUsd: 1 } } });
  t.after(() => o.release());
  for (const id of ['r-1', 'r-2', 'r-3']) {
    const res = await o.wake({ lines: [`10:00:00 ${id}: gate review waits for the owner`], runIds: [id], kinds: ['gate'], mock: true });
    assert.ok(res.refused, `${id}'s wake-up is refused by the budget`);
  }
  const msgs = o.history();
  assert.ok(msgs.length <= 1, `at most one digest message for 3 refused wake-ups; got ${msgs.length}: ${JSON.stringify(msgs.map((m) => m.text))}`);
});

// ---- fresh sessions from oracle/state.md, rotation on idle (tasks "Fresh sessions", "Context cap and rotation")

test('#244 state file: after a turn the service writes oracle/state.md with the last exchange, without a model call', async (t) => {
  const dir = tmpDir(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'Please keep an eye on run r-77', mock: true });
  const file = path.join(dir, 'state.md');
  assert.ok(fs.existsSync(file), 'oracle/state.md exists');
  assert.match(fs.readFileSync(file, 'utf8'), /keep an eye on run r-77/);
});

test('#244 sessions: the Oracle resumes while warm (last turn under 55 min ago) and starts a fresh session after an idle gap', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T08:00:00Z') });
  const dir = tmpDir(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  const min = 60e3;

  await o.ask({ question: 'turn 1', mock: true });
  const first = o.state().sessionId;
  assert.ok(first);

  t.mock.timers.tick(40 * min);
  await o.ask({ question: 'turn 2 (40 min later)', mock: true });
  assert.equal(o.state().sessionId, first, 'warm: resumed');

  t.mock.timers.tick(40 * min); // 80 min after the session started, 40 after the last turn
  await o.ask({ question: 'turn 3 (40 min after the last)', mock: true });
  assert.equal(o.state().sessionId, first, 'warmth counts from the last turn, not the session start');

  t.mock.timers.tick(60 * min);
  await o.ask({ question: 'turn 4 (after a 60 min gap)', mock: true });
  assert.notEqual(o.state().sessionId, first, 'idle past the cache lifetime: a fresh session');
});

test('#244 sessions: a session idle for 2 h (state.json) starts fresh from state.md, with no compaction handoff', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T10:00:00Z') });
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ sessionId: 's-old', model: 'claude-opus-5-5', contextTokens: 20000, lastTurnAt: '2026-10-03T08:00:00Z' }));
  fs.writeFileSync(path.join(dir, 'state.md'), '# Oracle state\n\nWatching run r-idle-marker.\n');
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'Anything new?', mock: true });
  const msgs = o.history();
  assert.equal(msgs.filter((m) => m.role === 'oracle').at(-1).session, 'fresh');
  assert.equal(msgs.filter((m) => m.kind === 'compaction' || m.kind === 'model-change').length, 0, 'no handoff message');
  assert.notEqual(o.state().sessionId, 's-old');
  assert.ok(!fs.existsSync(path.join(dir, 'handoffs')) || fs.readdirSync(path.join(dir, 'handoffs')).length === 0, 'no handoff note written');
  assert.match(fs.readFileSync(path.join(dir, 'session.md'), 'utf8'), /r-idle-marker/);
});

test('#244 sessions: a session whose last turn was 10 min ago (state.json) is resumed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T10:00:00Z') });
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ sessionId: 's-warm', model: 'claude-opus-5-5', contextTokens: 20000, lastTurnAt: '2026-10-03T09:50:00Z' }));
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'Anything new?', mock: true });
  assert.equal(o.history().filter((m) => m.role === 'oracle').at(-1).session, 'resumed');
  assert.equal(o.state().sessionId, 's-warm');
});

test('#244 state file: it survives a restart and seeds the fresh session that follows an idle gap', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T08:00:00Z') });
  const dir = tmpDir(t);
  const o1 = makeOracle(dir);
  await o1.ask({ question: 'Watch run r-88 for me', mock: true });
  const first = o1.state().sessionId;
  o1.release();

  const o2 = makeOracle(dir);
  t.after(() => o2.release());
  assert.match(fs.readFileSync(path.join(dir, 'state.md'), 'utf8'), /r-88/, 'state.md is still there after the restart');

  t.mock.timers.tick(2 * 60 * 60e3);
  await o2.ask({ question: 'Good morning', mock: true });
  assert.notEqual(o2.state().sessionId, first, 'a fresh session after the idle gap');
  const opening = fs.readFileSync(path.join(dir, 'session.md'), 'utf8');
  assert.match(opening, /r-88/, 'the fresh session\'s opening prompt carries the state file');
  assert.match(opening, /Good morning/);
});
