// #71 A project with no tests: the run does not stop at the test gate. Acceptance tests written
// before the code.
//
// Seams: runSuite (packages/engine/engine/suite-step.js) on a real git repository, the suite's
// transitions and gates of the loaded workflows/feature.yaml and workflows/fix.yaml (evalExpr,
// render), and a run whose supervisor is scripted (no model).
//
// Contract chosen here (the issue names the behaviour, not the names):
// - a suite with no command in a project with no test file ends with status `not_run` (never pass,
//   fail or blocked), its message says "not run: the project has no tests";
// - going on from it records `tested: "no tests"` (the transition's `set`), never "not green";
// - the input `no_tests: continue | ask` (default continue) of both workflows keeps the gate with `ask`;
// - test files with no command found: still `blocked`, the reason says so and names test_command.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runSuite } = require('../engine/suite-step');
const { loadWorkflow, evalExpr, render, WorkflowRun } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const workflow = (name) => loadWorkflow(path.join(ROOT, 'workflows', `${name}.yaml`));
const FLOWS = { feature: { gate: 'test_failed', on: 'build' }, fix: { gate: 'verify_failed', on: 'verify_change' } };
const NOT_RUN = /not run: the project has no tests/i;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}
// a git repository holding `files`, all committed
function repo(t, files) {
  const dir = tmp(t, 'no-tests-71-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  for (const [rel, text] of Object.entries({ 'README.md': '# p\n', '.gitignore': 'node_modules\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return dir;
}
const passing = async () => ({ code: 0, timedOut: false, error: null });
const suiteOf = (t, files, opts = {}) => runSuite({ command: '', cwd: repo(t, files), runDir: tmp(t, 'no-tests-71-run-'), round: 1, run: passing, ...opts });
const TEST_FILES = { 'test/app.test.js': "require('node:test');\n" };

// the suite step's first matching transition for this output
function route(name, output, inputs = {}) {
  const step = workflow(name).steps.find((s) => s.id === 'suite');
  const ctx = { inputs: { e2e_tests: 'off', unit_tests: 'write_and_run', suite_red_outside_change: 'ask', no_tests: 'continue', mode: 'local', ...inputs }, vars: {}, steps: { suite: { output } }, output };
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return { goto: tr?.goto ?? null, tested: tr?.set?.tested };
}
const renderCtx = (output, extra = {}) => ({
  inputs: { task: 'x', mode: 'remote', base_branch: 'main', git_platform: 'gh', no_tests: 'ask' },
  vars: {}, run_dir: '/run', previous_step: 'suite',
  steps: { develop: { output: { branch: 'b', summary: 's' } }, suite: { output, visits: 1 } }, ...extra,
});

// ---- how the suite ends ----

test('#71 suite: no command and no test file ends not run, saying the project has no tests', async (t) => {
  const out = await suiteOf(t, {});
  assert.equal(out.status, 'not_run');
  assert.match(out.message, NOT_RUN);
  assert.deepEqual(out.failures, []);
});

test('#71 suite: source files without tests (no manifest) are still a project with no tests', async (t) => {
  const out = await suiteOf(t, { 'src/app.js': 'module.exports = 1;\n', 'index.html': '<p>hi</p>\n' });
  assert.equal(out.status, 'not_run');
});

test('#71 suite: test files but no command found stays blocked, says there are test files and to set test_command', async (t) => {
  const out = await suiteOf(t, TEST_FILES);
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /test_command/);
  assert.match(out.reason, /test files?/i);
});

test('#71 suite: a given command runs even without a test file', async (t) => {
  const out = await suiteOf(t, {}, { command: 'npm test' });
  assert.equal(out.status, 'pass');
});

test('#71 suite: tests and a command found in the project run as before', async (t) => {
  const out = await suiteOf(t, { ...TEST_FILES, 'package.json': '{"name":"p","scripts":{"test":"node --test"}}\n' });
  assert.equal(out.status, 'pass');
});

// ---- where the run goes ----

for (const [name, { gate, on }] of Object.entries(FLOWS)) {
  test(`#71 ${name}: a project with no tests goes on to ${on}, recorded as no tests`, async (t) => {
    assert.deepEqual(route(name, await suiteOf(t, {})), { goto: on, tested: 'no tests' });
  });

  test(`#71 ${name}: no_tests ask keeps the gate ${gate} for a project with no tests`, async (t) => {
    const out = await suiteOf(t, {});
    assert.equal(out.status, 'not_run');
    assert.equal(route(name, out, { no_tests: 'ask' }).goto, gate);
  });

  test(`#71 ${name}: test files with no command go to ${gate}, whatever no_tests says`, async (t) => {
    const out = await suiteOf(t, TEST_FILES);
    assert.equal(route(name, out).goto, gate);
    assert.equal(route(name, out, { no_tests: 'ask' }).goto, gate);
  });

  test(`#71 ${name}: the input no_tests offers continue and ask, continue by default`, () => {
    const def = workflow(name).inputs.no_tests;
    assert.ok(def, 'the input exists');
    assert.equal(def.default, 'continue');
    assert.deepEqual([...def.enum].sort(), ['ask', 'continue']);
  });

  test(`#71 ${name}: the pull request's prompt says nothing was tested because the project has no tests`, async (t) => {
    const out = await suiteOf(t, {});
    const ci = workflow(name).steps.find((s) => s.id === 'ci');
    const text = render(ci.prompt, renderCtx(out, { vars: { tested: 'no tests' } }));
    assert.match(text, /no tests/i);
    assert.doesNotMatch(text, /not tested green/i);
  });
}

// ---- what the gates say ----

test('#71 fix: verify_failed for a suite with no command says to set test_command, not that rounds of fixes failed', async (t) => {
  const out = await suiteOf(t, TEST_FILES);
  const text = render(workflow('fix').steps.find((s) => s.id === 'verify_failed').message, renderCtx(out));
  assert.match(text, /test_command/);
  assert.doesNotMatch(text, /after the rounds of fixes/);
});

test('#71 feature: test_failed kept by no_tests ask says the project has no tests, not that the suite fails', async (t) => {
  const out = await suiteOf(t, {});
  const gate = workflow('feature').steps.find((s) => s.id === 'test_failed');
  for (const part of ['summary', 'message']) {
    const text = render(gate[part], renderCtx(out));
    assert.match(text, /no tests/i, part);
    assert.doesNotMatch(text, /still fails/, part);
  }
});

test('#71 feature: test_failed for test files with no command recommends setting test_command', async (t) => {
  const out = await suiteOf(t, TEST_FILES);
  const gate = workflow('feature').steps.find((s) => s.id === 'test_failed');
  assert.match(render(gate.recommend, renderCtx(out)), /test_command/);
});

// ---- the gate and the supervisor agree ----

test('#71 the supervisor on call is told the gate\'s own recommendation', async (t) => {
  const dir = tmp(t, 'no-tests-71-sup-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-gate-recommend }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 2, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "work"
    output_schema: { type: object, required: [status], properties: { status: { type: string } } }
    transitions:
      - { when: "true", goto: stuck }
  - id: stuck
    type: human_approval
    kind: escalation
    recommend: "stop: set the marker_71 command, then resume the run."
    message: "Stuck."
    transitions:
      - { when: approved, goto: end }
      - { when: rejected, goto: end, status: failed }
`);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs') });
  const prompts = [];
  run.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') prompts.push(prompt);
    const out = agent === 'supervisor' ? { explanation: 'unclear', action: 'escalate' } : { status: 'failed' };
    return { text: `\`\`\`json\n${JSON.stringify(out)}\n\`\`\`` };
  };
  run.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => run.resolveApproval(e.approval_id, true)); });
  await run.start();
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /marker_71/);
});
