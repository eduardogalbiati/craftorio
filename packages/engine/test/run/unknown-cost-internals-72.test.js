// #72 internals: unknown_cli_usd as the engine records it, a child run's mark, the machine scope's totals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { childRunTotal, methods } = require('../../engine/run/costs');
const { computeUsage } = require('../../domains/usage/usage');

const engine = (prices) => ({ prices, unknownModelWarned: new Set(['m']), emitEvent() {} });
const turn = (costUsd) => ({ unrecognized: { model: 'm', cliVersion: '2.1.316' }, costUsd, usage: { input: 1e6 } });

test('#72 priceUnrecognizedTurn keeps the CLI figure of the unknown turns apart from the priced ones', () => {
  const session = { model: 'm' };
  methods.priceUnrecognizedTurn.call(engine({}), session, turn(0.2), {});
  methods.priceUnrecognizedTurn.call(engine({}), session, turn(0.1), {});
  assert.equal(session.costEstimate.unknown_cli_usd, 0.3);
  methods.priceUnrecognizedTurn.call(engine({ m: { input: 2 } }), session, turn(0.5), {});
  assert.equal(session.costEstimate.source, 'tokens');
  assert.equal(session.costEstimate.unknown_cli_usd, 0.3);
  assert.equal(session.costEstimate.cli_cost_usd, 0.8);
});

test('#72 a session whose turns all had a price records no unknown part', () => {
  const session = { model: 'm' };
  methods.priceUnrecognizedTurn.call(engine({ m: { input: 2 } }), session, turn(0.5), {});
  assert.equal('unknown_cli_usd' in session.costEstimate, false);
});

test('#72 a child run result carries the mark of its own and its children runs', () => {
  assert.deepEqual(childRunTotal({ cost_usd: 1 }), { cost_usd: 1 });
  assert.deepEqual(childRunTotal({ cost_usd: 1, cost_approx: true }), { cost_usd: 1, cost_approx: true });
  assert.deepEqual(childRunTotal({ cost_usd: 1, children_cost_usd: 2, child_runs: [{ cost_approx: true }] }), { cost_usd: 3, cost_approx: true });
});

test('#72 the machine scope counts a run session once, with its mark', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-cost-internals-72-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = new Date('2026-11-25T12:00:00Z');
  const at = '2026-11-25T08:00:00.000Z';
  const tokens = { input: 1e6, output: 0, cache_read: 0, cache_write: 0 };
  fs.mkdirSync(path.join(dir, 'r1'));
  fs.writeFileSync(path.join(dir, 'r1', 'summary.json'), JSON.stringify({
    run_id: 'r1', status: 'success', mock: false, started_at: at, cost_accounting: 'per_turn', turn_cost: 'max_result',
    sessions: [{ id: 's1', provider: 'claude', model: 'm', tokens, cost_usd: 0, provider_session_id: 'cli-1', cost_estimate: { source: 'unknown', model: 'm', cli_cost_usd: 0.24 } }],
  }));
  const local = { records: [{ provider: 'claude', model: 'm', ts: at, sessionId: 'cli-1', tokens }], found: { claude: true } };
  const u = computeUsage({ runsDir: dir, settings: { prices: { m: { input: 2 } } }, now, scope: 'machine', local });
  const claude = u.providers.find((p) => p.id === 'claude');
  for (const total of [u.totals.month, claude.month, claude.today, claude.models[0].month]) {
    assert.equal(total.costUsd, 0.24);
    assert.equal(total.costApprox, true);
  }
  assert.equal(claude.month.tokens.total, 1e6);
});
