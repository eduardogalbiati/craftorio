// #72: the sessions of an expanded run row (packages/ui-kit/run-list.js sessionCostCell, sessionsTotalRow):
// a session's own cost against the table's total, with a turn of unknown cost, with a user's price
// (Codex records no cost) and with known costs. Sandbox: page-pieces.js loadRunList.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./page-pieces');

const MARK = /≈|unknown/;
const tokens = { input: 1e6, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 1e6 };
const claude = (costUsd, costEstimate) => ({ id: 's1', agent: 'reviewer', provider: 'claude', model: 'x', turns: 1, tokens, costUsd, ...(costEstimate ? { costEstimate } : {}) });
const CODEX = { id: 's2', agent: 'developer', provider: 'codex', model: 'gpt-x', turns: 1, tokens, costUsd: 0 };
const unknown = (extra) => ({ source: 'unknown', model: 'x', cli_version: '2.1.316', cli_cost_usd: 0.24, unknown_cli_usd: 0.24, ...extra });

const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function drawn(sessions, prices) {
  const list = H.loadRunList();
  list.state.usage = { prices };
  const html = list.sessionsTotalRow(sessions);
  const at = html.indexOf('data-testid="run-total-cost"');
  return { cells: sessions.map((s) => textOf(list.sessionCostCell(s))), total: textOf(html.slice(html.indexOf('>', at) + 1, html.indexOf('</td>', at))) };
}

test('#72 a session whose only turn is unknown reads "unknown"; the total counts the CLI\'s figure, marked', () => {
  const { cells, total } = drawn([claude(0.93), claude(0, unknown())]);
  assert.match(cells[0], /^\$0\.93/);
  assert.match(cells[1], /^unknown/);
  assert.equal(total, '≈ $1.17');
});

test('#72 a session with known turns and an unknown last one shows its amount marked', () => {
  const { cells, total } = drawn([claude(0.5, unknown())]);
  assert.match(cells[0], /^≈ \$0\.50/);
  assert.equal(total, '≈ $0.74');
});

test('#72 a session with an unknown turn followed by a priced one is marked, as its total', () => {
  const { cells, total } = drawn([claude(0.5, unknown({ source: 'tokens', cli_cost_usd: 0.9, unknown_cli_usd: 0.1 }))]);
  assert.equal(total, '≈ $0.60');
  assert.match(cells[0], MARK);
});

test('#72 sessions priced from tokens only, or of known cost, are not marked', () => {
  const { cells, total } = drawn([claude(0.5, unknown({ source: 'tokens', unknown_cli_usd: undefined })), claude(0.43)]);
  for (const text of [...cells, total]) assert.doesNotMatch(text, MARK);
  assert.equal(total, '$0.93');
});

test('#72 a Codex session with no price shows no amount and its total is marked', () => {
  const { cells, total } = drawn([CODEX], {});
  assert.equal(cells[0], '—');
  assert.match(total, /^≈/);
});

test('#72 a Codex session with the user\'s price shows in its cell what it adds to the total', () => {
  const { cells, total } = drawn([CODEX], { 'gpt-x': { input: 2, output: 4 } });
  assert.equal(total, '$2.00');
  assert.match(cells[0], /\$2\.00/);
});
