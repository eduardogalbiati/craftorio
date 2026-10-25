// Acceptance tests for #222: workflows/e2e-release.yaml runs the E2E suite in a step without an
// agent (like the suite step, #177); an agent is called only for a red scenario, and the human
// gates stay.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const root = path.join(__dirname, '..', '..', '..');

const load = () => loadWorkflow(path.join(root, 'workflows', 'e2e-release.yaml'));
const stepById = (wf, id) => wf.steps.find((s) => s.id === id);
// the command of a step, its `{{ inputs.x }}` resolved to that input's default
const commandOf = (wf, step) => String(step.command || '').replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, (_, k) => String(wf.inputs?.[k]?.default ?? ''));

test('e2e-release: the first step runs the E2E suite as a command, without an agent', () => {
  const wf = load();
  const first = wf.steps[0];
  assert.equal(first.agent, undefined, `step ${first.id} has no agent`);
  assert.notEqual(first.type, 'human_approval');
  assert.match(commandOf(wf, first), /test:e2e|playwright|bddgen/, `step ${first.id} runs the Playwright suite (got "${commandOf(wf, first)}")`);
});

test('e2e-release: the suite step goes to an agent only when a scenario is red', () => {
  const wf = load();
  const first = wf.steps[0];
  const passes = first.transitions.filter((t) => /pass/.test(String(t.when)));
  assert.ok(passes.length > 0, 'a transition for a green suite');
  for (const t of passes) {
    assert.equal(t.delegate, undefined, `a green suite calls no agent (${t.when})`);
    const next = t.goto && t.goto !== 'end' ? stepById(wf, t.goto) : null;
    assert.ok(!next || !next.agent, `a green suite goes to the end or a gate, not to an agent (${t.when} -> ${t.goto})`);
  }
  const fails = first.transitions.filter((t) => /fail/.test(String(t.when)));
  assert.ok(fails.length > 0, 'a transition for a red scenario');
  assert.ok(fails.some((t) => t.delegate?.agent || stepById(wf, t.goto)?.agent), 'a red scenario reaches an agent (the healer / developer)');
});

test('e2e-release: the human gates stay (approve the fix, failed, blocked)', () => {
  const wf = load();
  const gates = wf.steps.filter((s) => s.type === 'human_approval').map((s) => s.id);
  assert.ok(gates.includes('approve_fixes'), 'approve_fixes stays a human gate');
  const approve = stepById(wf, 'approve_fixes');
  assert.ok(approve.transitions.some((t) => t.merge === 'local'), 'the fix merges locally only after the gate');
});
