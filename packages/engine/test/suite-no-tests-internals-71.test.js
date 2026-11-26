// #71 internals: what a suite with no command ends as (suite-no-command.js), the status a step's
// transitions can route, new and custom test files, a simulated not_run, and the gates' other texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gateBrief } = require('../engine/gate-summary');
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

// #81: test files with no command end not_run with no_command (no test runner), no tests without it
const ended = (out) => [out.status, Boolean(out.no_command)];

test('#71 no command: a new, uncommitted test file counts; an ignored one does not', async (t) => {
  assert.deepEqual(ended(await suiteWithoutCommand(folder(t, { 'a.test.js': '' }))), ['not_run', true]);
  assert.deepEqual(ended(await suiteWithoutCommand(folder(t, { '.gitignore': 'out\n', 'out/a.test.js': '' }))), ['not_run', false]);
});

test('#71 no command: the workflow\'s tests_paths say what a test file is', async (t) => {
  const dir = folder(t, { 'checks/a.txt': '' });
  assert.deepEqual(ended(await suiteWithoutCommand(dir)), ['not_run', false]);
  assert.deepEqual(ended(await suiteWithoutCommand(dir, ['checks/**'])), ['not_run', true]);
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

test('#71 fix: Approve at verify_failed goes to the verification when nothing ran, and lands the change otherwise', () => {
  const gate = workflow('fix').steps.find((s) => s.id === 'verify_failed');
  const at = (mode, status, previous_step) => {
    const ctx = { approved: true, rejected: false, previous_step, inputs: { mode }, vars: { tested: '' }, steps: { suite: { output: status ? { status } : undefined } }, output: {} };
    const tr = gate.transitions.find((x) => evalExpr(x.when, ctx));
    return [tr.goto, render(tr.set.tested, ctx).trim()];
  };
  for (const [mode, land] of [['local', 'push_main'], ['remote', 'ci'], ['fork', 'ci']]) {
    assert.deepEqual(at(mode, 'not_run', 'suite'), ['verify_change', 'no tests']);
    // a gate the run resumed at: never past the verification either
    assert.deepEqual(at(mode, 'not_run', 'verify_failed'), ['verify_change', 'no tests']);
    // the verifier or the reviewer had its rounds: the Approve lands it
    assert.deepEqual(at(mode, 'not_run', 'verify_change'), [land, 'no tests']);
    assert.deepEqual(at(mode, 'not_run', 'code_review'), [land, 'no tests']);
    assert.deepEqual(at(mode, 'fail', 'suite'), [land, '']);
    assert.deepEqual(at(mode, null, 'code_review'), [land, '']);
  }
});

test('#71 no_tests ask: the gate recommends no answer, so the supervisor leaves it to the owner', () => {
  for (const [name, id, answers] of [['feature', 'test_failed', ['continue', 'stop']], ['fix', 'verify_failed', ['approve', 'reject']]]) {
    const gate = workflow(name).steps.find((s) => s.id === id);
    const recommend = render(gate.recommend, { previous_step: 'suite', inputs: {}, vars: {}, steps: { suite: { output: { status: 'not_run' } } } });
    assert.match(recommend, /only the owner answers.*no_tests.*no tests/);
    const { recommendation } = gateBrief({ recommend, answers: answers.map((a) => ({ id: a, label: a })) });
    assert.equal(recommendation.answer, null);
    assert.doesNotMatch(recommendation.reason, /…$/, 'not cut');
  }
});

test('#71 a suite with no command names no log: none was written', async (t) => {
  for (const [files, status] of [[{}, 'not_run'], [{ 'a.test.js': '' }, 'not_run']]) {
    const runDir = folder(t, {}, { git: false });
    const out = await runSuite({ command: '', cwd: folder(t, files), runDir, round: 1 });
    assert.deepEqual([out.status, out.log], [status, null]);
    assert.ok(!fs.existsSync(path.join(runDir, 'logs')));
  }
});

test('#71 fix: verify_failed recommends what its case calls for', () => {
  const gate = workflow('fix').steps.find((s) => s.id === 'verify_failed');
  const say = (key, output) => render(gate[key], { previous_step: 'suite', inputs: {}, vars: {}, steps: { suite: { output } } });
  assert.match(say('recommend', { status: 'blocked', reason: 'no test command: set the workflow\'s test_command input' }), /^reject: .*test_command/);
  assert.match(say('message', { status: 'not_run', message: 'm' }), /Approve to go on to the verification;/);
  assert.match(say('message', { status: 'fail', message: 'm' }), /Approve to let it land anyway;/);
  assert.equal(say('recommend', { status: 'fail' }).trim(), '');
  assert.match(say('message', { status: 'fail', message: 'm' }), /after the rounds of fixes/);
});
