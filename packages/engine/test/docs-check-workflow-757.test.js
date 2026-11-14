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

  test(`#757 ${file}: going on after a check gives the next review round its own return to develop`, () => {
    const wf = wfOf();
    const step = wf.steps.find((s) => s.id === STEP);
    assert.ok(step, `${file} has no ${STEP} step`);
    const base = { inputs: defaults(wf), steps: {}, worktree_dir: '' };
    const missing = { kind: 'docs_check', status: 'missing', missing: ['docs/agents/guide.md'], message: 'docs expected: 1, touched: 0' };
    for (const status of ['pass', 'skipped']) {
      const back = take(step, { ...base, vars: {}, output: missing });
      assert.equal(back.goto, 'develop');
      const on = take(step, { ...base, vars: back.vars, output: { kind: 'docs_check', status, missing: [], message: '' } });
      assert.notEqual(on.goto, 'develop');
      const nextRound = take(step, { ...base, vars: on.vars, output: missing });
      assert.equal(nextRound.goto, 'develop', `after a ${status} check, a missing doc in the next round returns again`);
    }
  });

  test(`#757 ${file}: after a passing rule check or test id check, a task with docs goes to docs_check and one without does not`, () => {
    const wf = wfOf();
    const byId = Object.fromEntries(wf.steps.map((s) => [s.id, s]));
    const withDocs = 'Add the guide\n\n## Expected files\n\n- `src/app.js`: the code\n- `docs/agents/guide.md` (new): the guide\n';
    const withoutDocs = 'Add the guide\n\n## Expected files\n\n- `src/app.js`: the code\n';
    const develop = { committed: true, files_changed: ['src/app.js'], screenshots: [], issues: [], left_out: [] };
    const checked = ['rule_check', 'testid_check'].filter((id) => byId[id]);
    assert.ok(checked.includes('rule_check'), `${file} has rule_check`);
    for (const id of checked) {
      const scope = (task) => ({ inputs: { ...defaults(wf), task, issues: [], screenshots: 'off' }, steps: { develop: { output: develop } }, worktree_dir: '', vars: {}, output: { status: 'pass', missing: [], findings: [] } });
      assert.equal(take(byId[id], scope(withDocs)).goto, STEP, `${id} passed with docs expected goes to ${STEP}`);
      const other = take(byId[id], scope(withoutDocs)).goto;
      assert.ok(other && other !== STEP, `${id} passed without docs expected does not visit ${STEP} (got ${other})`);
    }
  });

  test(`#757 ${file}: continuing at the check_failed gate goes to docs_check when the task expects docs`, (t) => {
    const wf = wfOf();
    const gate = wf.steps.find((s) => s.id === 'check_failed');
    if (!gate) return t.skip(`${file} has no check_failed gate`);
    const task = 'Add the guide\n\n## Expected files\n\n- `docs/agents/guide.md` (new): the guide\n';
    const scope = { inputs: { ...defaults(wf), task, issues: [], screenshots: 'off' }, steps: { develop: { output: { committed: true, files_changed: [], screenshots: [], issues: [] } } }, worktree_dir: '', vars: {}, output: {}, choice: 'continue' };
    assert.equal(take(gate, scope).goto, STEP);
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
