// #31: the run chat's header (#rc-cost, fronts/build/views/runchat/runchat.js drawHead) of a simulated
// run showed the cost its simulated sessions recorded ("$0.56"). Runs recorded before the fix keep
// those costs in their events, so the header must not show them: a simulated run reads $0.00 or
// "simulated"; a real run's cost is unchanged.
// Acceptance tests written before the code.
//
// Harness: the whole page (@craftorio/ui-kit/test/agent-chat-page-harness), window.openRunChat({ runId,
// workflow }) with a fake api.runEvents (the boundary), as renderer-run-chat-interrupted-288.test.js.
// Seam: the text of #rc-cost. A simulated run: workflow.started `mock: true` and its session's
// provider `mock`; a real run: `mock: false`, provider claude-code.
// Assumed: "$0.00" or a "simulated" word, the developer's choice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const RUN = 'r-31-cost';
const T0 = Date.parse('2026-11-23T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

// a finished run whose develop step took two turns: $0.2 + $0.36 = $0.56 recorded
function events({ mock }) {
  let seq = 0;
  const ev = (o) => ({ seq: ++seq, run_id: RUN, ...o });
  const provider = mock ? 'mock' : 'claude-code';
  return [
    ev({ type: 'workflow.started', ts: at(0), workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Fix the widget' }, mock }),
    ev({ type: 'session.opened', ts: at(1), session_id: 's1', session: { agent: 'developer', provider, model: 'claude-opus-5-5', ...(mock ? { simulates: 'claude' } : {}) } }),
    ev({ type: 'step.started', ts: at(1), step_id: 'develop', agent: 'developer' }),
    ev({ type: 'session.message_sent', ts: at(2), session_id: 's1', turn: 1, step_id: 'develop' }),
    ev({ type: 'session.message_received', ts: at(60), session_id: 's1', turn: 1, step_id: 'develop', text: 'Working.', cost_usd: 0.2, duration_ms: 58000 }),
    ev({ type: 'session.message_sent', ts: at(61), session_id: 's1', turn: 2, step_id: 'develop' }),
    ev({ type: 'session.message_received', ts: at(120), session_id: 's1', turn: 2, step_id: 'develop', text: 'Done.', cost_usd: 0.36, duration_ms: 59000 }),
    ev({ type: 'step.finished', ts: at(120), step_id: 'develop' }),
    ev({ type: 'workflow.finished', ts: at(121), status: 'success', error: '', summary: { cost_usd: 0.56, duration_ms: 121000 } }),
  ];
}

async function headerCost({ mock }) {
  const page = await loadPage({ api: { runEvents: async () => events({ mock }) } });
  page.sandbox.openRunChat({ runId: RUN, workflow: 'software-development', running: false });
  await settle(20);
  const el = page.$('#rc-cost');
  assert.ok(el, 'the run chat header\'s cost (#rc-cost) is in the page');
  return textOf(el);
}

test('#31 a simulated run\'s chat header does not show the cost its sessions recorded ($0.56)', async () => {
  const text = await headerCost({ mock: true });
  assert.doesNotMatch(text, /0[.,]56/, text);
});

test('#31 a simulated run\'s chat header shows $0.00 or "simulated" as its cost', async () => {
  const text = await headerCost({ mock: true });
  assert.match(text, /0[.,]00|simulad/i, text);
});

test('#31 unchanged: a real run\'s chat header shows its cost $0.56', async () => {
  const text = await headerCost({ mock: false });
  assert.equal(text, '$0.56');
});
