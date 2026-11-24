// #369: a Claude turn on a model the installed Claude Code does not know. The CLI writes
// `[claude-code:unrecognized_model] {"model":...}` to stderr and prices the turn at Opus 5.5 rates,
// so the app prices it from its tokens (input, output, cache read, cache write at the session's
// cache tier) with the model's prices: the Claude adapter's price table, overridden by
// settings.prices. The CLI's figure is kept as cli_cost_usd. With no price for the model the cost
// is unknown and the run's limits count the CLI's figure. Known models keep the CLI's cost.
// Also: sessionCost (packages/engine/domains/usage/usage.js) prices cache writes.
// Turn seam: a WorkflowRun whose claude-code provider is node + test/fixtures/fake-claude-unrecognized-model.js
// (calls no model), with the simulation-only guard lifted for each turn test like
// cost-limit-multi-result-277.test.js. Prices in the expected values are per million tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');
const registry = require('@craftorio/shared/providers');
const { sessionCost } = require('../domains/usage/usage');

const near = (actual, expected, msg) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= 1e-6, `${msg}: expected ${expected}, got ${actual}`);
const CLI_COST = 0.185271;

// Runs a two-step workflow (work, then after) on the fake Claude Code; returns its events.
async function runFake(t, { model, unrecognized = true, tier = '1h', prices, maxCost = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-model-369-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guard = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.CRAFTORIO_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude-unrecognized-model.js').replace(/\\/g, '/');
  const args = [fake, '-p', '--model', '{{ model }}', '--tier', tier, ...(unrecognized ? ['--unrecognized'] : [])];
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    ...(maxCost != null ? ['orchestrator:', `  limits: { max_total_cost_usd: ${maxCost} }`] : []),
    'providers:',
    `  claude: { type: claude-code, command: node, args: ${JSON.stringify(args)} }`,
    'agents:',
    `  dev: { provider: claude, model: ${model}, session: ephemeral }`,
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
    '  - { id: after, agent: dev, prompt: "Then this." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs'), ...(prices ? { prices } : {}) });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return events;
}
const received = (events, step) => events.find((e) => e.type === 'session.message_received' && e.step_id === step);

test('a claude-haiku-5-5 session with no settings.prices entry prices its cold resume from the adapter\'s table', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-haiku-5-5' });
  const closed = events.find((e) => e.type === 'session.closed' && e.session?.step_id === 'work');
  assert.ok(closed, 'the work step\'s session closed');
  const usd = closed.session.cold_resume_usd;
  assert.ok(typeof usd === 'number' && usd > 0, `cold_resume_usd ${usd}`);
});

// --- the Claude adapter ---------------------------------------------------------------------------

test('claude adapter: claude-haiku-5-5 is among its models', () => {
  assert.ok(registry.byId('claude').models.includes('claude-haiku-5-5'));
});

test('claude adapter: its price table gives claude-haiku-5-5 US$ 0.10/M input and US$ 0.50/M output, and a cache read price', () => {
  const price = registry.byId('claude').prices?.['claude-haiku-5-5'];
  assert.ok(price, 'a prices entry for claude-haiku-5-5');
  assert.equal(price.input, 0.10);
  assert.equal(price.output, 0.50);
  assert.ok(typeof price.cache_read === 'number' && price.cache_read > 0, 'a cache_read price above 0');
});

// --- sessionCost ----------------------------------------------------------------------------------

test('sessionCost: cache_write tokens are added at the model\'s cache_write price', () => {
  const prices = { 'm-369': { input: 1, output: 2, cache_read: 0.1, cache_write: 3 } };
  // 1M input × 1 + 1M cache_write × 3 = US$ 4
  const cost = sessionCost({ model: 'm-369', tokens: { input: 1e6, output: 0, cache_read: 0, cache_write: 1e6 } }, prices);
  near(cost, 4, 'input plus cache write');
});

test('sessionCost: a settings.prices entry overrides the claude adapter\'s price for cache writes', () => {
  // 17,610 cache write tokens × US$ 5/M = 0.08805
  const cost = sessionCost({ model: 'claude-haiku-5-5', tokens: { cache_write: 17610 } }, { 'claude-haiku-5-5': { input: 1, output: 1, cache_read: 1, cache_write: 5 } });
  near(cost, 0.08805, 'cache write at the overriding price');
});

test('sessionCost: a model without a settings.prices entry is priced from the claude adapter\'s table', () => {
  // 1M input × 0.10 + 1M output × 0.50 = US$ 0.60
  const cost = sessionCost({ model: 'claude-haiku-5-5', tokens: { input: 1e6, output: 1e6 } }, {});
  near(cost, 0.6, 'adapter prices');
});

// --- a Claude turn on a model the CLI does not know --------------------------------------------------

test('an unrecognized_model turn on claude-haiku-5-5 is priced from its tokens, not at the CLI\'s US$ 0.185271', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-haiku-5-5' });
  const r = received(events, 'work');
  assert.ok(r, 'the work step\'s turn was received');
  assert.ok(typeof r.cost_usd === 'number' && r.cost_usd > 0 && r.cost_usd < 0.02, `priced from tokens at Haiku 5.5 rates, got ${r.cost_usd}`);
  assert.equal(r.cost_source, 'tokens');
  assert.equal(r.cli_cost_usd, CLI_COST);
});

test('an unrecognized_model turn with a 1-hour cache prices its cache writes at 2× input when the price sets no cache_write', { timeout: 60000 }, async (t) => {
  // 2×1 + 2,093×10 + 12,616×0.1 + 17,610×2 = 57,413.6 per M = 0.0574136
  const events = await runFake(t, { model: 'claude-haiku-5-5', tier: '1h', prices: { 'claude-haiku-5-5': { input: 1, output: 10, cache_read: 0.1 } } });
  near(received(events, 'work')?.cost_usd, 0.0574136, 'turn cost');
});

test('an unrecognized_model turn with a 5-minute cache prices its cache writes at 1.25× input when the price sets no cache_write', { timeout: 60000 }, async (t) => {
  // 2×1 + 2,093×10 + 12,616×0.1 + 17,610×1.25 = 44,206.1 per M = 0.0442061
  const events = await runFake(t, { model: 'claude-haiku-5-5', tier: '5m', prices: { 'claude-haiku-5-5': { input: 1, output: 10, cache_read: 0.1 } } });
  near(received(events, 'work')?.cost_usd, 0.0442061, 'turn cost');
});

test('an unrecognized_model turn uses an explicit cache_write price of settings.prices', { timeout: 60000 }, async (t) => {
  // 2×1 + 2,093×10 + 12,616×0.1 + 17,610×3 = 75,023.6 per M = 0.0750236
  const events = await runFake(t, { model: 'claude-haiku-5-5', prices: { 'claude-haiku-5-5': { input: 1, output: 10, cache_read: 0.1, cache_write: 3 } } });
  near(received(events, 'work')?.cost_usd, 0.0750236, 'turn cost');
});

test('a run whose unrecognized_model turns are priced from tokens is not stopped by a US$ 0.10 limit the CLI\'s figure would pass', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-haiku-5-5', maxCost: 0.1 });
  assert.equal(events.some((e) => e.type === 'limit.exceeded'), false);
  assert.ok(received(events, 'after'), 'the after step ran');
});

test('the run log warns once per model that Claude Code does not know it', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-haiku-5-5' });
  const warnings = events.filter((e) => e.type === 'log' && /does not know claude-haiku-5-5/.test(e.message || ''));
  assert.equal(warnings.length, 1, 'one warning for two turns on the same model');
  assert.match(warnings[0].message, /estimated from tokens/);
});

test('an unrecognized_model turn on a model with no price records an unknown cost, never the CLI\'s figure', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-unknown-9' });
  const r = received(events, 'work');
  assert.ok(r, 'the work step\'s turn was received');
  assert.equal(r.cost_usd, null);
  assert.equal(r.cost_source, 'unknown');
  assert.match(r.cost_note || '', /no price for claude-unknown-9/);
  assert.equal(r.cli_cost_usd, CLI_COST);
});

test('an unrecognized_model turn with no price counts the CLI\'s US$ 0.185271 toward max_total_cost_usd: a US$ 0.10 limit stops the run', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-unknown-9', maxCost: 0.1 });
  const exceeded = events.find((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_cost_usd');
  assert.ok(exceeded, 'a limit.exceeded event for max_total_cost_usd');
  near(exceeded.current, CLI_COST, 'the counted cost');
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'after'), false, 'the next step never starts');
});

// #56: the new Fable, when the installed Claude Code does not know it and the app has no price for it
test('#56 an unrecognized_model turn on claude-fable-5-2 with no price records an unknown cost, never 0 and never the CLI\'s figure', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-fable-5-2' });
  const r = received(events, 'work');
  assert.ok(r, 'the work step\'s turn was received');
  if (registry.byId('claude').prices?.['claude-fable-5-2']) {
    assert.equal(r.cost_source, 'tokens');
    assert.ok(r.cost_usd > 0, `priced above US$ 0, got ${r.cost_usd}`);
  } else {
    assert.deepEqual([r.cost_usd, r.cost_source], [null, 'unknown']);
  }
  assert.equal(r.cli_cost_usd, CLI_COST);
});

test('#56 a run on claude-fable-5-2 stops at its US$ 0.01 limit', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-fable-5-2', maxCost: 0.01 });
  assert.ok(events.some((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_cost_usd'), 'a limit.exceeded event for max_total_cost_usd');
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'after'), false, 'the next step never starts');
});

test('a known model without the unrecognized_model line keeps the CLI\'s cost exactly', { timeout: 60000 }, async (t) => {
  const events = await runFake(t, { model: 'claude-opus-5-5', unrecognized: false });
  const r = received(events, 'work');
  assert.ok(r, 'the work step\'s turn was received');
  assert.equal(r.cost_usd, CLI_COST);
  assert.notEqual(r.cost_source, 'tokens');
  assert.equal(r.cli_cost_usd, undefined);
});
