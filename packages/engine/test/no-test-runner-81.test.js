// #81 A project with no test runner (a plain HTML site, a Markdown-only repository) is said up front,
// not stopped at test_failed / verify_failed for tests nothing can run. Acceptance tests written before
// the code.
//
// Seams: runSuite (packages/engine/engine/suite-step.js) on a real git repository with an injected
// `run` (nothing is spawned), the suite's transitions of the loaded workflows/feature.yaml and
// workflows/fix.yaml (evalExpr), the interface catalog (packages/shared/i18n/en.json) and the test
// writer's skills under skills/.
//
// Contract chosen here (the issue names the behaviour, not the names):
// - a suite with no command, in a project where none can be found and the test writer wrote test
//   files, never ends `blocked`. Either the run used a runner that needs no project setup (the
//   output's `command` names `node --test`) or it ends `not_run` and its message says "no test command";
// - going on from such a `not_run` records `tested: "no test command"`; the run's summary text reads
//   "Not tested: no test command";
// - with the default inputs it goes on to the build (feature) / the verification (fix), never the gate;
// - a project with a test command whose tests fail still stops at the gate, as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runSuite } = require('../engine/suite-step');
const { loadWorkflow, evalExpr } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const workflow = (name) => loadWorkflow(path.join(ROOT, 'workflows', `${name}.yaml`));
const FLOWS = { feature: { gate: 'test_failed', on: 'build' }, fix: { gate: 'verify_failed', on: 'verify_change' } };
const NO_COMMAND = /no test command/i;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}
// a git repository holding `files`, all committed
function repo(t, files) {
  const dir = tmp(t, 'no-runner-81-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return dir;
}
const passing = async () => ({ code: 0, timedOut: false, error: null, running: [] });
const failing = async ({ logFile }) => {
  fs.appendFileSync(logFile, '✖ failing tests:\n\ntest at test/a.test.js:3:1\n✖ the menu lists the dishes (1ms)\n  Error: expected 3 dishes\n\nℹ tests 1\nℹ pass 0\nℹ fail 1\n');
  return { code: 1, timedOut: false, error: null, running: [] };
};
const suiteOf = (t, files, opts = {}) => runSuite({ command: '', cwd: repo(t, files), runDir: tmp(t, 'no-runner-81-run-'), round: 1, run: passing, ...opts });

// the projects of the issue, each with the test file a test writer would add
const PROJECTS = {
  'a plain HTML site': {
    'index.html': '<!doctype html><title>Menu</title><a href="cardapio.html">Menu</a>\n',
    'cardapio.html': '<!doctype html><ul><li>Soup</li></ul>\n',
    'style.css': 'body { margin: 0; }\n',
    'test/menu.test.js': "const test = require('node:test');\ntest('menu', () => {});\n",
  },
  'a Markdown-only repository': {
    'README.md': '# Notes\n',
    'docs/guide.md': '# Guide\n\nSee [the README](../README.md).\n',
    'test/links.test.js': "const test = require('node:test');\ntest('links', () => {});\n",
  },
};

// the suite step's first matching transition for this output, with the workflow's default inputs
function route(name, output, inputs = {}) {
  const step = workflow(name).steps.find((s) => s.id === 'suite');
  const ctx = { inputs: { e2e_tests: 'off', unit_tests: 'write_and_run', suite_red_outside_change: 'ask', no_tests: 'continue', mode: 'local', test_command: '', ...inputs }, vars: {}, steps: { suite: { output } }, output };
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return { goto: tr?.goto ?? null, tested: tr?.set?.tested };
}

// ---- how the suite ends: decided, never blocked for a missing command ----

for (const [kind, files] of Object.entries(PROJECTS)) {
  test(`#81 suite: ${kind} with test files and no test command is not blocked`, async (t) => {
    const out = await suiteOf(t, files);
    assert.notEqual(out.status, 'blocked', String(out.reason));
  });

  test(`#81 suite: ${kind} either records the runner it used or says it was not tested for lack of a test command`, async (t) => {
    const out = await suiteOf(t, files);
    if (out.status === 'not_run') {
      assert.match(String(out.message), NO_COMMAND);
      assert.deepEqual(out.failures, []);
    } else {
      assert.match(String(out.command), /\bnode\b.*--test/, `status ${out.status} with command ${out.command}`);
    }
  });

  for (const [name, { gate, on }] of Object.entries(FLOWS)) {
    test(`#81 ${name}: ${kind} with no test command goes on to ${on}, not the gate ${gate}`, async (t) => {
      const out = await suiteOf(t, files);
      const where = route(name, out);
      assert.equal(where.goto, on, `status ${out.status}: ${out.reason || ''}`);
      if (out.status === 'not_run') assert.equal(where.tested, 'no test command');
    });
  }
}

// ---- the run's summary says what was not tested ----

test('#81 summary: the interface says "Not tested: no test command"', () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'en.json'), 'utf8'));
  const values = Object.values(en).filter((v) => typeof v === 'string');
  assert.equal(values.some((v) => /^not tested: no test command/i.test(v)), true);
});

// ---- the test writer knows what to do in a project with no runner ----

test('#81 skill: the test writer\'s skills say how to test a project with no test runner, or why not', () => {
  const skills = ['testing-principles', 'unit-test-writer-js']
    .map((s) => fs.readFileSync(path.join(ROOT, 'skills', s, 'SKILL.md'), 'utf8'));
  assert.equal(skills.some((text) => /no test (command|runner)/i.test(text)), true);
});

// ---- what must not change: a project with a command and failing tests stops at the gate ----

// (a red suite first goes back to the fix rounds; the gate comes once they are spent, as today)
for (const [name, { gate, on }] of Object.entries(FLOWS)) {
  test(`#81 ${name}: a project with a test command and failing tests does not go on to ${on}, nor reads as not tested`, async (t) => {
    const files = { ...PROJECTS['a plain HTML site'], 'package.json': '{"name":"p","scripts":{"test":"node --test"}}\n' };
    const out = await suiteOf(t, files, { command: 'npm test', run: failing });
    assert.equal(out.status, 'fail');
    const where = route(name, out);
    assert.notEqual(where.goto, on);
    assert.equal(where.tested === 'no test command' || where.tested === 'no tests', false, String(where.tested));
  });

  test(`#81 ${name}: a suite whose given command cannot run still stops at ${gate}`, async (t) => {
    const out = await suiteOf(t, PROJECTS['a plain HTML site'], { command: 'npm test', platform: 'linux', run: async ({ logFile }) => { fs.appendFileSync(logFile, 'sh: npm: not found\n'); return { code: 127, timedOut: false, error: null, running: [] }; } });
    assert.equal(out.status, 'blocked');
    assert.equal(route(name, out).goto, gate);
  });
}

test('#81 suite: a project whose own test command is found runs that command, as before', async (t) => {
  const files = { ...PROJECTS['a plain HTML site'], 'package.json': '{"name":"p","scripts":{"test":"node --test"}}\n' };
  const out = await suiteOf(t, files);
  assert.equal(out.status, 'pass');
  assert.equal(out.command, 'npm test');
});
