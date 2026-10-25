// #278 Self-healing through the service, after the change (packages/engine/service/channels/nightwatch.js and the
// owners' inbox rules in packages/engine/service/areas/oracle.js): the repeat and environment detectors on live
// run events (a run first seen mid-way reads its workflow.started from events.jsonl), findings not
// logged again after a restart, the findings-waiting notice once per budget pause and never for a
// muted run, the report's and the morning card's Self-healing day, and acting alone by day only with
// the permission (the owner's own requests keep the daytime rules; LOOP_CAP counted per UTC day).
// The service runs with MULTIAGENT_SIMULATION_ONLY=1; no model is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('../../domains/night/night-watch');
const actions = require('../../domains/oracle/oracle-actions');
const { makeService } = require('./helpers');
const { dayStart, iso, spanInOneDay } = require('./day-span');

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await settle(25);
}

function setup(t, oracleExtra = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  const prev = api['settings:get']().oracle;
  const setOracle = (o) => api['settings:set']({ oracle: { ...prev, wakeScope: 'off', ...oracleExtra, ...o } });
  const log = () => night.readNightLog(dir);
  const detected = () => log().filter((e) => e.type === 'oracle.detected');
  const emit = (ev) => service.events.emit('run:event', ev);
  return { service, api, ws, dir, setOracle, log, detected, emit };
}

const ago = (min) => iso(Date.now() - min * 60e3);
const DAY_MS = 24 * 3600e3;
// spanInOneDay (./day-span.js, #283): a span ending about `endAgoMin` minutes ago inside one UTC day, never inverted
const logAt = (dir, ms, type, data) => night.logNight(dir, type, data, iso(ms));

const started = (runId, issue, ts) => ({ ts, type: 'workflow.started', run_id: runId, workflow: 'AI Development', project_id: 'orchestrator', issues: [{ number: issue, title: `Issue ${issue}` }], mock: false });
const suite = (runId, ts, file) => ({
  ts, type: 'step.finished', run_id: runId, step_id: 'suite', visit: 1, duration_ms: 60e3,
  output: { kind: 'suite', status: 'fail', round: 1, failures: [{ test: `${file} > a test`, file, error: 'EADDRINUSE: address already in use :::7300' }], preexisting: [], base_check: { commit: 'abc12345', ran: true } },
});
const killed = (runId) => ({ type: 'process.killed', run_id: runId, ts: new Date().toISOString(), pid: 4242, command_line: 'node --test test/x.test.js', bytes: 9 * 1024 ** 3, limit_bytes: 8 * 1024 ** 3, step_id: 'test', session: 's1' });
const TOKENS = { input: 102, output: 84376, cache_read: 7714400, cache_write: 198504, reasoning: 0 };
const zeroCostTurn = (runId, turn) => ({ type: 'session.message_received', run_id: runId, ts: new Date().toISOString(), session_id: 's1', turn, step_id: 'implement', text: 'done', usage: TOKENS, cost_usd: 0, duration_ms: 60e3 });

// ---- detectors on live run events ------------------------------------------------------------

test('#278 service: the same command failing three times in one step of a live run is one repeat finding', async (t) => {
  const { setOracle, detected, emit } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  emit(started('r-rep', 278, ago(5)));
  emit({ ts: ago(4), type: 'session.message_sent', run_id: 'r-rep', session_id: 's1', turn: 1, step_id: 'implement', prompt: 'do it' });
  for (let i = 0; i < 4; i++) {
    emit({ ts: ago(3), type: 'session.stream', run_id: 'r-rep', session_id: 's1', turn: 1, item: { kind: 'tool_call', id: `t${i}`, name: 'Bash', input: { command: 'npm run lint' } } });
    emit({ ts: ago(3), type: 'session.stream', run_id: 'r-rep', session_id: 's1', turn: 1, item: { kind: 'tool_result', id: `t${i}`, output: 'Error: exit 1', is_error: true } });
  }
  await waitFor(() => detected().length > 0, 1000);
  await settle();
  const rep = detected().filter((e) => e.kind === 'repeat');
  assert.equal(rep.length, 1);
  assert.equal(rep[0].runId, 'r-rep');
  assert.match(JSON.stringify(rep[0].evidence), /npm run lint/);
});

test('#278 service: two live runs of different issues failing the same test file within an hour are an environment finding; a run first seen mid-way gets its issue and project from events.jsonl', async (t) => {
  const { ws, setOracle, detected, emit } = setup(t);
  // r-b started before this process saw it: only its suite arrives live
  fs.mkdirSync(path.join(ws.runs, 'r-b'), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, 'r-b', 'events.jsonl'), `${JSON.stringify(started('r-b', 271, ago(30)))}\n`);
  setOracle({ selfHealing: true });
  await settle();
  emit(started('r-a', 270, ago(40)));
  emit(suite('r-a', ago(20), 'test/server.test.js'));
  emit(suite('r-b', ago(1), 'test/server.test.js'));
  await waitFor(() => detected().some((e) => e.kind === 'environment' && e.runId === 'r-b'), 1000);
  const env = detected().filter((e) => e.kind === 'environment');
  const b = env.find((e) => e.runId === 'r-b');
  assert.ok(b, `no environment finding for r-b: ${JSON.stringify(env)}`);
  assert.match(JSON.stringify(b.evidence), /test\/server\.test\.js/);
  assert.match(JSON.stringify(b.evidence.issues), /271/);
  assert.equal(b.projectId, 'orchestrator');
  assert.ok(env.length <= 2, 'at most once per run');
});

test('#278 service: a finding already in the night log is not logged again after a restart', async (t) => {
  const { dir, setOracle, detected, emit } = setup(t);
  night.logNight(dir, 'oracle.detected', { id: 'old', kind: 'cost-gap', target: 'r-277', runId: 'r-277', projectId: null, since: ago(60), evidence: { turn: 1 } });
  setOracle({ selfHealing: true });
  await settle();
  emit(zeroCostTurn('r-277', 9));
  emit(killed('r-277'));
  await waitFor(() => detected().length >= 2, 1000);
  await settle();
  assert.deepEqual(detected().map((e) => `${e.kind} ${e.runId}`).sort(), ['cost-gap r-277', 'memory r-277']);
});

// ---- the budget pause and the wake-ups' scope ------------------------------------------------

function pausedSetup(t) {
  const s = setup(t, { wakeScope: 'all' });
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), provider: 'claude', costUsd: 5 })}\n`);
  s.setOracle({ selfHealing: true, dailyBudgetUsd: 1 });
  s.waiting = () => s.api['notifications:list']({ limit: 100 }).items.filter((n) => /finding/i.test(`${n.title} ${n.body}`));
  return s;
}

test('#278 service: findings arriving apart during one budget pause give one findings-waiting notice', async (t) => {
  const { emit, detected, waiting } = pausedSetup(t);
  await settle();
  emit(killed('r-1'));
  await waitFor(() => waiting().length > 0);
  emit(killed('r-2'));
  await waitFor(() => detected().length >= 2);
  await settle(300);
  emit(zeroCostTurn('r-3', 1));
  await waitFor(() => detected().length >= 3);
  await settle(300);
  assert.equal(detected().length, 3);
  assert.equal(waiting().length, 1);
});

test('#278 service: a finding in a muted run is logged but neither wakes the Oracle nor notifies the owner', async (t) => {
  const { api, emit, detected, waiting } = pausedSetup(t);
  await api['oracle:mute']({ runId: 'r-muted', on: true });
  await settle();
  emit(killed('r-muted'));
  await waitFor(() => detected().length > 0, 1000);
  await settle(300);
  assert.deepEqual(detected().map((e) => `${e.kind} ${e.runId}`), ['memory r-muted']);
  assert.equal(waiting().length, 0);
  assert.equal((await api['oracle:history']()).some((m) => m.kind === 'wake' || m.kind === 'wake-refused'), false);
});

test('#278 service: with wake-ups off a finding is logged and no wake-up is attempted, even under a paused budget', async (t) => {
  const { setOracle, api, emit, detected, waiting } = pausedSetup(t);
  setOracle({ selfHealing: true, dailyBudgetUsd: 1, wakeScope: 'off' });
  await settle();
  emit(killed('r-quiet'));
  await waitFor(() => detected().length > 0, 1000);
  await settle(300);
  assert.equal(detected().length, 1);
  assert.equal(waiting().length, 0);
  assert.equal((await api['oracle:history']()).some((m) => m.kind === 'wake' || m.kind === 'wake-refused'), false);
});

// ---- the report and the morning card ---------------------------------------------------------

test('#278 service: nightwatch:report has the Self-healing day with its counts and its line', async (t) => {
  const { api, dir } = setup(t);
  const s = spanInOneDay(30);
  logAt(dir, s.start, 'oracle.watch', { on: true, until: null, startedAt: iso(s.start), by: 'Self-healing', selfHealing: true });
  logAt(dir, s.mid, 'oracle.detected', { id: 'd1', kind: 'memory', target: 'r1', runId: 'r1', projectId: null, since: iso(s.mid), evidence: { command: 'node --test' } });
  logAt(dir, s.mid, 'oracle.action', { actionId: 'a1', kind: 'dispatch.restart', target: 'all', permission: 'dispatch', auto: true, ok: true });
  logAt(dir, s.mid, 'oracle.escalated', { target: 'r2', runId: 'r2', reason: 'gate', recommendation: 'answer it' });
  logAt(dir, s.end, 'oracle.watch', { on: false, until: null, startedAt: iso(s.start), by: 'Self-healing', selfHealing: true });
  const r = await api['nightwatch:report']();
  const day = r.nights.find((m) => m.window.selfHealing);
  assert.ok(day, `no Self-healing window: ${JSON.stringify(r.nights.map((m) => m.window))}`);
  assert.equal(day.selfHealing.day, s.day);
  assert.equal(day.selfHealing.detected, 1);
  assert.equal(day.selfHealing.repaired, 1);
  assert.equal(day.selfHealing.waiting, 1);
  assert.equal(typeof day.summary.selfHealing, 'string');
  assert.match(day.summary.selfHealing, /1 detected/);
});

function logEndedNight(dir, endAgoMin) {
  const end = Date.now() - endAgoMin * 60e3;
  const start = end - 6 * 3600e3;
  logAt(dir, start, 'oracle.watch', { on: true, until: iso(end + 3600e3), startedAt: iso(start), by: 'Night watch screen' });
  logAt(dir, end, 'oracle.watch', { on: false, until: iso(end + 3600e3), startedAt: iso(start), by: 'Night watch screen' });
}
function logHealingDay(dir, endAgoMin) {
  const s = spanInOneDay(endAgoMin);
  logAt(dir, s.start, 'oracle.watch', { on: true, until: null, startedAt: iso(s.start), by: 'Self-healing', selfHealing: true });
  logAt(dir, s.end, 'oracle.watch', { on: false, until: null, startedAt: iso(s.start), by: 'Self-healing', selfHealing: true });
}

test('#278 service: the morning card shows the Self-healing day when it ended after the last night', async (t) => {
  const { api, dir } = setup(t);
  logEndedNight(dir, 10 * 60);
  logHealingDay(dir, 30);
  const m = await api['nightwatch:morning']();
  assert.ok(m, 'no morning card');
  assert.equal(m.window.selfHealing, true);
  assert.equal(typeof m.summary.selfHealing, 'string');
});

test('#278 service: the morning card shows the night when it ended after the last Self-healing day', async (t) => {
  const { api, dir } = setup(t);
  logHealingDay(dir, 8 * 60);
  logEndedNight(dir, 30);
  const m = await api['nightwatch:morning']();
  assert.ok(m, 'no morning card');
  assert.equal(!!m.window.selfHealing, false);
  assert.equal(m.summary.selfHealing, undefined);
});

// ---- acting alone by day (the owners' inboxes) -------------------------------------------------

const ask = (api, kind, params = {}) => api['oracle:requestAgent']({ to: 'supervisor', kind, params, reason: 'self-healing', mock: true });

test('#278 service: by day under Self-healing, the Oracle\'s request with its permission checked runs alone and is logged as an automatic action', async (t) => {
  const { api, setOracle, log } = setup(t);
  await api['nightwatch:permissions']({ allowed: ['dispatch'] });
  setOracle({ selfHealing: true });
  await settle();
  const out = await ask(api, 'dispatch.restart');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  assert.equal(log().filter((e) => e.type === 'oracle.action' && e.auto && e.kind === 'dispatch.restart').length, 1);
});

test('#278 service: by day under Self-healing, the Oracle\'s request without its permission waits for the owner and is logged blocked', async (t) => {
  const { api, setOracle, log } = setup(t);
  await api['nightwatch:permissions']({ allowed: ['retry'] });
  setOracle({ selfHealing: true });
  await settle();
  const out = await ask(api, 'dispatch.restart');
  assert.equal(out.pending, true, JSON.stringify(out));
  const blocked = log().filter((e) => e.type === 'oracle.blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, 'permission');
  assert.equal(log().some((e) => e.type === 'oracle.action' && e.auto), false);
});

test('#278 service: by day without Self-healing, the same request waits for the owner as today', async (t) => {
  const { api, setOracle } = setup(t);
  await api['nightwatch:permissions']({ allowed: ['dispatch'] });
  setOracle({ selfHealing: false });
  await settle();
  const out = await ask(api, 'dispatch.restart');
  assert.equal(out.pending, true, JSON.stringify(out));
});

test('#278 service: under Self-healing, a direct request (not the Oracle\'s model) keeps the daytime rule and runs at once without the permission', async (t) => {
  const { api, setOracle } = setup(t);
  await api['nightwatch:permissions']({ allowed: ['retry'] });
  setOracle({ selfHealing: true });
  await settle();
  const out = await api['supervisor:request']({ kind: 'dispatch.restart', params: {}, reason: 'stuck', from: 'oracle', ref: 'direct-278', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
});

test('#278 service: under Self-healing LOOP_CAP counts the automatic actions of the UTC day, not those of the day before', async (t) => {
  const { api, dir, setOracle, log } = setup(t);
  // the standing watch has been on for two days
  actions.markSelfHealing(dir, true, Date.now() - 2 * DAY_MS);
  const yesterday = dayStart(Date.now()) - 3600e3;
  for (let i = 0; i < night.LOOP_CAP; i++) logAt(dir, yesterday, 'oracle.action', { actionId: `y${i}`, kind: 'dispatch.restart', target: 'all', permission: 'dispatch', auto: true, ok: true });
  await api['nightwatch:permissions']({ allowed: ['dispatch'] });
  setOracle({ selfHealing: true });
  await settle();
  for (let i = 0; i < night.LOOP_CAP; i++) {
    const out = await ask(api, 'dispatch.restart');
    assert.equal(out.pending, undefined, `action ${i + 1} of today runs alone: ${JSON.stringify(out)}`);
  }
  const over = await ask(api, 'dispatch.restart');
  assert.equal(over.pending, true, JSON.stringify(over));
  const blocked = log().filter((e) => e.type === 'oracle.blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, 'loop');
});
