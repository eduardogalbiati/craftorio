// #117 (developer's tests): SessionCost details behind the "unknown" / "partial" costs.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../session-cost');

const usage = { input: 1e6, output: 1e6 };
const prices = { 'm-priced': { input: 1, output: 2 } };

test('#117 a turn with no cost recorded is priced from its tokens when its model has a price', () => {
  const ev = { cost_usd: null, usage, session: { provider: 'codex', model: 'm-priced' } };
  assert.deepEqual(C.turnCost(ev, prices), { usd: 3, approx: false });
});

test('#117 a turn with no cost recorded and no price is unknown', () => {
  const ev = { cost_usd: null, usage, session: { provider: 'codex', model: 'gpt-6-luna' } };
  assert.deepEqual(C.turnCost(ev, prices), { usd: 0, approx: true, unknown: true });
});

test('#117 a session of unknown cost with no CLI figure makes the run total unknown, not $0.00', () => {
  const s = { provider: 'claude-code', model: 'x', cost_usd: 0, cost_estimate: { source: 'unknown', unknown_cli_usd: 0 }, tokens: { input: 10 } };
  const total = C.runCost([s], null);
  assert.equal(total.unknown, true);
  assert.equal(total.partial, false);
});

test('#117 a priced session next to an unpriced one makes the total partial', () => {
  const priced = { provider: 'claude-code', model: 'x', cost_usd: 0.5, tokens: { input: 10 } };
  const unpriced = { provider: 'codex', model: 'gpt-6-luna', cost_usd: null, tokens: { input: 10 } };
  assert.deepEqual(C.runCost([priced, unpriced], null), { usd: 0.5, approx: true, unknown: false, partial: true });
});
