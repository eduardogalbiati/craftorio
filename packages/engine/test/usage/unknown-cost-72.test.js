// #72 acceptance tests (written before the code): a run's cost never counts an unknown model as zero.
// A Claude turn on a model the installed Claude Code does not know and the app has no price for
// (cost_estimate.source 'unknown', cost_usd null, the CLI's figure in cost_estimate.cli_cost_usd) was
// summed as 0 by the run list and the roadmap, and as the CLI's figure by Usage and the header.
// Seams: the service's channels on a scratch workspace (runs:list, usage:get, settings:set, po:ask),
// runs.listRuns, usage.computeUsage, cost-estimate.withEstimates, budget.budgetState / meterText, and a
// WorkflowRun on the fake Claude Code of unknown-model-pricing-369.test.js (calls no model).
// Whether a total leaves the unknown turn out ("at least") or counts the CLI's figure ("≈") is the
// developer's: the tests require one number everywhere, to the cent, and a mark on it. How the
// screens draw the mark: renderer-unknown-cost-72 (fronts/build) and renderer-usage-unknown-cost-72
// (fronts/ai).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('../../domains/usage/usage');
const budget = require('../../domains/usage/budget');
const costEstimate = require('../../domains/usage/cost-estimate');
const runs = require('../../domains/run/runs');
const { Recorder } = require('../../engine/recorder');
const { WorkflowRun } = require('../../engine/workflow');
const { makeService, roadmapProject } = require('../service/helpers');

const MARK = /≈|≥|at least/i;
const UNKNOWN = 'claude-unknown-9';
const cents = (n) => Math.round((Number(n) || 0) * 100);
const tok = (input, output, cache_read = 0, cache_write = 0) => ({ input, output, cache_read, cache_write, reasoning: 0 });

function session(agent, model, costUsd, extra = {}) {
  return { id: `s-${agent}`, agent, provider: 'claude', model, step_id: agent, turns: 1, tokens: tok(1000, 2000), cost_usd: costUsd, status: 'success', provider_session_id: `cli-${agent}`, mode: 'ephemeral', ...extra };
}
const unknown = (cli) => ({ cost_estimate: { source: 'unknown', model: UNKNOWN, cli_version: '2.1.316', cli_cost_usd: cli } });
const KNOWN = () => session('developer', 'claude-opus-5-5', 0.93);

// a finished real run started just now, as the engine records it
function writeRun(runsDir, runId, sessions) {
  const at = new Date().toISOString();
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const events = [
    { seq: 1, run_id: runId, ts: at, type: 'workflow.started', workflow: 'wf-72', file: 'wf-72.yaml', mock: false, inputs: { task: 'Fix it' } },
    { seq: 2, run_id: runId, ts: at, type: 'workflow.finished', status: 'success' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'wf-72', status: 'success', mock: false, inputs: { task: 'Fix it' }, started_at: at, finished_at: at, duration_ms: 1000,
    cost_usd: sessions.reduce((a, s) => a + (s.cost_usd || 0), 0), sessions,
  }));
  return runId;
}

// The one run of `runsDir` as each place totals it, in cents
function totalsOf(runsDir, runId, prices = {}) {
  const now = new Date();
  const list = runs.listRuns(runsDir);
  const u = usage.computeUsage({ runsDir, settings: { prices }, now });
  const roadmap = { state: 'done', stages: [{ id: 's1', items: [{ id: 'a', status: 'done', workflow: 'wf-72.yaml', runId, runs: [runId], issues: [] }] }] };
  return {
    'run list': cents(list.find((r) => r.runId === runId)?.costUsd),
    'Usage, its row': cents(u.runs.find((r) => r.runId === runId)?.costUsd),
    'Usage, the month': cents(u.totals.month.costUsd),
    roadmap: cents(costEstimate.withEstimates(roadmap, list, { prices }).stages[0].items[0].actualUsd),
    'header, spent today': cents(budget.budgetState({ settings: { prices, timeZone: 'UTC' }, runs: list, now }).day.spentUsd),
  };
}
function assertOneTotal(totals) {
  assert.equal(new Set(Object.values(totals)).size, 1, `one total, in cents: ${JSON.stringify(totals)}`);
  return Object.values(totals)[0];
}
const meter = (runsDir) => budget.meterText(budget.budgetState({ settings: { timeZone: 'UTC' }, runs: runs.listRuns(runsDir), now: new Date() }));

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-cost-72-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// two turns (work, after) on the fake Claude Code, recorded in <dir>/runs; returns the run's id
async function runFake(t, dir, { model, prices }) {
  const guard = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.CRAFTORIO_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, '..', 'fixtures', 'fake-claude-unrecognized-model.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf-72.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ${JSON.stringify([fake, '-p', '--model', '{{ model }}', '--tier', '1h', '--unrecognized'])} }`,
    'agents:',
    `  dev: { provider: claude, model: ${model}, session: ephemeral }`,
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
    '  - { id: after, agent: dev, prompt: "Then this." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs'), ...(prices ? { prices } : {}) });
  const recorder = new Recorder(run.runDir);
  run.on('event', (ev) => recorder.write(ev));
  await run.start();
  assert.equal(runs.listRuns(path.join(dir, 'runs')).find((r) => r.runId === run.runId)?.status, 'success', 'the run was recorded');
  return run.runId;
}

// --- one total ---------------------------------------------------------------------------------------

test('#72 a run with a US$ 0.93 turn and a turn of unknown cost has the same total in the run list, the roadmap, the header and Usage', (t) => {
  const dir = scratch(t);
  const id = writeRun(dir, '20261125-070829-aaaa0072', [KNOWN(), session('reviewer', UNKNOWN, null, unknown(0.24))]);
  const total = assertOneTotal(totalsOf(dir, id));
  assert.ok(total >= 93, `the known US$ 0.93 is in it, got ${total} cents`);
});

test('#72 a run whose every turn has an unknown cost has the same total everywhere', (t) => {
  const dir = scratch(t);
  const id = writeRun(dir, '20261125-070829-bbbb0072', [session('reviewer', UNKNOWN, null, unknown(0.24))]);
  assertOneTotal(totalsOf(dir, id));
});

test('#72 a real run on a model with neither a CLI nor an app price records a total that every place agrees on', { timeout: 60000 }, async (t) => {
  const dir = scratch(t);
  const id = await runFake(t, dir, { model: UNKNOWN });
  assertOneTotal(totalsOf(path.join(dir, 'runs'), id));
});

test('#72 a run on claude-fable-5-2 with the user\'s price is totalled from its tokens, the same everywhere', { timeout: 60000 }, async (t) => {
  // a turn: 2×10 + 2,093×50 + 12,616×1 + 17,610×20 (1-hour cache writes) = 469,486 per M; two turns = US$ 0.94
  const prices = { 'claude-fable-5-2': { input: 10, output: 50, cache_read: 1 } };
  const dir = scratch(t);
  const id = await runFake(t, dir, { model: 'claude-fable-5-2', prices });
  assert.equal(assertOneTotal(totalsOf(path.join(dir, 'runs'), id, prices)), 94);
});

test('#72 a price added after the run leaves the run list, Usage and the header on one total', async (t) => {
  const { service, api } = makeService(t);
  const id = writeRun(service.workspace().runs, '20261125-070829-cccc0072', [KNOWN(), session('reviewer', UNKNOWN, null, unknown(0.24))]);
  // 1,000 × 100 + 2,000 × 200 per M = US$ 0.50 for the unknown turn
  await api['settings:set']({ timeZone: 'UTC', prices: { [UNKNOWN]: { input: 100, output: 200, cache_read: 1 } } });
  const { runs: rows } = await api['runs:list']({ ids: [id] });
  const snap = await api['usage:get']({ scope: 'orchestrator' });
  assertOneTotal({
    'run list': cents(rows.find((r) => r.runId === id)?.costUsd),
    Usage: cents(snap.runs.find((r) => r.runId === id)?.costUsd),
    'header, spent today': cents(snap.spending?.day?.spentUsd),
  });
});

test('#72 an old run with tokens on an unpriced model and no recorded cost has the same total everywhere', (t) => {
  const dir = scratch(t);
  const id = writeRun(dir, '20261125-070829-dddd0072', [KNOWN(), session('reviewer', UNKNOWN, 0)]);
  assert.equal(assertOneTotal(totalsOf(dir, id)), 93);
});

// --- the header's mark -------------------------------------------------------------------------------

test('#72 the header marks today\'s spending when a run includes a turn of unknown cost', (t) => {
  const dir = scratch(t);
  writeRun(dir, '20261125-070829-eeee0072', [KNOWN(), session('reviewer', UNKNOWN, null, unknown(0.24))]);
  assert.match(meter(dir), MARK);
});

test('#72 the header marks today\'s spending when one session has both priced turns and a turn of unknown cost', (t) => {
  const dir = scratch(t);
  const id = writeRun(dir, '20261125-070829-ffff0072', [session('reviewer', UNKNOWN, 0.5, unknown(0.24))]);
  assertOneTotal(totalsOf(dir, id));
  assert.match(meter(dir), MARK);
});

test('#72 the header leaves today\'s spending unmarked when every cost is known', (t) => {
  const dir = scratch(t);
  writeRun(dir, '20261125-070829-0a0a0072', [KNOWN()]);
  assert.equal(meter(dir), '$0.93 today');
});

// --- the Product Owner and the other direct calls ------------------------------------------------------

const poLine = (costUsd) => `${JSON.stringify({ ts: new Date().toISOString(), agent: 'product-owner', projectId: 'p-72', provider: 'claude', model: 'claude-opus-5-5', tokens: tok(100, 100), costUsd, sessionId: 'po-72', session: 'fresh', startReason: 'one-shot' })}\n`;
function writePo(ws, costUsd) {
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, 'product-owner.usage.jsonl'), poLine(costUsd));
}

test('#72 Usage\'s month total is the run plus the Product Owner\'s call', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  await api['settings:set']({ timeZone: 'UTC' });
  writeRun(ws.runs, '20261125-070829-0b0b0072', [KNOWN()]);
  writePo(ws, 0.37);
  const snap = await api['usage:get']({ scope: 'orchestrator' });
  assert.equal(cents(snap.totals.month.costUsd), 130);
  assert.equal(cents(snap.providers.find((p) => p.id === 'claude').month.costUsd), 130);
});

test('#72 the Product Owner\'s own spend counts once toward its monthly budget: US$ 3 of US$ 5 does not refuse a question', async (t) => {
  const simulation = require('../../engine/simulation');
  const providers = require('../../engine/providers');
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'po-budget-72');
  await api['settings:set']({ timeZone: 'UTC', budgets: { claude: { monthlyUsd: 5, blockOnLimit: true } } });
  writePo(ws, 3);
  const realSimOnly = simulation.simulationOnly;
  const realRunTurn = providers.runTurn;
  t.after(() => { simulation.simulationOnly = realSimOnly; providers.runTurn = realRunTurn; });
  simulation.simulationOnly = () => false;
  providers.runTurn = async () => ({ text: 'Fake answer: no model was called.', usage: tok(1, 1), costUsd: 0.01, exitCode: 0 });
  const out = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: false, mode: 'plan', attachments: [], issues: [] });
  assert.doesNotMatch(String(out.message?.text), /monthly budget/i);
});
