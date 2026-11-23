// #31: a simulated agent session costs nothing. The mock provider (packages/engine/engine/providers.js
// runMock, reached through providers.runTurn with `{ type: 'mock' }`) priced every simulated turn from
// its random tokens (e.g. cost_usd 0.0571), so a simulated run showed spend on the roadmap card, the
// roadmap's Spent and the run chat. Expected: a simulated turn reports costUsd 0 (its result and its
// `usage` stream item), whatever path it takes (a normal answer, the handoff-only follow-up, a turn cut
// on its request budget), and a whole simulated run's session.message_received events and summary
// carry cost_usd 0. Tokens are still reported (only the money is simulated away).
// Acceptance tests written before the code.
//
// Seams: providers.runTurn (the mock adapter's public entry) and a WorkflowRun of a one-step workflow
// in mock mode (its emitted events). Assumed: the developer zeroes cost_usd (a separate
// simulated cost field, if any, is free to add); the event's cost_usd stays a number.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// no simulated waits in this file (read by runMock on every call)
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0';

const MOCK = { type: 'mock' };
const turn = (hint, items = []) => require('../engine/providers').runTurn({
  provider: MOCK, model: 'claude-opus-5-5', prompt: 'Do the step', hint, onItem: (i) => items.push(i),
});
const usageCosts = (items) => items.filter((i) => i.kind === 'usage').map((i) => i.costUsd);

test('#31 a simulated turn\'s result reports costUsd 0', async () => {
  const res = await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer' });
  assert.equal(res.costUsd, 0);
});

test('#31 a simulated turn\'s usage stream item reports costUsd 0', async () => {
  const items = [];
  await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer' }, items);
  assert.deepEqual(usageCosts(items), [0]);
});

test('#31 a simulated turn still reports its tokens (only the cost is zero)', async () => {
  const res = await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer' });
  assert.equal(res.usage.input > 0, true, `input tokens: ${res.usage.input}`);
  assert.equal(res.usage.output > 0, true, `output tokens: ${res.usage.output}`);
});

test('#31 a simulated handoff-only follow-up reports costUsd 0 (result and usage item)', async () => {
  const items = [];
  const res = await turn({ stepId: 'develop', visit: 1, call: 2, agent: 'developer', handoffOnly: true }, items);
  assert.equal(res.costUsd, 0);
  assert.deepEqual(usageCosts(items), [0]);
});

test('#31 a simulated turn cut on its request budget reports costUsd 0 (result and usage item)', async () => {
  const items = [];
  const res = await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer', maxRequests: 5, sequences: { request_budget: { develop: 1 } } }, items);
  assert.equal(res.cut, true, 'the turn took the request-budget path');
  assert.equal(res.costUsd, 0);
  assert.deepEqual(usageCosts(items), [0]);
});

// ---- a whole (one-step) simulated run -----------------------------------------------------------------

const ONE_STEP = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: one-step-31 }
agents:
  a: { provider: claude, model: claude-opus-5-5, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
`;

// The opt-in kept for the tests of the cost mechanics (#233, #302, #262): without it a simulated turn is
// free (above); with sequences.simulated_cost it is priced again from its tokens.
test('#31 sequences.simulated_cost brings back a priced amount for a simulated turn (opt-in for cost tests)', async () => {
  const items = [];
  const res = await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer', sequences: { simulated_cost: true } }, items);
  assert.equal(res.costUsd > 0, true, `costUsd: ${res.costUsd}`);
  assert.deepEqual(usageCosts(items), [res.costUsd]);
});

test('#31 sequences.simulated_cost: false keeps a simulated turn free', async () => {
  const res = await turn({ stepId: 'develop', visit: 1, call: 1, agent: 'developer', sequences: { simulated_cost: false } });
  assert.equal(res.costUsd, 0);
});

// the same step, its agent retried once (a killed attempt is retried)
const ONE_STEP_RETRY = ONE_STEP.replace(
  '  a: { provider: claude, model: claude-opus-5-5, session: ephemeral }',
  '  a: { provider: claude, model: claude-opus-5-5, session: ephemeral, retry: { max_attempts: 2, initial_delay: 10ms } }',
);

async function simulatedRun(t, opts = {}, yaml = ONE_STEP) {
  const { WorkflowRun } = require('../engine/workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-31-'));
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-31-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(runsDir, { recursive: true, force: true }); });
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [], ...opts });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return events;
}

test('#31 every session.message_received of a simulated run carries cost_usd 0', async (t) => {
  const events = await simulatedRun(t);
  const received = events.filter((e) => e.type === 'session.message_received');
  assert.equal(received.length > 0, true, 'the agent answered at least once');
  assert.deepEqual(received.map((e) => e.cost_usd), received.map(() => 0));
});

test('#31 a simulated run\'s summary (workflow.finished) reports cost_usd 0', async (t) => {
  const events = await simulatedRun(t);
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished?.status, 'success', `the run finished: ${finished?.status} ${finished?.error || ''}`);
  assert.equal(finished.summary.cost_usd, 0);
});

// The engine prices a killed attempt from its tokens when the provider reports no cost (#233): a simulated
// attempt killed at its timeout must not be priced either.
test('#31 a simulated attempt killed at its timeout costs nothing (stopped attempt and summary)', async (t) => {
  const events = await simulatedRun(t, { mockSequences: { timeouts: { work: 1 } } }, ONE_STEP_RETRY);
  const stopped = events.filter((e) => e.type === 'session.attempt_stopped');
  assert.equal(stopped.length, 1, 'the first attempt was killed');
  assert.equal(stopped[0].cost_usd, 0);
  assert.equal(stopped[0].estimated, false, 'no estimate from the tokens');
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished?.status, 'success', `the run finished: ${finished?.status} ${finished?.error || ''}`);
  assert.equal(finished.summary.cost_usd, 0);
});
