// #337 (acceptance test, written before the code): a simulated night. A Night watch with an end
// time is on, the owner expands every limit ×2 (window.api setNightWatchLimits), and a mock run of a
// workflow whose max_total_context is 40M reads past 40M without pausing at a context_limit gate. By
// day the same run pauses before its third turn (the control). The morning report lists the run as
// past a day limit (summary.limits, packages/engine/domains/night/night-limits.js pastDayLimits).
// The model is the boundary: each mock turn reports 20M more tokens of cache read (wrapping
// packages/engine/engine/providers.js runTurn, which the engine calls through the module).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const actions = require('../../domains/oracle/oracle-actions');
const night = require('../../domains/night/night-watch');
const providers = require('../../engine/providers');
const { makeService } = require('../service/helpers');

const FIXTURE = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-night-limits-337 }
orchestrator:
  limits:
    max_total_duration: 8h
    max_total_cost_usd: 120
    max_total_context: 40M
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: one
    agent: dev
    prompt: first
  - id: two
    agent: dev
    prompt: second
  - id: three
    agent: dev
    prompt: third
`;
const TURN_TOKENS = 20000000;

function payload(params, args) {
  if (!params) return undefined;
  if (typeof params === 'string') return args[0];
  const out = {};
  params.forEach((name, i) => {
    if (name.startsWith('...')) Object.assign(out, args[i]);
    else out[name] = args[i];
  });
  return out;
}
function windowApi(service) {
  const api = {};
  for (const e of service.manifest) {
    if (e.channel && e.method && service.api[e.channel]) api[e.method] = async (...args) => service.api[e.channel](payload(e.params, args));
  }
  return api;
}

function setup(t) {
  const real = providers.runTurn;
  providers.runTurn = async (opts) => {
    const res = await real(opts);
    if (res?.usage) res.usage = { ...res.usage, cache_read: (res.usage.cache_read || 0) + TURN_TOKENS };
    return res;
  };
  t.after(() => { providers.runTurn = real; });
  const { service } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-night-limits-337.yaml'), FIXTURE);
  return { service, api: windowApi(service), dir: ws.oracle || path.join(ws.root, 'oracle') };
}

// starts the run; answers a context_limit gate with Stop; → { end, events }
function runOnce(service) {
  const events = [];
  let runId = null;
  return new Promise((resolve, reject) => {
    service.events.on('run:event', (ev) => {
      if (runId && ev.run_id !== runId) return;
      events.push(ev);
      if (ev.type === 'approval.requested') service.api['approval:resolve']({ runId: ev.run_id, id: ev.approval_id, answer: 'stop' });
      if (ev.type === 'workflow.finished') resolve({ end: ev, events });
    });
    service.api['run:start']({ file: 'fixture-night-limits-337.yaml', inputs: {}, mock: true }).then((r) => { runId = r.runId; }, reject);
  });
}
const contextRead = (events) => events.filter((e) => e.type === 'session.message_received').reduce((n, e) => n + (e.usage?.input || 0) + (e.usage?.cache_read || 0) + (e.usage?.cache_write || 0), 0);
const contextGates = (events) => events.filter((e) => e.type === 'approval.requested' && /context_limit$/.test(e.step_id || '')).map((e) => e.step_id);

test('#337 control: by day the run pauses at the context limit before its third turn', { timeout: 60000 }, async (t) => {
  const { service } = setup(t);
  const { events } = await runOnce(service);
  assert.deepEqual(contextGates(events), ['three:context_limit']);
});

test('#337 a simulated night: with every limit ×2 a run reads past 40M of context without pausing, and the morning report lists it', { timeout: 60000 }, async (t) => {
  const { service, api, dir } = setup(t);
  const w = actions.setNightWatch(dir, { on: true, until: new Date(Date.now() + 8 * 3600e3).toISOString(), by: 'the owner' });
  night.logNight(dir, 'oracle.watch', { on: true, until: w.until, startedAt: w.startedAt, by: w.by });
  await api.setNightWatchLimits({ multiplier: 2 });

  const { end, events } = await runOnce(service);
  assert.equal(end.status, 'success', end.error);
  assert.deepEqual(contextGates(events), [], 'no context_limit gate');
  assert.equal(events.some((e) => e.type === 'limit.exceeded'), false);
  assert.ok(contextRead(events) > 40000000, `read ${contextRead(events)} tokens`);

  const report = await api.nightWatchReport();
  const lines = report.nights[0]?.summary?.limits || [];
  assert.equal(lines.length, 1, JSON.stringify(lines));
  // 3 turns × 20M plus the mock's own random usage (#417): 60M or 60.1M
  assert.match(lines[0], /context \d+(\.\d)?M of 80M tonight \(day limit 40M\)/);
});
