// Release summary (#290): workflows/release.yaml gets a read-only `review` step ("Release summary")
// between the last green suite (`unit` with e2e_suite: skip, else `e2e`) and the `ship` gate. A cheap
// agent (claude-sonnet-5-5, ephemeral session, 5-minute timeout, no edit/write tools, no web, no
// subagents) reads the round-by-round trail, every fix round's output, the suites' results, the fix
// branch's `git log --stat`, the release version, the project's version file and its last tags,
// and writes a summary (verdict; Timeline; The fixes; Before you ship; Follow-ups) that leads the Ship
// gate's message and is saved as release-summary.md in the run folder (Reports artifact). It is
// skipped when both suites were green on their first round with no fix; a review that fails does
// not block: the gate opens with a line saying the summary is missing.
// Observed only through public surface: the workflow YAML (loadWorkflow), a mock WorkflowRun's
// events (step.started, session.message_sent's rendered prompt, approval.requested's message and
// choices) and its run folder (run.runDir). Harness copied from test/release-workflow-260.test.js.
// Mock limits: the mock provider answers a string field with a fixed text per field name (not per
// visit), so the fix rounds' outputs cannot differ; the prompt is checked to carry every round's
// output by counting occurrences. The mock developer commits nothing, so the fix branch's diff is
// checked loosely (its branch name or a `git log` mention).
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/release-summary-290.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'release.yaml');
const load = () => loadWorkflow(WORKFLOW);
const stepById = (wf, id) => wf.steps.find((s) => s.id === id);
const reviewOf = (wf) => {
  const step = stepById(wf, 'review');
  assert.ok(step, 'workflows/release.yaml has a step `review`');
  return step;
};
const agentNameOf = (step) => step?.agent || step?.delegate?.agent;

// a duration (`5m`, `300s`, `300000ms`, a number of ms) in seconds
function seconds(v) {
  if (typeof v === 'number') return v / 1000;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(String(v ?? ''));
  if (!m) return NaN;
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 'ms'];
}

// ---- the step in the YAML ----------------------------------------------------------------------

test('release workflow: a `review` step "Release summary" runs a cheap read-only agent (sonnet, ephemeral, 5 minutes, no edit/write, no web, no subagents) (#290)', () => {
  const wf = load();
  const review = reviewOf(wf);
  assert.equal(review.display, 'Release summary');
  const name = agentNameOf(review);
  assert.ok(name, 'the review step runs an agent');
  const agent = wf.agents?.[name];
  assert.ok(agent, `the agent ${name} is defined`);
  assert.equal(agent.model, 'claude-sonnet-5-5');
  assert.equal(agent.session, 'ephemeral');
  assert.equal(seconds(review.timeout ?? agent.timeout), 300, `a 5-minute timeout (got ${review.timeout ?? agent.timeout})`);
  const caps = review.capabilities || agent.capabilities || {};
  const tools = (caps.tools || []).map(String);
  assert.deepEqual(tools.filter((x) => /^(edit|write)$/i.test(x)), [], `no edit/write tools (got ${tools.join(', ')})`);
  assert.equal(caps.web, false);
  assert.equal(caps.subagents, false);
});

test('release workflow: the last green suite leads to `review` and every transition of `review` leads to `ship` (#290)', () => {
  const wf = load();
  const review = reviewOf(wf);
  const passOf = (id) => (stepById(wf, id).transitions || []).filter((t) => /pass/.test(String(t.when)));
  assert.ok(passOf('e2e').some((t) => t.goto === 'review'), 'a green e2e suite can go to review');
  assert.ok(passOf('unit').some((t) => /skip/.test(String(t.when)) && t.goto === 'review'), 'a green unit suite with e2e_suite skip can go to review');
  const transitions = review.transitions || [];
  assert.ok(transitions.length > 0, 'review has transitions');
  assert.deepEqual([...new Set(transitions.map((t) => t.goto))], ['ship'], 'every transition of review goes to ship');
});
