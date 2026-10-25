// packages/engine/engine/providers.js seedClaudeTotal (#233): a resumed run continuing a persistent Claude
// session after the app restarted seeds the CLI's last running total (the session snapshot's
// cli_total_cost_usd), so its first turn costs only its own part.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClaude, seedClaudeTotal } = require('../engine/providers');

const result = (sid, total) => ({ type: 'result', subtype: 'success', session_id: sid, result: 'ok', total_cost_usd: total, usage: { output_tokens: 10 } });

test('seedClaudeTotal: the first turn after a restart costs the difference with the seeded total', () => {
  seedClaudeTotal('seeded-1', 3.21);
  const acc = {};
  parseClaude(result('seeded-1', 3.56), () => {}, acc);
  assert.equal(acc.costUsd, 0.35);
  assert.equal(acc.cliTotalCostUsd, 3.56);
});

test('seedClaudeTotal: no total or a lower one than already known changes nothing', () => {
  seedClaudeTotal('seeded-2', undefined);
  const first = {};
  parseClaude(result('seeded-2', 1.5), () => {}, first);
  assert.equal(first.costUsd, 1.5);
  seedClaudeTotal('seeded-2', 1.0);
  const second = {};
  parseClaude(result('seeded-2', 2), () => {}, second);
  assert.equal(second.costUsd, 0.5);
});
