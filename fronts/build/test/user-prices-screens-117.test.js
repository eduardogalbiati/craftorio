// #117: a Codex turn with no recorded cost (cost_usd null) whose model has a price only in the user's
// prices (Usage › Prices, state.usage.prices) is priced on the screens, never "unknown": the run chat's
// turn foot, header (#rc-cost) and final note, and the Run screen's turn head. Whole page, as
// run-chat-unknown-cost-72.test.js and renderer-unknown-cost-117.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const RUN = 'r-117-user-prices';
const MODEL = 'gpt-117-user-priced';
const PRICES = { [MODEL]: { input: 2, output: 8 } }; // 1M input tokens → $2.00
const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const USAGE = { input: 1e6, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };

function events() {
  let seq = 0;
  const ev = (s, type, fields) => ({ seq: ++seq, run_id: RUN, ts: new Date(T0 + s * 1000).toISOString(), type, ...fields });
  const snap = { agent: 'developer', provider: 'codex', model: MODEL, turns: 0, status: 'idle', tokens: {}, cost_usd: 0 };
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'Fix it' }, mock: false, steps: [{ id: 'develop', agent: 'developer' }] }),
    ev(1, 'session.opened', { session_id: 's-dev', session: snap }),
    ev(1, 'step.started', { step_id: 'develop', agent: 'developer' }),
    ev(2, 'session.message_sent', { session_id: 's-dev', turn: 1, step_id: 'develop', prompt: 'Do it.' }),
    ev(52, 'session.message_received', { session_id: 's-dev', turn: 1, step_id: 'develop', text: 'Done.', duration_ms: 50000, usage: USAGE, cost_usd: null, session: { ...snap, turns: 1, tokens: USAGE } }),
    ev(52, 'step.finished', { step_id: 'develop' }),
    ev(60, 'workflow.finished', { status: 'success', error: '', summary: { duration_ms: 60000 } }),
  ];
}

async function pageWithPrices(opts) {
  const page = await loadPage(opts);
  await settle(5);
  page.sandbox.__prices = PRICES;
  page.run('state.usage = { ...(state.usage || {}), prices: __prices }');
  return page;
}

test('#117 run chat: a Codex turn priced only by the user\'s prices shows the amount in its foot, header and final note', { timeout: 60000 }, async () => {
  const page = await pageWithPrices({ api: { runEvents: async () => events() } });
  page.sandbox.openRunChat({ runId: RUN, workflow: 'w', running: false });
  await settle(20);
  const all = (sel) => [...page.document.querySelectorAll(sel)].map((x) => textOf(x).trim());
  const header = textOf(page.$('#rc-cost')).trim();
  const feet = all('.duo-foot');
  const end = all('[data-testid="run-chat-finished"]')[0] || '';
  assert.equal(feet.length, 1);
  for (const text of [header, feet[0], end]) {
    assert.match(text, /\$2\.00/);
    assert.doesNotMatch(text, /unknown|partial/i);
  }
});

test('#117 Run screen: a Codex turn priced only by the user\'s prices shows the amount in its head, not "unknown" nor "—"', { timeout: 60000 }, async () => {
  const page = await pageWithPrices();
  for (const ev of events()) for (const fn of page.handlers.onEvent || []) fn(ev);
  await settle(20);
  page.run(`state.view = 'run'; state.runId = ${JSON.stringify(RUN)}; state.selected = 's-dev'; renderDetail()`);
  await settle(5);
  const heads = [...page.$('#tab-detail').querySelectorAll('.turn-head .meta')].map((x) => textOf(x).trim());
  assert.equal(heads.length, 1, 'the Run screen draws the Codex turn');
  assert.doesNotMatch(heads[0], /unknown/i);
  assert.match(heads[0], /\$2\.00/);
});
