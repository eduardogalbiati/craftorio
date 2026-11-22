// #337 (acceptance tests, written before the code): runs in progress get tonight's limits. A
// WorkflowRun built and never started; its checks are called the way a run calls them before a turn.
// The API these tests pin down (the developer implements it):
//   - WorkflowRun option `nightLimits`: () => tonight's settings ({ multiplier } | { values }) or null,
//     called at EACH check (never once at start): the service passes packages/engine/domains/night/night-limits.js tonightLimits.
//   - run.effectiveLimits() → { context, cost, duration, turns }: the limits in force now
//     (night-limits.js effectiveLimits over the workflow's own limits after their templates and the
//     #262 model lift, tonight's settings and the highest limits this run was granted so far).
//   - checkLimits() (duration, cost), contextGate(stepId) (context) and turnTimeout(agent) (turn
//     timeout, × turns) use them. A run keeps the highest limit it was granted after the watch ends.
//   - run.noteLimitsRaised(): the service calls it on every live run when the owner raises the limits;
//     a context_limit gate already open stays open (never answered, skipped or timed out) and gets a
//     `note` (in pendingGates()) saying the limits were raised after it opened.
// Never relaxed: the provider monthly budgets (checkBudget) and a cost limit of 0 (no limit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const H = 3600e3;
const FIXTURE = ({ cost = 120 } = {}) => `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-night-limits-337 }
inputs:
  context_limit: { type: string, default: 40M }
  turn_minutes: { type: string, default: "20" }
providers:
  claude: { type: claude-code, command: claude, args: ["-p", "--model", "{{ model }}"] }
orchestrator:
  limits:
    max_total_duration: 8h
    max_total_cost_usd: ${cost}
    max_total_context: "{{ inputs.context_limit }}"
agents:
  dev: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: "{{ inputs.turn_minutes }}m" }
steps:
  - id: develop
    agent: dev
    prompt: "Implement it."
`;

function newRun(t, { text = FIXTURE(), inputs = {}, ...options } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-night-limits-337-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  const run = new WorkflowRun({ file, inputs, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  run.orchestrator = { id: 'orchestrator' };
  const events = [];
  run.on('event', (ev) => events.push(ev));
  return { run, events };
}

// what the run's agents read and spent so far
function used(run, { context = 0, cost = 0 } = {}) {
  run.sessions.clear();
  run.sessions.set('s1', { id: 's1', agent: 'dev', costUsd: cost, tokens: { input: 0, output: 0, cache_read: context, cache_write: 0 } });
}

// contextGate with the gate stubbed: → the gates it asked for
async function contextAsks(run) {
  const asked = [];
  const real = run.requestApproval;
  run.requestApproval = async (g) => { asked.push(g.id); return { answer: 'continue' }; };
  try { await run.contextGate('develop'); } finally { run.requestApproval = real; }
  return asked;
}

const fields = (e) => ({ context: e.context, cost: e.cost, duration: e.duration, turns: e.turns });

test('#337 effectiveLimits of a run from a multiplier: context, cost and duration of the workflow times it', (t) => {
  const { run } = newRun(t, { nightLimits: () => ({ multiplier: 2 }) });
  assert.deepEqual(fields(run.effectiveLimits()), { context: 80000000, cost: 240, duration: 57600000, turns: 2 });
  assert.equal(run.maxTotalCost(), 240);
});

test('#337 effectiveLimits of a run from tonight\'s custom values', (t) => {
  const { run } = newRun(t, { nightLimits: () => ({ values: { context: 100000000, cost: 300, duration: 43200000, turns: 3 } }) });
  assert.deepEqual(fields(run.effectiveLimits()), { context: 100000000, cost: 300, duration: 43200000, turns: 3 });
});

test('#337 a template-valued limit is rendered first, then multiplied: context and the agent turn timeout', (t) => {
  const { run } = newRun(t, { inputs: { context_limit: '10M', turn_minutes: '25' }, nightLimits: () => ({ multiplier: 2 }) });
  assert.equal(run.effectiveLimits().context, 20000000);
  // 25m × 2
  assert.equal(run.turnTimeout(run.wf.agents.dev), 3000000);
});

test('#337 the #262 model lift comes first: a model whose max_total_cost_usd is 200 doubles to 400', (t) => {
  const { run } = newRun(t, { models: { 'claude-opus-5-5': { max_total_cost_usd: 200, timeout_factor: 1.5 } }, nightLimits: () => ({ multiplier: 2 }) });
  assert.equal(run.maxTotalCost(), 400);
  assert.equal(run.effectiveLimits().cost, 400);
  // 20m × 1.5 (the model) × 2 (tonight)
  assert.equal(run.turnTimeout(run.wf.agents.dev), 3600000);
});

test('#337 a run in progress picks up a raise at its next cost check', (t) => {
  let tonight = { multiplier: 1.5 };
  const { run } = newRun(t, { nightLimits: () => tonight });
  run.startedAt = Date.now() - H;
  used(run, { cost: 200 });
  assert.throws(() => run.checkLimits(), /Maximum cost exceeded \(US\$ 180/);
  tonight = { multiplier: 2 };
  assert.doesNotThrow(() => run.checkLimits());
});

test('#337 a run in progress picks up a raise at its next context check, before the next agent turn', async (t) => {
  let tonight = { multiplier: 1.5 };
  const { run } = newRun(t, { nightLimits: () => tonight });
  used(run, { context: 50000000 });
  assert.deepEqual(await contextAsks(run), [], 'under 60M tonight: no pause (the day limit is 40M)');
  used(run, { context: 70000000 });
  tonight = { multiplier: 2 };
  assert.deepEqual(await contextAsks(run), [], 'under 80M after the raise: no pause');
});

test('#337 a run in progress picks up a raise at its next duration check', (t) => {
  let tonight = null;
  const { run } = newRun(t, { nightLimits: () => tonight });
  run.startedAt = Date.now() - 9 * H;
  used(run, {});
  assert.throws(() => run.checkLimits(), /Maximum duration exceeded/);
  tonight = { multiplier: 2 };
  assert.doesNotThrow(() => run.checkLimits());
});

test('#337 the turn timeout follows tonight\'s settings when a turn starts', (t) => {
  let tonight = null;
  const { run } = newRun(t, { nightLimits: () => tonight });
  assert.equal(run.turnTimeout(run.wf.agents.dev), 1200000);
  tonight = { multiplier: 3 };
  assert.equal(run.turnTimeout(run.wf.agents.dev), 3600000);
});

test('#337 a run keeps its granted limits after the watch ends; a run starting afterwards gets the day limits', async (t) => {
  let tonight = { multiplier: 2 };
  const { run } = newRun(t, { nightLimits: () => tonight });
  run.startedAt = Date.now() - 10 * H;
  used(run, { context: 70000000, cost: 200 });
  assert.doesNotThrow(() => run.checkLimits());
  assert.deepEqual(await contextAsks(run), []);
  assert.equal(run.turnTimeout(run.wf.agents.dev), 2400000);
  // the morning: the watch ended
  tonight = null;
  assert.doesNotThrow(() => run.checkLimits(), 'duration and cost keep the granted limits');
  assert.deepEqual(await contextAsks(run), [], 'context keeps the granted limit');
  assert.equal(run.turnTimeout(run.wf.agents.dev), 2400000);
  assert.deepEqual(fields(run.effectiveLimits()), { context: 80000000, cost: 240, duration: 57600000, turns: 2 });

  const { run: later } = newRun(t, { nightLimits: () => null });
  later.startedAt = Date.now() - 10 * H;
  used(later, { context: 70000000, cost: 200 });
  assert.throws(() => later.checkLimits(), /Maximum (duration|cost) exceeded/);
  assert.deepEqual(fields(later.effectiveLimits()), { context: 40000000, cost: 120, duration: 28800000, turns: 1 });
});

test('#337 an open context_limit gate is not answered by a raise: it stays open with a note that the limits were raised after it opened', async (t) => {
  let tonight = null;
  const { run, events } = newRun(t, { nightLimits: () => tonight });
  used(run, { context: 50000000 });
  let settled = false;
  const paused = run.contextGate('develop').then(() => { settled = true; }, () => { settled = true; });
  await new Promise((r) => setImmediate(r));
  try {
    assert.deepEqual(run.pendingGates().map((g) => g.step_id), ['develop:context_limit']);
    tonight = { multiplier: 3 };
    run.noteLimitsRaised();
    await new Promise((r) => setTimeout(r, 50));
    const gates = run.pendingGates();
    assert.deepEqual(gates.map((g) => g.step_id), ['develop:context_limit'], 'the gate is still open');
    assert.match(String(gates[0].note || ''), /limits were raised after it opened/i);
    assert.equal(events.filter((e) => e.type === 'approval.resolved').length, 0);
    assert.equal(settled, false, 'the run still waits for the owner');
  } finally {
    for (const g of run.pendingGates()) run.resolveApproval(g.approval_id, 'continue');
    await paused;
  }
});

test('#337 never relaxed: a cost limit of 0 stays no limit, whatever tonight says', (t) => {
  for (const tonight of [{ multiplier: 3 }, { values: { cost: 500 } }]) {
    const { run } = newRun(t, { text: FIXTURE({ cost: 0 }), nightLimits: () => tonight });
    assert.equal(run.maxTotalCost(), 0, JSON.stringify(tonight));
    run.startedAt = Date.now();
    used(run, { cost: 10000 });
    assert.doesNotThrow(() => run.checkLimits());
  }
});

test('#337 never relaxed: a provider monthly budget still blocks a turn under expanded limits', (t) => {
  const { run } = newRun(t, { nightLimits: () => ({ multiplier: 3 }), budget: { claude: { name: 'Claude', limitUsd: 10, usedUsd: 12, blockOnLimit: true } } });
  used(run, {});
  assert.throws(() => run.checkBudget('claude'), /Monthly budget for Claude reached/);
});
