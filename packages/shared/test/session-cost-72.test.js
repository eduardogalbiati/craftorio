// #72: the one rule of a session's, a turn's and a run's cost (packages/shared/session-cost.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../session-cost');

const tokens = { input: 1e6, output: 0 };
const PRICES = { m: { input: 2, output: 4 } };
const unknown = (extra) => ({ source: 'unknown', model: 'm', cli_cost_usd: 0.24, ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is ${b}`);

test('#72 a session adds the CLI figure of its unknown turns only, never the turns priced from tokens', () => {
  near(C.sessionCost({ cost_usd: 0.5, cost_estimate: unknown() }), 0.74);
  // the last turn had a price: 0.1 of the CLI's 0.9 was the unknown turn's
  near(C.sessionCost({ cost_usd: 0.5, cost_estimate: { source: 'tokens', cli_cost_usd: 0.9, unknown_cli_usd: 0.1 } }), 0.6);
  near(C.sessionCost({ cost_usd: 0.5, cost_estimate: { source: 'tokens', cli_cost_usd: 0.9 } }), 0.5);
});

test('#72 a snapshot and a list view of the same session cost the same', () => {
  near(C.sessionCost({ costUsd: 0.5, costEstimate: unknown() }), C.sessionCost({ cost_usd: 0.5, cost_estimate: unknown() }));
});

test('#72 a price added later leaves what was recorded and prices only a session with nothing recorded', () => {
  near(C.sessionCost({ model: 'm', tokens, cost_usd: 0, cost_estimate: unknown() }, PRICES), 0.24);
  near(C.sessionCost({ model: 'm', tokens, cost_usd: 0 }, PRICES), 2);
  assert.equal(C.sessionCost({ model: 'm', tokens, cost_usd: 0 }, null), null);
  near(C.tokenPricedUsd([{ model: 'm', tokens, cost_usd: 0 }, { cost_usd: 1 }], PRICES), 2);
});

test('#72 a run is approximate with an unknown turn or unpriced tokens, not when simulated or all known', () => {
  const approx = (s, prices) => C.runCost([{ cost_usd: 1, tokens }, s], prices).approx;
  assert.equal(approx({ cost_usd: 0.5, cost_estimate: unknown() }), true);
  assert.equal(approx({ cost_usd: 0, cost_estimate: unknown({ cli_cost_usd: null }) }), true);
  assert.equal(approx({ model: 'x', cost_usd: 0, tokens }), true);
  assert.equal(approx({ model: 'm', cost_usd: 0, tokens }, PRICES), false);
  assert.equal(approx({ provider: 'mock', model: 'x', cost_usd: 0, tokens }), false);
  assert.equal(approx({ provider: 'engine', cost_usd: 0, tokens: {} }), false);
});

test('#72 a turn of unknown cost counts the CLI figure, marked', () => {
  assert.deepEqual(C.turnCost({ cost_usd: null, cost_source: 'unknown', cli_cost_usd: 0.24 }), { usd: 0.24, approx: true });
  assert.deepEqual(C.turnCost({ cost_usd: 0.4, cost_source: 'tokens', cli_cost_usd: 2 }), { usd: 0.4, approx: false });
  assert.deepEqual(C.turnCost({}), { usd: 0, approx: false });
});
