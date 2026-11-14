// #757 on the definitions of the workflows that run `rule_check` (feature and the AI Development
// heroes): a `docs_check` step with no agent, reached from develop through agent-less steps (next to
// rule_check, before code_review), that sends a `missing` result back to develop at most once per
// review round, never to the test writer, and lets `pass` / `skipped` go on.
// Seam: the loaded workflow (loadWorkflow) and the engine's own expression evaluator for the
// transitions. The functions are tested in test/expected-files-757.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { render, evalExpr } = require('../engine/run/templates');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = [
  'workflows/feature.yaml',
  '.multiagent/workflows/ai-development-local-hero.yaml',
  '.multiagent/workflows/ai-development-remote-hero.yaml',
];
const STEP = 'docs_check';
const gotos = (step) => (step.transitions || []).map((tr) => tr.goto).filter(Boolean);
const defaults = (wf) => Object.fromEntries(Object.entries(wf.inputs || {}).map(([k, v]) => [k, v && v.default !== undefined ? v.default : '']));

// the transition the engine takes for this output and vars (first `when` that holds), with its `set` applied
function take(step, scope) {
  for (const tr of step.transitions || []) {
    let ok = false;
    try { ok = !tr.when || !!evalExpr(String(tr.when), scope); } catch { ok = false; }
    if (!ok) continue;
    const vars = { ...scope.vars };
    for (const [k, v] of Object.entries(tr.set || {})) vars[k] = typeof v === 'string' ? render(v, scope) : v;
    return { goto: tr.goto, vars };
  }
  return { goto: null, vars: scope.vars };
}

for (const file of WORKFLOWS) {
  const wfOf = () => loadWorkflow(path.join(ROOT, ...file.split('/')));

  test(`#757 ${file}: a docs_check step with no agent is reached from develop before another agent's turn`, () => {
    const wf = wfOf();
    const byId = Object.fromEntries(wf.steps.map((s) => [s.id, s]));
    const step = byId[STEP];
    assert.ok(step, `${file} has no ${STEP} step`);
    assert.ok(!step.agent, `${STEP} calls no agent`);
    assert.notEqual(step.type, 'human_approval');
    const seen = new Set();
    const queue = gotos(byId.develop);
    let found = false;
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id) || !byId[id]) continue;
      seen.add(id);
      if (id === STEP) { found = true; break; }
      if (!byId[id].agent && byId[id].type !== 'human_approval') queue.push(...gotos(byId[id]));
    }
    assert.ok(found, `${STEP} is not reached from develop before another agent's turn`);
    assert.ok(gotos(step).includes('code_review') || gotos(step).some((id) => byId[id] && !byId[id].agent), `${STEP} goes on towards the review`);
  });

  test(`#757 ${file}: missing docs go back to develop once per round, never to the test writer`, () => {
    const wf = wfOf();
    const step = wf.steps.find((s) => s.id === STEP);
    assert.ok(step, `${file} has no ${STEP} step`);
    const testWriter = new Set(wf.steps.filter((s) => s.agent === 'test_writer').map((s) => s.id));
    assert.deepEqual(gotos(step).filter((id) => testWriter.has(id)), [], 'never to the test writer');
    const base = { inputs: defaults(wf), steps: {}, worktree_dir: '' };
    const missing = { kind: 'docs_check', status: 'missing', missing: ['docs/agents/guide.md'], message: 'docs expected: 1, touched: 0' };
    const first = take(step, { ...base, vars: {}, output: missing });
    assert.equal(first.goto, 'develop', 'the first missing result returns to develop');
    const second = take(step, { ...base, vars: first.vars, output: missing });
    assert.ok(second.goto && second.goto !== 'develop', `the second missing result in the same round does not return again (got ${second.goto})`);
  });

  test(`#757 ${file}: a pass or a skipped check goes on without returning to develop`, () => {
    const wf = wfOf();
    const step = wf.steps.find((s) => s.id === STEP);
    assert.ok(step, `${file} has no ${STEP} step`);
    const base = { inputs: defaults(wf), steps: {}, worktree_dir: '', vars: {} };
    for (const status of ['pass', 'skipped']) {
      const r = take(step, { ...base, output: { kind: 'docs_check', status, missing: [], message: '' } });
      assert.ok(r.goto && r.goto !== 'develop', `${status} goes on (got ${r.goto})`);
    }
  });
}
