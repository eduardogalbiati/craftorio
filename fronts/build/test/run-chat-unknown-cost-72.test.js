// #72: the run chat (fronts/build/views/runchat): a turn of unknown cost reads "unknown" and the run's
// cost that includes it counts the CLI's figure, marked "≈", while it runs (#rc-cost) and at its end.
// Model: run-chat-model.js directly. Page: the whole page, as renderer-run-chat-simulated-cost-31.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { RunChatModel } = require('../views/runchat/run-chat-model');

const RUN = 'r-72-chat';
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const UNKNOWN = { cost_usd: null, cost_source: 'unknown', cli_cost_usd: 0.24 };
const KNOWN = { cost_usd: 0.24 };

// develop: $0.93; review: the turn `review`; `summary`: what the run's end carries (null: still running)
function events(review, summary) {
  let seq = 0;
  const ev = (s, type, fields) => ({ seq: ++seq, run_id: RUN, ts: new Date(T0 + s * 1000).toISOString(), type, ...fields });
  const turn = (s, id, agent, fields) => [
    ev(s, 'session.opened', { session_id: id, session: { agent, provider: 'claude-code', model: 'claude-opus-5-5' } }),
    ev(s, 'step.started', { step_id: agent, agent }),
    ev(s + 1, 'session.message_sent', { session_id: id, turn: 1, step_id: agent }),
    ev(s + 50, 'session.message_received', { session_id: id, turn: 1, step_id: agent, text: 'Done.', duration_ms: 49000, usage: { input: 10, output: 5 }, ...fields }),
    ev(s + 50, 'step.finished', { step_id: agent }),
  ];
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'Fix it' }, mock: false }),
    ...turn(1, 's1', 'developer', { cost_usd: 0.93 }),
    ...turn(60, 's2', 'reviewer', review),
    ...(summary ? [ev(120, 'workflow.finished', { status: 'success', error: '', summary: { duration_ms: 120000, ...summary } })] : []),
  ];
}
const chatOf = (...args) => {
  const model = new RunChatModel();
  for (const ev of events(...args)) model.apply(ev);
  return model;
};
const cents = (n) => Math.round(n * 100);
const endOf = (model) => {
  const end = model.items.find((it) => it.kind === 'end');
  return [cents(end.cost), end.costApprox];
};

test('#72 run chat model: an unknown turn is unknown and the run counts the CLI\'s figure, marked', () => {
  const model = chatOf(UNKNOWN);
  assert.deepEqual(model.items.filter((it) => it.kind === 'turn').map((it) => it.costUnknown), [false, true]);
  assert.deepEqual([cents(model.run.cost), !!model.run.costApprox], [117, true]);
  const known = chatOf(KNOWN);
  assert.deepEqual([cents(known.run.cost), !!known.run.costApprox], [117, false]);
});

test('#72 run chat model: the end takes its sessions\' total, as every screen', () => {
  const sessions = [{ id: 's1', provider: 'claude', cost_usd: 0.93 }, { id: 's2', provider: 'claude', cost_usd: 0, cost_estimate: { source: 'unknown', model: 'x', cli_cost_usd: 0.24 } }];
  assert.deepEqual(endOf(chatOf(UNKNOWN, { cost_usd: 0.93, sessions })), [117, true]);
  assert.deepEqual(endOf(chatOf(KNOWN, { cost_usd: 0.93, sessions: sessions.slice(0, 1) })), [93, false]);
});

test('#72 run chat model: an end without sessions takes the summary\'s cost and mark, else what the turns spent', () => {
  assert.deepEqual(endOf(chatOf(KNOWN, { cost_usd: 1.5, cost_approx: true })), [150, true]);
  assert.deepEqual(endOf(chatOf(KNOWN, { cost_usd: 1.5 })), [150, false]);
  assert.deepEqual(endOf(chatOf(UNKNOWN, {})), [117, true]);
});

async function drawn(review, summary, lang = 'en') {
  const page = await loadPage({ api: { runEvents: async () => events(review, summary) } });
  page.sandbox.__lang = lang;
  page.run('I18n.setLanguage(__lang)');
  page.sandbox.openRunChat({ runId: RUN, workflow: 'w', running: false });
  await settle(20);
  const all = (sel) => [...page.document.querySelectorAll(sel)].map((x) => textOf(x).trim());
  return { header: textOf(page.$('#rc-cost')).trim(), feet: all('.duo-foot'), end: all('[data-testid="run-chat-finished"]')[0] };
}

for (const [lang, word] of [['en', 'unknown'], ['pt-BR', 'desconhecido']]) {
  test(`#72 run chat (${lang}): the unknown turn's foot reads "${word}", the header and the end are marked`, async () => {
    const { header, feet, end } = await drawn(UNKNOWN, {}, lang);
    assert.match(header, /^≈ \$1\.17/);
    assert.match(end, /≈ \$1\.17/);
    assert.equal(feet.length, 2);
    assert.match(feet[0], /\$0\.93/);
    assert.match(feet[1], new RegExp(word));
    assert.doesNotMatch(feet[1], /\$0\.00/);
  });
}

test('#72 run chat: a run whose costs are all known is not marked', async () => {
  const { header, feet, end } = await drawn(KNOWN, {});
  assert.equal(header, '$1.17');
  for (const text of [...feet, end]) assert.doesNotMatch(text, /≈|unknown/);
});
