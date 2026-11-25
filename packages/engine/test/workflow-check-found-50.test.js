// #50 on the bundled workflows' definitions: fix and refactor get the rule check after the developer's commit,
// with the rounds and the gates feature has (#404, #30), and feature.yaml says what its inputs do. Acceptance
// tests written before the code.
//
// Contract (the interface these tests assume):
// - fix.yaml and refactor.yaml: one `type: check` step (found by its type) running the `check_command` input
//   (empty by default); the developer's committed turn (develop, refactor) goes to it; passed or skipped goes
//   on (code_review, suite); a rule failure goes back to the developer twice, then to the gate `check_failed`
//   (choices `continue`, `stop`); the rounds start again after a pass; an environment failure goes to the gate
//   `check_environment` (choices `retry`, `stop`) and counts as no round.
// - The developer's next prompt holds the findings.
// Seam: the loaded workflow (loadWorkflow) and the engine's own template evaluator, as in
// workflow-check-environment-30.test.js; no whole simulated run (test/slow/check-found-fix-50.slow.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { render, evalExpr } = require('../engine/run/templates');

const ROOT = path.join(__dirname, '..', '..', '..');
const fileOf = (name) => path.join(ROOT, 'workflows', `${name}.yaml`);
const TARGETS = [
  { name: 'fix', developer: 'develop', next: 'code_review' },
  { name: 'refactor', developer: 'refactor', next: 'suite' },
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
    return { goto: tr.goto, status: tr.status || null, vars, transition: tr };
  }
  return { goto: null, status: null, vars: scope.vars, transition: null };
}

const FINDING = 'src/a.js:2:1: error: unused-var-50';
const CAUSE = 'as dependências do projeto não estão instaladas: rode npm ci em /repos/widgets';
const rules = { kind: 'check', status: 'fail', failure_kind: 'rules', cause: `\`npm run lint\` exited with code 1: ${FINDING}`, command: 'npm run lint', findings: [FINDING], message: `\`npm run lint\` exited with code 1:\n${FINDING}`, exit_code: 1, round: 1 };
const environment = { ...rules, failure_kind: 'environment', cause: CAUSE, findings: ['Error: Cannot find module \'x\'', '    at Module._load (node:internal/x:1:1)'], message: 'Cannot find module' };
const passed = { kind: 'check', status: 'pass', command: 'npm run lint', findings: [], message: '`npm run lint` passes.', round: 1 };
const skipped = { kind: 'check', status: 'skipped', command: null, findings: [], message: 'Rule checks skipped.', round: 1 };

for (const { name, developer, next } of TARGETS) {
  const load = () => {
    const wf = loadWorkflow(fileOf(name));
    const check = wf.steps.find((s) => s.type === 'check');
    assert.equal(!!check, true, `${name}.yaml has no type: check step`);
    const stepOf = (id) => wf.steps.find((s) => s.id === id);
    const turn = { branch: 'craftorio/widgets-50', summary: 'done', files_changed: ['src/a.js'], committed: true, commit_sha: 'abc1234' };
    const scope = (output, vars = {}) => ({
      inputs: { ...defaults(wf), task: 'Fix the widgets' }, vars, output, worktree_dir: '', run_dir: '', test_map: '', previous_step: check.id,
      steps: { [check.id]: { output, visits: 1 }, [developer]: { output: turn, visits: 2 }, reproduce: { output: { reproduced: true, command: 'node x.js', observed: 'boom' }, visits: 1 }, pin_behaviour: { output: { branch: turn.branch, commit: 'abc1234', tests_added: ['test/a.test.js'] }, visits: 1 } },
    });
    const gate = (id) => { const g = stepOf(id); assert.equal(g?.type, 'human_approval', `${name}.yaml has no ${id} gate`); return g; };
    return { wf, check, stepOf, gate, turn, scope };
  };

  test(`#50 ${name}: declares check_command, empty by default, and its check step runs it`, () => {
    const { wf, check } = load();
    assert.equal(wf.inputs.check_command?.default, '');
    assert.match(String(wf.inputs.check_command?.description || ''), /lint/i);
    const { inputs } = { inputs: { ...defaults(wf), check_command: 'make rules-50' } };
    assert.equal(render(String(check.command), { inputs, vars: {}, steps: {} }).trim(), 'make rules-50');
  });

  test(`#50 ${name}: the developer's committed turn goes to the check`, () => {
    const { check, stepOf, turn, scope } = load();
    assert.equal(take(stepOf(developer), { ...scope(turn), output: turn }).goto, check.id);
  });

  test(`#50 ${name}: a check that passes or is skipped goes on to ${next}`, () => {
    const { check, scope } = load();
    assert.equal(take(check, scope(passed)).goto, next);
    assert.equal(take(check, scope(skipped)).goto, next);
  });

  test(`#50 ${name}: a rule failure goes back to the developer twice, then to check_failed`, () => {
    const { check, scope } = load();
    const first = take(check, scope(rules));
    const second = take(check, scope(rules, first.vars));
    const third = take(check, scope(rules, second.vars));
    assert.deepEqual([first.goto, second.goto, third.goto], [developer, developer, 'check_failed']);
  });

  test(`#50 ${name}: the rounds start again after a check that passes`, () => {
    const { check, scope } = load();
    const second = take(check, scope(rules, take(check, scope(rules)).vars));
    const pass = take(check, scope(passed, second.vars));
    assert.equal(take(check, scope(rules, pass.vars)).goto, developer);
  });

  test(`#50 ${name}: the developer sent back gets the findings`, () => {
    const { check, stepOf, scope } = load();
    const back = take(check, scope(rules));
    assert.equal(back.goto, developer);
    const prompt = back.transition.delegate?.prompt || stepOf(developer).prompt;
    const text = render(String(prompt), { ...scope(rules, back.vars), output: rules });
    assert.equal(text.includes(FINDING), true, text);
  });

  test(`#50 ${name}: an environment failure goes to check_environment and counts as no round`, () => {
    const { check, scope } = load();
    const env = take(check, scope(environment));
    assert.equal(env.goto, 'check_environment');
    const first = take(check, scope(rules, env.vars));
    const second = take(check, scope(rules, first.vars));
    assert.deepEqual([first.goto, second.goto], [developer, developer]);
    assert.equal(take(check, scope(environment, second.vars)).goto, 'check_environment');
  });

  test(`#50 ${name}: check_environment shows the cause; Try again reruns the check, Stop ends the run failed`, () => {
    const { check, gate, scope } = load();
    const g = gate('check_environment');
    const s = scope(environment);
    assert.equal(render(String(g.summary || ''), s).includes(CAUSE), true);
    assert.equal((g.choices || []).find((c) => c.id === 'retry')?.label, 'Try again');
    assert.equal(take(g, { ...s, choice: 'retry' }).goto, check.id);
    const stop = take(g, { ...s, choice: 'stop' });
    assert.deepEqual([stop.goto, stop.status], ['end', 'failed']);
  });

  test(`#50 ${name}: check_failed shows the cause; Continue goes on to ${next}, Stop ends the run failed`, () => {
    const { gate, scope } = load();
    const g = gate('check_failed');
    const s = scope(rules, {});
    assert.equal(render(String(g.summary || ''), s).includes(FINDING), true);
    assert.deepEqual((g.choices || []).map((c) => c.id).sort(), ['continue', 'stop']);
    assert.equal(take(g, { ...s, choice: 'continue' }).goto, next);
    const stop = take(g, { ...s, choice: 'stop' });
    assert.deepEqual([stop.goto, stop.status], ['end', 'failed']);
  });
}

// ---- feature.yaml: what its inputs do ----------------------------------------------------------

// the file's comment before its first key, as one line
const header = () => fs.readFileSync(fileOf('feature'), 'utf8').split(/\r?\napiVersion:/)[0].replace(/\r?\n#\s*/g, ' ');

test('#50 feature.yaml\'s header says unit_tests and e2e_tests default to write_and_run', () => {
  const text = header();
  assert.doesNotMatch(text, /unit_tests defaults to run_existing/);
  assert.doesNotMatch(text, /e2e_tests to off/);
  const sentence = text.match(/unit_tests defaults to[^.]*/)?.[0] || '';
  assert.match(sentence, /write_and_run/);
  assert.match(sentence, /e2e_tests/);
  assert.match(text, /unit_tests defaults to.{0,300}no E2E suite/i);
});

test('#50 feature.yaml\'s defaults do not change: unit_tests and e2e_tests write_and_run, check_command empty', () => {
  const { inputs } = loadWorkflow(fileOf('feature'));
  assert.deepEqual([inputs.unit_tests.default, inputs.e2e_tests.default, inputs.check_command.default], ['write_and_run', 'write_and_run', '']);
});

test('#50 feature.yaml\'s check_command says the project\'s own linter and type checker are found without a check script, and how to turn them off', () => {
  const text = String(loadWorkflow(fileOf('feature')).inputs.check_command.description || '');
  assert.match(text, /lint/i);
  assert.match(text, /type.?check/i);
  assert.match(text, /\boff\b/i);
});
