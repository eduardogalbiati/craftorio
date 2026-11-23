// #30 on the definitions of the workflows whose rule_check goes back to develop (feature and the AI
// Development heroes): an environment failure of the rule checks (no dependencies installed) never
// sends the developer back nor counts as a developer round; the run stops once at a gate whose retry
// runs the check again. A rule failure still goes back to develop as before (#404). Acceptance tests
// written before the code.
//
// Contract (the interface these tests assume):
//   rule_check's output (packages/engine/engine/check-step.js runCheck, see
//   check-step-environment-30.test.js) has, when status is 'fail', failure_kind: 'environment' | 'rules'
//   and a one-line `cause`.
//   - rule_check: status 'fail' with failure_kind 'environment' goes to the gate `check_environment`
//     (whatever vars.check_returns says), leaving vars.check_returns as it was; failure_kind 'rules'
//     takes the #404 routes (develop twice, then check_failed).
//   - check_environment: a human_approval step whose summary and message show
//     steps.rule_check.output.cause; choices `retry` (label "Try again", the English text of the
//     catalog key engine.check_environment_retry, "Tentar de novo" in pt-BR) going to rule_check, and
//     `stop` ending the run as failed.
//   - check_failed's summary (the gate's brief) shows steps.rule_check.output.cause, one line, never
//     the first lines of a stack trace.
// Seam: the loaded workflow (loadWorkflow) and the engine's own template evaluator, as in
// docs-check-workflow-757.test.js; no whole simulated run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { render, evalExpr } = require('../engine/run/templates');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = [
  'workflows/feature.yaml',
  '.craftorio/workflows/ai-development-local-hero.yaml',
  '.craftorio/workflows/ai-development-remote-hero.yaml',
];
const defaults = (wf) => Object.fromEntries(Object.entries(wf.inputs || {}).map(([k, v]) => [k, v && v.default !== undefined ? v.default : '']));

// the transition the engine takes for this scope (first `when` that holds), with its `set` applied
function take(step, scope) {
  for (const tr of step.transitions || []) {
    let ok = false;
    try { ok = !tr.when || !!evalExpr(String(tr.when), scope); } catch { ok = false; }
    if (!ok) continue;
    const vars = { ...scope.vars };
    for (const [k, v] of Object.entries(tr.set || {})) vars[k] = typeof v === 'string' ? render(v, scope) : v;
    return { goto: tr.goto, status: tr.status || null, vars };
  }
  return { goto: null, status: null, vars: scope.vars };
}

const CAUSE = 'as dependências do projeto não estão instaladas: rode npm ci em /repos/widgets';
const STACK = [
  "Error: Cannot find module 'fixture-dep-30'",
  'Require stack:',
  '- /repos/widgets/check.js',
  '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)',
  '    at Module._load (node:internal/modules/cjs/loader:1051:27)',
  "  code: 'MODULE_NOT_FOUND',",
];
const environment = { kind: 'check', status: 'fail', failure_kind: 'environment', cause: CAUSE, command: 'npm run check', findings: STACK, message: `\`npm run check\` exited with code 1:\n${STACK.join('\n')}`, exit_code: 1 };
const rules = { kind: 'check', status: 'fail', failure_kind: 'rules', cause: '`npm run check` exited with code 1: layers: src/a.js:2 requires src/b.js', command: 'npm run check', findings: ['layers: src/a.js:2 requires src/b.js'], message: '`npm run check` exited with code 1:\nlayers: src/a.js:2 requires src/b.js', exit_code: 1 };

function scopeOf(wf, output, vars = {}) {
  return { inputs: defaults(wf), vars, output, worktree_dir: '', steps: { rule_check: { output }, develop: { output: { branch: 'craftorio/widgets-30' } } } };
}

for (const file of WORKFLOWS) {
  const wfOf = () => loadWorkflow(path.join(ROOT, ...file.split('/')));
  const stepOf = (wf, id) => wf.steps.find((s) => s.id === id);

  test(`#30 ${file}: an environment failure of rule_check goes to check_environment, not develop`, () => {
    const wf = wfOf();
    const next = take(stepOf(wf, 'rule_check'), scopeOf(wf, environment, {}));
    assert.equal(next.goto, 'check_environment');
  });

  test(`#30 ${file}: an environment failure does not count as a developer round`, () => {
    const wf = wfOf();
    const next = take(stepOf(wf, 'rule_check'), scopeOf(wf, environment, { check_returns: '1' }));
    assert.equal(next.goto, 'check_environment');
    assert.equal(String(next.vars.check_returns), '1');
  });

  test(`#30 ${file}: with the rounds used up, an environment failure still goes to check_environment, not check_failed`, () => {
    const wf = wfOf();
    const next = take(stepOf(wf, 'rule_check'), scopeOf(wf, environment, { check_returns: '2' }));
    assert.equal(next.goto, 'check_environment');
  });

  test(`#30 ${file}: a rule failure still goes back to develop twice, then to check_failed (unchanged)`, () => {
    const wf = wfOf();
    const step = stepOf(wf, 'rule_check');
    const first = take(step, scopeOf(wf, rules, {}));
    assert.equal(first.goto, 'develop');
    const second = take(step, scopeOf(wf, rules, first.vars));
    assert.equal(second.goto, 'develop');
    const third = take(step, scopeOf(wf, rules, second.vars));
    assert.equal(third.goto, 'check_failed');
  });

  test(`#30 ${file}: check_environment is a gate whose Try again reruns rule_check and Stop ends the run failed`, () => {
    const wf = wfOf();
    const gate = stepOf(wf, 'check_environment');
    assert.ok(gate, `${file} has no check_environment step`);
    assert.equal(gate.type, 'human_approval');
    const retry = (gate.choices || []).find((c) => c.id === 'retry');
    assert.ok(retry, 'a retry choice');
    assert.equal(retry.label, 'Try again');
    const scope = { ...scopeOf(wf, environment, {}), choice: 'retry' };
    assert.equal(take(gate, scope).goto, 'rule_check');
    const stop = take(gate, { ...scope, choice: 'stop' });
    assert.equal(stop.goto, 'end');
    assert.equal(stop.status, 'failed');
  });

  test(`#30 ${file}: check_environment's brief and message show the cause, no stack frame`, () => {
    const wf = wfOf();
    const gate = stepOf(wf, 'check_environment');
    assert.ok(gate, `${file} has no check_environment step`);
    const scope = scopeOf(wf, environment, {});
    const summary = render(String(gate.summary || ''), scope);
    const message = render(String(gate.message || ''), scope);
    assert.equal(summary.includes(CAUSE), true, summary);
    assert.equal(message.includes(CAUSE), true, message);
    assert.equal(/(^|\n)\s*(- ✖ )?at /.test(summary), false, summary);
  });

  test(`#30 ${file}: check_failed's brief shows the cause in one line, not the first lines of a stack trace`, () => {
    const wf = wfOf();
    const gate = stepOf(wf, 'check_failed');
    const crash = { ...rules, cause: "`npm run check` exited with code 1: Error: Cannot find module './src/renamed-away.js'", findings: STACK };
    const summary = render(String(gate.summary || ''), scopeOf(wf, crash, { check_returns: '2' }));
    assert.equal(summary.includes(crash.cause), true, summary);
    assert.equal(/(^|\n)\s*(- ✖ )?at /.test(summary), false, summary);
    assert.equal(summary.includes('Require stack'), false, summary);
  });
}
