// #81 internals (the developer's own tests): the run decides `no_test_command` once the checkout is
// known (checkout.js logRepoCommands), never in a mock run; feature.yaml's code_review route skips the
// test steps only with no test file written and no_tests not `ask`; routedStatus keeps a short reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { methods } = require('../engine/run/checkout');
const { evalExpr } = require('../engine/run/templates');
const { routedStatus } = require('../engine/suite-no-command');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-runner-81-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function fakeRun(dir, extra = {}) {
  return {
    ctx: { inputs: {}, no_test_command: false },
    mock: false,
    machine: null,
    ignoreInstallScripts: false,
    logs: [],
    emitEvent(type, data) { if (type === 'log') this.logs.push(data.message); },
    suiteCommand() { return fs.existsSync(path.join(dir, 'go.mod')) ? 'go test ./...' : null; },
    decideTestCommand: methods.decideTestCommand,
    ...extra,
  };
}

test('#81 internals: the decision is logged when the run starts with no test command', (t) => {
  const dir = tmpDir(t);
  const run = fakeRun(dir);
  methods.logRepoCommands.call(run, dir);
  assert.ok(run.logs.some((m) => /no test command: .*test steps are skipped/.test(m)), run.logs.join('\n'));
});

test('#81 internals: a step that adds a test runner flips no_test_command back, and says so', (t) => {
  const dir = tmpDir(t);
  const run = fakeRun(dir);
  methods.logRepoCommands.call(run, dir);
  assert.equal(run.ctx.no_test_command, true);
  run.decideTestCommand(dir, undefined, 'develop');
  assert.equal(run.ctx.no_test_command, true);
  assert.equal(run.logs.length, 1, 'no new log while nothing changed');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/p\n');
  run.decideTestCommand(dir, undefined, 'develop');
  assert.equal(run.ctx.no_test_command, false);
  assert.ok(run.logs.some((m) => /test command found after step develop: `go test/.test(m)), run.logs.join('\n'));
});

test('#81 internals: the recheck after a step never decides in a mock run', (t) => {
  const dir = tmpDir(t);
  const run = fakeRun(dir, { mock: true, ctx: { inputs: {} } });
  run.decideTestCommand(dir, undefined, 'develop');
  assert.equal(run.ctx.no_test_command, undefined);
});

test('#81 internals: logRepoCommands sets no_test_command in a checkout with no test command', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  const run = fakeRun(dir);
  methods.logRepoCommands.call(run, dir);
  assert.equal(run.ctx.no_test_command, true);
});

test('#81 internals: logRepoCommands leaves no_test_command false when a command is found', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/p\n');
  const run = fakeRun(dir);
  methods.logRepoCommands.call(run, dir);
  assert.equal(run.ctx.no_test_command, false);
});

test('#81 internals: a mock or simulated run never decides no_test_command', (t) => {
  const dir = tmpDir(t);
  const mock = fakeRun(dir, { mock: true });
  methods.logRepoCommands.call(mock, dir);
  assert.equal(mock.ctx.no_test_command, false);
  const simulated = fakeRun(dir, { machine: { simulated: true } });
  methods.logRepoCommands.call(simulated, dir);
  assert.equal(simulated.ctx.no_test_command, false);
});

function codeReviewRoute() {
  const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'), 'utf8'));
  const step = wf.steps.find((s) => s.id === 'code_review');
  return step.transitions.find((tr) => tr.set && tr.set.tested === 'no test command');
}

function scope(over = {}) {
  return {
    output: { results: { reviewer: { verdict: 'approved' } } },
    no_test_command: true,
    inputs: { no_tests: 'skip', unit_tests: 'write_and_run' },
    steps: { acceptance_tests: { output: { tests_added: [] } } },
    ...over,
  };
}

test('#81 internals: code_review goes to build with no test command and no test file written', () => {
  const route = codeReviewRoute();
  assert.equal(route.goto, 'build');
  assert.equal(evalExpr(route.when, scope()), true);
});

test('#81 internals: the route tolerates an acceptance_tests step that has not run', () => {
  assert.equal(evalExpr(codeReviewRoute().when, scope({ steps: {} })), true);
});

test('#81 internals: test files written anyway, no_tests ask or a found command keep the usual route', () => {
  const when = codeReviewRoute().when;
  assert.equal(evalExpr(when, scope({ steps: { acceptance_tests: { output: { tests_added: ['a.test.js'] } } } })), false);
  assert.equal(evalExpr(when, scope({ inputs: { no_tests: 'ask', unit_tests: 'write_and_run' } })), false);
  assert.equal(evalExpr(when, scope({ no_test_command: false })), false);
});

test('#81 internals: routedStatus gives a no_command round one short reason, not the not_run sentence wrapped', () => {
  const out = routedStatus({ status: 'not_run', no_command: true, reason: 'no test command: the project has no test runner' }, { transitions: [] });
  assert.equal(out.status, 'blocked');
  assert.ok(!out.reason.includes('(no test command'), out.reason);
});
