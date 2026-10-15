// #396, beyond the acceptance tests (test/suite-red-outside-change-396.test.js):
// - classifyFailures (src/engine/affected-tests.js): the cases where the change cannot be told apart
//   (unknown changed files, a shared root, no JS/TS graph, no file, a file the graph does not know)
//   count as in the change, so the owner's policy never lets them through;
// - runSuite's timed-out round (src/engine/suite-step.js): a file that fails alone on the branch, a hang
//   with no base checkout or a base without the file, and the alone reruns' own timeout history;
// - the suite step's routing in workflows/ai-development-local-hero.yaml (evalExpr on its transitions);
// - where `tested` shows: the run's row (src/runs.js readRun) and the run chat's end item.
// runSuite runs with a stubbed `run` (the child-process boundary): no real process is spawned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { classifyFailures } = require('../src/engine/affected-tests');
const { runSuite } = require('../src/engine/suite-step');
const { loadWorkflow, evalExpr } = require('../src/engine/workflow');
const runs = require('../src/runs');
const { RunChatModel } = require('../src/renderer/views/runchat/run-chat-model.js');

const IN = 'in the change';
const OUT = 'outside the change';
const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}
function writeFiles(dir, files) {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
}
function repo(t, files) {
  const dir = tmp(t, 'suite-396b-repo-');
  git(dir, 'init', '-q');
  writeFiles(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'branch');
  return dir;
}

// src/a.js is the change; test/a.test.js imports it, test/other.test.js imports nothing changed
const JS = {
  'package.json': '{"name":"p","scripts":{"test":"node --test"}}\n',
  'src/a.js': 'module.exports = 1;\n',
  'test/a.test.js': "require('node:test');\nrequire('../src/a.js');\n",
  'test/other.test.js': "require('node:test');\n",
  'test/hang.test.js': "require('node:test');\n",
};
const classes = (list) => Object.fromEntries(list.map((f) => [f.file || f.test, f.class]));

// ---------------------------------------------------------------------------
// classifyFailures: what cannot be told apart counts as in the change
// ---------------------------------------------------------------------------

test('#396 classifyFailures: a test file that imports a changed file is in the change, another is outside, each with its reason', (t) => {
  const root = repo(t, JS);
  const out = classifyFailures({ root, changed: ['src/a.js'], failures: [{ test: 'a', file: 'test/a.test.js' }, { test: 'o', file: 'test/other.test.js' }] });
  assert.deepEqual(classes(out), { 'test/a.test.js': IN, 'test/other.test.js': OUT });
  assert.match(out[0].class_reason, /src\/a\.js/);
  assert.match(out[1].class_reason, /reaches none of the 1 changed file/);
});

test('#396 classifyFailures: a changed test file is in the change', (t) => {
  const root = repo(t, JS);
  const [f] = classifyFailures({ root, changed: ['test/other.test.js'], failures: [{ test: 'o', file: 'test/other.test.js' }] });
  assert.equal(f.class, IN);
  assert.match(f.class_reason, /test file is changed/);
});

test('#396 classifyFailures: when the run\'s changed files are unknown, every failure is in the change', (t) => {
  const root = repo(t, JS);
  for (const changed of [null, undefined]) {
    const out = classifyFailures({ root, changed, failures: [{ test: 'o', file: 'test/other.test.js' }] });
    assert.equal(out[0].class, IN);
    assert.match(out[0].class_reason, /unknown/);
  }
});

test('#396 classifyFailures: a changed shared root (package.json, a lockfile) puts every failure in the change', (t) => {
  const root = repo(t, JS);
  for (const changed of [['package.json'], ['package-lock.json', 'src/a.js']]) {
    const out = classifyFailures({ root, changed, failures: [{ test: 'o', file: 'test/other.test.js' }] });
    assert.equal(out[0].class, IN, `changed ${changed.join(', ')}`);
    assert.match(out[0].class_reason, /shared root changed/);
  }
});

test('#396 classifyFailures: a project with no JS/TS import graph counts every failure in the change', (t) => {
  const root = repo(t, { 'app.py': 'x = 1\n', 'tests/test_app.py': 'import app\n', 'tests/test_other.py': 'pass\n' });
  const out = classifyFailures({ root, changed: ['app.py'], failures: [{ test: 'o', file: 'tests/test_other.py' }] });
  assert.equal(out[0].class, IN);
  assert.match(out[0].class_reason, /no JS\/TS import graph/);
});

test('#396 classifyFailures: a failure that names no test file is in the change', (t) => {
  const root = repo(t, JS);
  const out = classifyFailures({ root, changed: ['src/a.js'], failures: [{ test: '(unrecognized failure)', file: '' }] });
  assert.equal(out[0].class, IN);
  assert.match(out[0].class_reason, /names no test file/);
});

test('#396 classifyFailures: a failure already classed keeps its class and reason', (t) => {
  const root = repo(t, JS);
  const out = classifyFailures({ root, changed: ['src/a.js'], failures: [{ test: '(timed out)', file: 'test/a.test.js', class: OUT, class_reason: 'hangs alone on the base too' }] });
  assert.equal(out[0].class, OUT);
  assert.equal(out[0].class_reason, 'hangs alone on the base too');
});

test('#396 classifyFailures: a failure given with the absolute path of a test file that imports the change is in the change', (t) => {
  const root = repo(t, JS);
  const [f] = classifyFailures({ root, changed: ['src/a.js'], failures: [{ test: 'a', file: path.join(root, 'test', 'a.test.js') }] });
  assert.equal(f.class, IN, f.class_reason);
});

test('#396 classifyFailures: a failure in a file the project does not have cannot be told apart, so it counts in the change', (t) => {
  const root = repo(t, JS);
  const elsewhere = path.join(os.tmpdir(), 'not-the-project', 'x.test.js');
  for (const file of ['test/gone.test.js', elsewhere]) {
    const [f] = classifyFailures({ root, changed: ['src/a.js'], failures: [{ test: 'x', file }] });
    assert.equal(f.class, IN, `${file}: ${f.class_reason}`);
  }
});

// ---------------------------------------------------------------------------
// runSuite: a timed-out round, the cases the acceptance tests leave out
// ---------------------------------------------------------------------------

const failureText = (file, name) => `✖ failing tests:\n\ntest at ${file}:3:1\n✖ ${name} (1ms)\n  Error: ${name} broke\n\n`;
const TEST_FILE = /test\/[\w.-]+\.test\.js/g;

// The round (a command naming no test file) times out while `running` still run; a command naming
// test files is a rerun, on the branch or on the base (told apart by cwd), each file as `alone` says.
function fakeRun({ baseDir, running, alone }) {
  const calls = [];
  const run = async ({ command, cwd, timeoutMs, logFile }) => {
    const files = String(command).match(TEST_FILE) || [];
    const where = baseDir && path.resolve(cwd) === path.resolve(baseDir) ? 'base' : 'branch';
    calls.push({ where, files, timeoutMs });
    if (!files.length) return { code: null, timedOut: true, error: null, running };
    const outcome = (f) => alone[where][f] || 'pass';
    const failing = files.filter((f) => outcome(f) === 'fail');
    const hanging = files.filter((f) => outcome(f) === 'hang');
    fs.appendFileSync(logFile, `${failing.map((f) => failureText(f, `${path.basename(f)} test`)).join('')}ℹ pass ${files.length - failing.length - hanging.length}\nℹ fail ${failing.length}\n`);
    if (hanging.length) return { code: null, timedOut: true, error: null, running: hanging };
    return { code: failing.length ? 1 : 0, timedOut: false, error: null };
  };
  return { run, calls };
}

async function timedOut(t, { running, alone, base = 'full', history = null }) {
  const cwd = repo(t, JS);
  const baseDir = tmp(t, 'suite-396b-base-');
  writeFiles(baseDir, JS);
  if (base === 'without hang') fs.rmSync(path.join(baseDir, 'test', 'hang.test.js'));
  const runDir = tmp(t, 'suite-396b-run-');
  const { run, calls } = fakeRun({ baseDir, running, alone: { branch: {}, base: {}, ...alone } });
  const out = await runSuite({
    command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 30e3, changedFiles: () => ['src/a.js'], history,
    base: base === 'none' ? undefined : async () => ({ dir: baseDir, commit: 'abc1234def' }),
  });
  return { out, calls };
}

test('#396 timeout: a file that fails alone on the branch is outside the change as a hang, and its failing test goes through the base check and the import graph', async (t) => {
  const { out } = await timedOut(t, { running: ['test/a.test.js'], alone: { branch: { 'test/a.test.js': 'fail' } } });
  assert.equal(out.status, 'fail');
  const entry = out.failures.find((f) => f.test === '(timed out in the whole suite)');
  assert.ok(entry, JSON.stringify(out.failures));
  assert.equal(entry.class, OUT);
  assert.match(entry.class_reason, /finishes alone on the branch \(fails\)/);
  const failing = out.failures.find((f) => f.test === 'a.test.js test');
  assert.ok(failing, `the failing test is listed: ${JSON.stringify(out.failures)}`);
  assert.equal(failing.class, IN, 'it imports the changed file');
  assert.equal(out.in_change, 1);
});

test('#396 timeout: the failing test of a file that fails alone on the branch and on the base too is pre-existing, not counted', async (t) => {
  const { out } = await timedOut(t, { running: ['test/a.test.js'], alone: { branch: { 'test/a.test.js': 'fail' }, base: { 'test/a.test.js': 'fail' } } });
  assert.ok(!out.failures.some((f) => f.test === 'a.test.js test'), JSON.stringify(out.failures));
  assert.ok(out.preexisting_failures.some((f) => f.test === 'a.test.js test'), JSON.stringify(out.preexisting_failures));
  assert.equal(out.in_change, 0);
});

test('#396 timeout: a hang with no base checkout says so and is classed by the import graph', async (t) => {
  const { out, calls } = await timedOut(t, {
    running: ['test/a.test.js', 'test/hang.test.js'], base: 'none',
    alone: { branch: { 'test/a.test.js': 'hang', 'test/hang.test.js': 'hang' } },
  });
  assert.equal(calls.filter((c) => c.where === 'base').length, 0, 'nothing runs on a base');
  const byFile = Object.fromEntries(out.failures.filter((f) => f.test === '(timed out)').map((f) => [f.file, f]));
  assert.match(byFile['test/a.test.js'].error, /no base checkout/);
  assert.equal(byFile['test/a.test.js'].class, IN);
  assert.equal(byFile['test/hang.test.js'].class, OUT);
  assert.equal(out.in_change, 1);
});

test('#396 timeout: a file that hangs on the branch and that the base does not have is not run on the base', async (t) => {
  const { out, calls } = await timedOut(t, { running: ['test/hang.test.js'], base: 'without hang', alone: { branch: { 'test/hang.test.js': 'hang' } } });
  assert.equal(calls.filter((c) => c.where === 'base').length, 0);
  const entry = out.failures.find((f) => f.test === '(timed out)');
  assert.match(entry.error, /the base does not have it/);
});

test('#396 timeout: each alone rerun gets 3x its recent alone durations (at least 2 min), and a run that finishes is recorded', async (t) => {
  const cache = tmp(t, 'suite-396b-cache-');
  const file = path.join(cache, 'suite-durations.json');
  fs.writeFileSync(file, JSON.stringify({
    'proj\ntest/hang.test.js (alone)': [100e3, 100e3, 100e3],
    'proj\ntest/other.test.js (alone)': [5e3],
  }));
  const { calls } = await timedOut(t, { running: ['test/hang.test.js', 'test/other.test.js'], history: { file, project: 'proj' }, alone: {} });
  const timeoutOf = (f) => calls.find((c) => c.where === 'branch' && c.files.length === 1 && c.files[0] === f).timeoutMs;
  assert.equal(timeoutOf('test/hang.test.js'), 300e3);
  assert.equal(timeoutOf('test/other.test.js'), 120e3);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved['proj\ntest/hang.test.js (alone)'].length, 4, 'the pass alone is recorded under the file\'s own key');
});

test('#396 timeout: with no history an alone rerun gets 5 min', async (t) => {
  const { calls } = await timedOut(t, { running: ['test/hang.test.js'], alone: {} });
  const rerun = calls.find((c) => c.where === 'branch' && c.files.length === 1);
  assert.equal(rerun.timeoutMs, 5 * 60e3);
});

// ---------------------------------------------------------------------------
// The suite step's routing (workflows/ai-development-local-hero.yaml)
// ---------------------------------------------------------------------------

function suiteRoute({ output, policy = 'continue', e2e = 'off', scope = 'none', unitTests = 'write_and_run' }) {
  const step = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'suite');
  const ctx = {
    inputs: { suite_red_outside_change: policy, e2e_tests: e2e, unit_tests: unitTests },
    vars: {},
    steps: { acceptance_tests: { output: { e2e_scope: scope } } },
    output,
  };
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return { goto: tr?.goto ?? (tr?.delegate ? 'delegate' : null), tested: tr?.set?.tested };
}
const red = (extra) => ({ kind: 'suite', status: 'fail', failures: [{ test: 'x', file: 'test/x.test.js' }], ...extra });

test('#396 routing: policy continue, red only outside the change, the issue\'s scenarios on: e2e, not tested green', () => {
  assert.deepEqual(suiteRoute({ output: red({ in_change: 0, outside_change: 1 }), e2e: 'write_and_run', scope: 'scenarios' }), { goto: 'e2e', tested: 'not green' });
});

test('#396 routing: policy continue, red only outside the change in an affected round (files scope): build, not tested green', () => {
  assert.deepEqual(suiteRoute({ output: red({ scope: 'files', in_change: 0, outside_change: 1 }) }), { goto: 'build', tested: 'not green' });
});

test('#396 routing: policy continue never goes on when the failures were not classified', () => {
  const r = suiteRoute({ output: red({}) });
  assert.notEqual(r.goto, 'build');
  assert.notEqual(r.goto, 'e2e');
});

test('#396 routing: policy continue with one failure in the change goes to the test writer as today', () => {
  assert.equal(suiteRoute({ output: red({ in_change: 1, outside_change: 3 }) }).goto, 'test');
});

test('#396 routing: policy ask, red only outside the change, goes to the test writer as today', () => {
  assert.equal(suiteRoute({ output: red({ in_change: 0, outside_change: 1 }), policy: 'ask' }).goto, 'test');
});

test('#396 routing: policy continue, a blocked suite opens test_failed', () => {
  assert.equal(suiteRoute({ output: { kind: 'suite', status: 'blocked', failures: [] } }).goto, 'test_failed');
});

test('#396 routing: a green suite clears an earlier not tested green', () => {
  assert.deepEqual(suiteRoute({ output: { kind: 'suite', status: 'pass', failures: [] } }), { goto: 'build', tested: '' });
  assert.deepEqual(suiteRoute({ output: { kind: 'suite', status: 'pass', failures: [] }, e2e: 'write_and_run', scope: 'scenarios' }), { goto: 'e2e', tested: '' });
});

test('#396 routing: the owner\'s Continue at test_failed records not tested green; Stop does not', () => {
  const gate = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'test_failed');
  const pick = (choice) => gate.transitions.find((x) => x.when === undefined || evalExpr(x.when, { choice, inputs: {}, vars: {}, steps: {}, output: { choice } }));
  assert.equal(pick('continue').goto, 'build');
  assert.equal(pick('continue').set?.tested, 'not green');
  assert.equal(pick('stop').set?.tested, undefined);
});

test('#396 software-development-local-hero has no suite policy transition', () => {
  const wf = loadWorkflow(path.join(__dirname, '..', 'workflows', 'software-development-local-hero.yaml'));
  const text = JSON.stringify(wf.steps.map((s) => s.transitions || []));
  assert.doesNotMatch(text, /suite_red_outside_change|not green/);
});

test('#396 inputs form (Start drawer, roadmap item): the policy shows as "Suite red outside the change", Ask selected by default; a chosen Continue stays selected', () => {
  const WorkflowInputs = require('../src/renderer/workflow-inputs');
  const { suite_red_outside_change: def } = loadWorkflow(WORKFLOW).inputs;
  const defs = { suite_red_outside_change: def };
  const active = (html) => (html.match(/data-wi-pill="(\w+)" class="active"/g) || []).map((m) => m.match(/"(\w+)"/)[1]);
  const fresh = WorkflowInputs.formHtml(defs, { values: {} });
  assert.match(fresh, />Suite red outside the change</);
  assert.deepEqual(active(fresh), ['ask']);
  assert.deepEqual(active(WorkflowInputs.formHtml(defs, { values: { suite_red_outside_change: 'continue' } })), ['continue']);
});

// ---------------------------------------------------------------------------
// Where `tested` shows: the run's row and the run chat
// ---------------------------------------------------------------------------

function finishedRunDir(t, extra) {
  const runsDir = tmp(t, 'suite-396b-runs-');
  const dir = path.join(runsDir, 'r1');
  fs.mkdirSync(dir);
  const at = '2026-10-15T10:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', ts: at, run_id: 'r1', workflow: 'ai-development-local-hero', inputs: { task: 't' } })}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: 'r1', workflow: 'ai-development-local-hero', status: 'success', started_at: at, finished_at: at, sessions: [], steps: {}, ...extra }));
  return runsDir;
}

test('#396 readRun: a run that went on without a green suite carries tested and its failures with their class', (t) => {
  const failures = [{ step: 'suite', test: 'x', file: 'test/x.test.js', class: OUT, class_reason: 'reaches none of the 1 changed file(s)' }];
  const row = runs.readRun(finishedRunDir(t, { tested: 'not green', tested_failures: failures }), 'r1');
  assert.equal(row.tested, 'not green');
  assert.deepEqual(row.testedFailures, failures);
});

test('#396 readRun: a run tested green has no tested record', (t) => {
  const row = runs.readRun(finishedRunDir(t, {}), 'r1');
  assert.equal(row.tested, null);
  assert.equal(row.testedFailures, null);
});

test('#396 run chat: the end item says not tested green from the finished run\'s summary, and nothing for a green one', () => {
  const ended = (summary) => {
    const m = new RunChatModel();
    m.apply({ type: 'workflow.finished', ts: '2026-10-15T10:00:00.000Z', status: 'success', summary });
    return m.items.filter((i) => i.kind === 'end').map((i) => i.tested);
  };
  assert.deepEqual(ended({ tested: 'not green' }), ['not green']);
  assert.deepEqual(ended({}), [null]);
});
