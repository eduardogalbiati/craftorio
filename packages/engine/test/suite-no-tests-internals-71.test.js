// #71 internals: what a suite with no command ends as (suite-no-command.js), the status a step's
// transitions can route, new and custom test files, a simulated not_run, and the gates' other texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { routedStatus, suiteWithoutCommand } = require('../engine/suite-no-command');
const { runSuite } = require('../engine/suite-step');
const { loadWorkflow, evalExpr, render } = require('../engine/workflow');

const workflow = (name) => loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', `${name}.yaml`));

function folder(t, files, { git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-tests-71-in-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('#71 no command: a new, uncommitted test file counts; an ignored one does not', async (t) => {
  assert.equal((await suiteWithoutCommand(folder(t, { 'a.test.js': '' }))).status, 'blocked');
  assert.equal((await suiteWithoutCommand(folder(t, { '.gitignore': 'out\n', 'out/a.test.js': '' }))).status, 'not_run');
});

test('#71 no command: the workflow\'s tests_paths say what a test file is', async (t) => {
  const dir = folder(t, { 'checks/a.txt': '' });
  assert.equal((await suiteWithoutCommand(dir)).status, 'not_run');
  assert.equal((await suiteWithoutCommand(dir, ['checks/**'])).status, 'blocked');
});

test('#71 no command: a folder git cannot list is never taken as a project with no tests', async (t) => {
  const out = await suiteWithoutCommand(folder(t, {}, { git: false }));
  assert.equal(out.status, 'blocked');
  assert.doesNotMatch(out.reason, /has test files/);
});

test('#71 a step whose transitions do not name not_run gets it as blocked, with the command to set', () => {
  const out = { status: 'not_run', reason: 'the project has no tests', message: 'The suite was not run: the project has no tests.' };
  const named = { transitions: [{ when: "output.status == 'not_run'", goto: 'x' }] };
  assert.equal(routedStatus(out, named), out);
  for (const step of [{}, { transitions: [{ when: "output.status == 'blocked'", goto: 'x' }, { goto: 'y' }] }]) {
    const r = routedStatus(out, step);
    assert.equal(r.status, 'blocked');
    assert.match(r.message, /could not run: no test command.*test_command.*the project has no tests/);
  }
  const pass = { status: 'pass' };
  assert.equal(routedStatus(pass, {}), pass);
});

test('#71 a simulated suite can end not run', async () => {
  const out = await runSuite({ command: '', cwd: '', runDir: null, round: 1, mock: true, mockResult: 'not_run' });
  assert.equal(out.status, 'not_run');
  assert.match(out.message, /not run: the project has no tests/);
});

test('#71 feature: Continue at test_failed kept by no_tests ask records no tests', () => {
  const gate = workflow('feature').steps.find((s) => s.id === 'test_failed');
  const ctx = { choice: 'continue', inputs: {}, vars: {}, steps: { suite: { output: { status: 'not_run' } } }, output: {} };
  const tr = gate.transitions.find((x) => evalExpr(x.when, ctx));
  assert.deepEqual([tr.goto, tr.set], ['build', { tested: 'no tests' }]);
});

test('#71 fix: Approve at verify_failed records no tests, and keeps what was recorded otherwise', () => {
  const gate = workflow('fix').steps.find((s) => s.id === 'verify_failed');
  const at = (mode, status, tested) => {
    const ctx = { approved: true, rejected: false, inputs: { mode }, vars: { tested }, steps: { suite: { output: { status } } }, output: {} };
    return render(gate.transitions.find((x) => evalExpr(x.when, ctx)).set.tested, ctx).trim();
  };
  for (const mode of ['local', 'remote']) {
    assert.equal(at(mode, 'not_run', ''), 'no tests');
    assert.equal(at(mode, 'fail', ''), '');
  }
});

test('#71 fix: verify_failed recommends what its case calls for', () => {
  const gate = workflow('fix').steps.find((s) => s.id === 'verify_failed');
  const say = (key, output) => render(gate[key], { previous_step: 'suite', inputs: {}, vars: {}, steps: { suite: { output } } });
  assert.match(say('recommend', { status: 'blocked', reason: 'no test command: set the workflow\'s test_command input' }), /^reject: .*test_command/);
  assert.match(say('recommend', { status: 'not_run' }), /^approve: the project has no tests/);
  assert.equal(say('recommend', { status: 'fail' }).trim(), '');
  assert.match(say('message', { status: 'fail', message: 'm' }), /after the rounds of fixes/);
});
