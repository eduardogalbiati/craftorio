// #278 Self-healing through the service (packages/engine/service/channels/nightwatch.js, the settings channel): the
// switch is settings.oracle.selfHealing, saved with settings:set. Acceptance tests written before the code.
// What they pin down (the developer implements it):
//   - Self-healing on: nightwatch:state's `watch` is { active: true, until: null, selfHealing: true };
//     the detectors run by day with no Night watch file (oracle.detected in night-log.jsonl).
//   - turning it off (settings:set) ends the watch at once: an `oracle.watch` entry with on: false is
//     appended to the night log and the watch is no longer active.
//   - a live `session.message_received` with cost_usd 0 and tokens > 0 is a `cost-gap` finding, logged
//     oracle.detected with an `evidence` object, at most once per run and kind.
//   - a human gate under Self-healing is logged oracle.escalated (reason 'gate'), never answered.
//   - while the Oracle's daily budget pauses it, detectors keep logging and the owner gets ONE
//     notification (notification center) whose title or body says findings are waiting (/finding/i).
//   - Self-healing off and no Night watch: nothing is detected (as today; green today).
// The Oracle's wake-ups are turned off (wakeScope 'off') where no budget pause is involved, so no model
// is ever asked; the service runs with CRAFTORIO_SIMULATION_ONLY=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('../../domains/night/night-watch');
const { makeService } = require('./helpers');

const settle = () => new Promise((r) => setTimeout(r, 50));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

function setup(t, oracleExtra = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  const prev = api['settings:get']().oracle;
  const setOracle = (o) => api['settings:set']({ oracle: { ...prev, wakeScope: 'off', ...oracleExtra, ...o } });
  const log = () => night.readNightLog(dir);
  const detected = () => log().filter((e) => e.type === 'oracle.detected');
  return { service, api, dir, setOracle, log, detected };
}

const TOKENS = { input: 102, output: 84376, cache_read: 7714400, cache_write: 198504, reasoning: 0 };
const zeroCostTurn = (runId, turn) => ({ type: 'session.message_received', run_id: runId, ts: new Date().toISOString(), session_id: 's1', turn, step_id: 'implement', text: 'done', usage: TOKENS, cost_usd: 0, duration_ms: 60e3 });
const killed = (runId) => ({ type: 'process.killed', run_id: runId, ts: new Date().toISOString(), pid: 4242, command_line: 'node --test test/x.test.js', bytes: 9 * 1024 ** 3, limit_bytes: 8 * 1024 ** 3, step_id: 'test', session: 's1' });

test('#278 service: Self-healing on is a standing watch (active, no end time) in nightwatch:state', async (t) => {
  const { api, setOracle } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  const { watch } = await api['nightwatch:state']();
  assert.equal(watch.active, true);
  assert.equal(watch.until, null);
  assert.equal(watch.selfHealing, true);
});

test('#278 service: turning Self-healing off ends the watch at once and writes the oracle.watch entry', async (t) => {
  const { api, setOracle, log } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  setOracle({ selfHealing: false });
  await settle();
  const last = log().filter((e) => e.type === 'oracle.watch').at(-1);
  assert.ok(last, 'no oracle.watch entry');
  assert.equal(last.on, false);
  assert.equal((await api['nightwatch:state']()).watch.active, false);
});

test('#278 service: by day under Self-healing, a process stopped by the memory guard is detected (no Night watch)', async (t) => {
  const { service, setOracle, detected } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  service.events.emit('run:event', killed('r-mem'));
  await waitFor(() => detected().length > 0, 1000);
  assert.deepEqual(detected().map((e) => `${e.kind} ${e.runId}`), ['memory r-mem']);
});

test('#278 service: a turn recorded at 0 USD with tokens is one cost-gap finding with evidence, once per run', async (t) => {
  const { service, setOracle, detected } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  for (let turn = 1; turn <= 3; turn++) service.events.emit('run:event', zeroCostTurn('r-277', turn));
  await waitFor(() => detected().length > 0, 1000);
  await settle();
  const gaps = detected().filter((e) => e.kind === 'cost-gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].runId, 'r-277');
  assert.equal(typeof gaps[0].evidence, 'object');
  assert.ok(gaps[0].evidence && Object.keys(gaps[0].evidence).length > 0, 'no evidence');
});

test('#278 service: a human gate under Self-healing is escalated to the owner, never answered', async (t) => {
  const { service, setOracle, log } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  service.events.emit('run:event', { type: 'approval.requested', run_id: 'r-gate', approval_id: 'g1', step_id: 'review', ts: new Date().toISOString() });
  await waitFor(() => log().some((e) => e.type === 'oracle.escalated'), 1000);
  const esc = log().filter((e) => e.type === 'oracle.escalated');
  assert.equal(esc.length, 1);
  assert.equal(esc[0].reason, 'gate');
  assert.equal(log().some((e) => e.type === 'oracle.action'), false);
});

test('#278 service: Self-healing off and no Night watch detects nothing (as today)', async (t) => {
  const { service, setOracle, detected } = setup(t);
  setOracle({ selfHealing: false });
  await settle();
  service.events.emit('run:event', killed('r-off'));
  service.events.emit('run:event', zeroCostTurn('r-off', 1));
  await settle();
  assert.deepEqual(detected(), []);
});

test('#278 service: while the daily budget pauses the Oracle, findings are still logged and the owner gets ONE notification', async (t) => {
  // budget paused: 5 USD spent today against a 1 USD daily limit (no model call can happen)
  const { service, api, dir, setOracle, detected } = setup(t, { wakeScope: 'all' });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), provider: 'claude', costUsd: 5 })}\n`);
  setOracle({ selfHealing: true, dailyBudgetUsd: 1 });
  await settle();
  service.events.emit('run:event', killed('r-1'));
  service.events.emit('run:event', killed('r-2'));
  service.events.emit('run:event', zeroCostTurn('r-3', 1));
  await waitFor(() => detected().length >= 3, 3000);
  assert.deepEqual(detected().map((e) => `${e.kind} ${e.runId}`).sort(), ['cost-gap r-3', 'memory r-1', 'memory r-2']);
  const waiting = () => api['notifications:list']({ limit: 100 }).items.filter((n) => /finding/i.test(`${n.title} ${n.body}`));
  await waitFor(() => waiting().length > 0, 3000);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(waiting().length, 1);
});
