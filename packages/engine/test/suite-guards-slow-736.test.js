// #736 (acceptance tests written before the code): runs merge only what keeps the base green.
// - Guards always run: the repository-wide guard tests (size ratchets, bare controls, i18n parity, docs
//   checks...) listed in the project's guard list run in every scoped suite round, not only in full ones.
// - A new guard failure goes back to the developer: "pre-existing" compares with the base's last green
//   commit, not with the current (possibly red) base.
// - Slow tests the change touches run before the merge: a slow test whose own file, or a file it reads
//   (a workflow YAML), the change edits, deletes or renames runs in a scoped round.
//
// Seams (as suite-one-whole-per-run-553.test.js and preexisting-confirmed-527.test.js):
// WorkflowRun.prototype.suiteRound on a small run state whose machine is the real one (the real
// affected-tests selection over a real git repository) running the real runSuite with a stubbed
// child-process boundary (`run`), and suite-step runSuite with a faked `run` and base checkout folders.
//
// Contract assumed for the developer:
// - The guard list is `test/guards.json` at the project's root: a JSON array of repository-relative test
//   file paths. A project without it has no guards (nothing changes).
// - runSuite({ ..., lastGreenBase }): `lastGreenBase` is an async () => ({ dir, commit }) giving a
//   checkout of the base's last green commit (the engine passes it from the base health's lastGreen). A
//   failure red on the run and on the current base (`base`) that passes on the last green base is the
//   run's failure (counted, status 'fail'), never pre-existing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const suiteStep = require('../engine/suite-step');
const machineActions = require('../engine/machine-actions');
const { WorkflowRun } = require('../engine/workflow');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-736-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix = 'suite-736-') => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

// the machine-wide locks folder in a temp folder (a whole-suite round takes the suite slot of #455 there)
function machineFolder(t) {
  const root = tmp(t, 'suite-736-machine-');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'MULTIAGENT_LOCKS_DIR']) saved[k] = process.env[k];
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.MULTIAGENT_LOCKS_DIR = path.join(root, 'multiagent-orchestrator', 'locks');
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

const GUARD = 'test/size-ratchet.test.js';

// a project with two modules and their tests, a repository-wide guard test that imports nothing of
// them, and a run branch. extra: more files of the base commit ({ path: text })
function repo(t, { extra = {} } = {}) {
  const dir = tmp(t, 'suite-736-repo-');
  const write = (f, text) => { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  write('package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  for (const [f, text] of Object.entries(extra)) write(f, text);
  write('src/x.js', 'module.exports = 1;\n');
  write('src/z.js', 'module.exports = 1;\n');
  write('test/x.test.js', "require('../src/x');\n");
  write('test/z.test.js', "require('../src/z');\n");
  write('test/c.test.js', "require('node:test');\n");
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  const commitAll = (msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };
  return {
    dir,
    commit: (f, text, msg = `change ${f}`) => { write(f, text); commitAll(msg); },
    remove: (f) => { git(dir, 'rm', '-q', f); commitAll(`remove ${f}`); },
    rename: (from, to) => { git(dir, 'mv', from, to); commitAll(`rename ${from}`); },
  };
}

const TEST_PATH = /test\/[\w./-]+\.test\.js/g;

// The stubbed suite command (as #553's): `failing` are the test files that fail now; a whole run (no
// file on the command, no list) runs them all, a focused run only those it selects. Each call is
// recorded with the files it ran (null: the whole suite).
function fakeSuite() {
  const failing = new Set();
  const calls = [];
  const run = async ({ command, env, logFile }) => {
    const listFile = env?.MULTIAGENT_TEST_FILES;
    const listed = listFile ? fs.readFileSync(path.resolve(listFile), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    const named = String(command).match(TEST_PATH) || [];
    const files = listed.length || named.length ? [...new Set([...listed, ...named])].sort() : null;
    calls.push({ command, files });
    const red = [...failing].filter((f) => !files || files.includes(f));
    const blocks = red.map((f) => `test at ${f}:3:1\n✖ ${path.basename(f)} breaks (1ms)\n  Error: it broke\n`).join('\n');
    const total = files ? files.length : 1000;
    if (logFile) fs.appendFileSync(logFile, `${red.length ? `✖ failing tests:\n\n${blocks}\n` : ''}ℹ tests ${total}\nℹ pass ${total - red.length}\nℹ fail ${red.length}\n`);
    return { code: red.length ? 1 : 0, timedOut: false, error: null };
  };
  return { run, calls, failing, wholeRuns: () => calls.filter((c) => c.files === null).length };
}

// the suite step of the local workflows; the base check is off (its failures stay this run's)
const STEP = { id: 'suite', type: 'suite', command: 'npm test', scope: 'affected', base_check: false };

function engineRun(t, worktree) {
  const runDir = path.join(tmp(t, 'suite-736-run-'), 'runs', 'run-736');
  fs.mkdirSync(runDir, { recursive: true });
  const suite = fakeSuite();
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: {
      ...machineActions.real(),
      simulated: false,
      runSuite: (opts) => suiteStep.runSuite({ ...opts, run: suite.run }),
      noteFailingOnMain: () => {},
      confirmedOnMain: () => [],
    },
    runDir,
    runId: 'run-736',
    worktree: { repo: worktree, base: 'main' },
    ctx: { worktree_dir: worktree, steps: {} },
    abort: new AbortController(),
    preexisting: [],
    suiteRuns: { engine: 0 },
    suiteFailedFiles: [],
    fullSuitePassed: false,
    watchMemory: () => ({ stop() {} }),
    emitEvent: () => {},
  });
  const outputs = [];
  const round = async () => {
    const visits = outputs.length + 1;
    const out = await state.suiteRound(STEP, { visits, outputs: [...outputs] }, { execution: visits, reruns: 0, stopped: [] });
    outputs.push(out);
    return out;
  };
  return { suite, round };
}

const shown = (calls) => JSON.stringify(calls.map((c) => (c.files ? c.files : 'whole')));

// ---- guards always run --------------------------------------------------------------------------------

test('#736 this repository lists its repository-wide guard tests (size ratchet, bare controls, i18n parity, docs checks), each an existing test file', () => {
  const file = path.join(REPO_ROOT, 'test', 'guards.json');
  assert.equal(fs.existsSync(file), true, 'test/guards.json exists');
  const guards = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Array.isArray(guards), true, 'a JSON array of repository-relative test file paths');
  for (const g of [
    'apps/desktop/test/file-size-ratchet-334.test.js',
    'apps/desktop/test/bare-controls-383.test.js',
    'apps/desktop/test/i18n-catalog-check-329.test.js',
    'test/docs-usage-rules.test.js',
  ]) assert.equal(guards.includes(g), true, `lists ${g}: ${JSON.stringify(guards)}`);
  const missing = guards.filter((g) => typeof g !== 'string' || !/\.test\.js$/.test(g) || !fs.existsSync(path.join(REPO_ROOT, g)));
  assert.deepEqual(missing, [], 'every guard is an existing *.test.js file');
});

test('#736 every scoped suite round runs the guard tests, though the change reaches none of them', async (t) => {
  machineFolder(t);
  const r = repo(t, { extra: { 'test/guards.json': JSON.stringify([GUARD]), [GUARD]: "require('node:test');\n" } });
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, round } = engineRun(t, r.dir);

  // round 1: the affected files run first (then the whole suite, which fails on test/c.test.js)
  suite.failing.add('test/c.test.js');
  const one = await round();
  assert.equal(one.status, 'fail', one.message);
  const first = suite.calls[0]?.files || [];
  assert.ok(first.includes('test/x.test.js'), `round 1 starts with the affected files: ${shown(suite.calls)}`);
  assert.ok(first.includes(GUARD), `round 1's scoped run includes the guard: ${shown(suite.calls)}`);

  // round 2 (a fix touching src/z.js): a scoped round, the guard runs again
  r.commit('src/z.js', 'module.exports = 2;\n');
  const before = suite.calls.length;
  const two = await round();
  assert.equal(two.scope, 'files', two.message);
  const files2 = suite.calls.slice(before).flatMap((c) => c.files || []);
  assert.ok(files2.includes(GUARD), `round 2 runs the guard: ${shown(suite.calls.slice(before))}`);
});

test('#736 a guard that fails in a scoped round fails the round', async (t) => {
  machineFolder(t);
  const r = repo(t, { extra: { 'test/guards.json': JSON.stringify([GUARD]), [GUARD]: "require('node:test');\n" } });
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, round } = engineRun(t, r.dir);

  // round 1 goes through the whole suite (red on test/c.test.js); round 2 is scoped and the guard breaks
  suite.failing.add('test/c.test.js');
  await round();
  suite.failing.delete('test/c.test.js');
  suite.failing.add(GUARD);
  r.commit('test/c.test.js', "require('node:test');\n// fixed\n");
  const two = await round();
  assert.equal(two.scope, 'files', two.message);
  assert.equal(two.status, 'fail', two.message);
  assert.ok(two.failures.some((f) => String(f.file).endsWith('size-ratchet.test.js')), `the guard is the round's failure: ${JSON.stringify(two.failures)}`);
});

// ---- a new guard failure is the run's -----------------------------------------------------------------

const failureText = (file, name) => `✖ failing tests:\n\ntest at ${file}:3:1\n✖ ${name} (1ms)\n  Error: ${name} broke\n\nℹ pass 0\nℹ fail 1\n`;
const GUARD_TEST = 'no file is over its size cap';

// A project whose guard fails on the run's branch and on the current base checkout; on the last green
// base checkout it passes (greenOnLastGreen) or fails too.
async function guardRedOnBase(t, { greenOnLastGreen }) {
  const files = {
    'package.json': JSON.stringify({ name: 'p736', scripts: { test: 'node --test' } }),
    'test/guards.json': JSON.stringify([GUARD]),
    [GUARD]: "require('node:test')('x', () => {});\n",
  };
  const write = (dir) => { for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); } };
  const cwd = tmp(t, 'suite736-branch-');
  const baseDir = tmp(t, 'suite736-base-');
  const greenDir = tmp(t, 'suite736-green-');
  const runDir = tmp(t, 'suite736-run-');
  const cacheDir = tmp(t, 'suite736-cache-');
  for (const d of [cwd, baseDir, greenDir]) write(d);
  const run = async ({ cwd: where, logFile }) => {
    const green = greenOnLastGreen && path.resolve(String(where || '')) === path.resolve(greenDir);
    fs.appendFileSync(logFile, green ? 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n' : failureText(GUARD, GUARD_TEST));
    return { code: green ? 0 : 1, timedOut: false, error: null };
  };
  return suiteStep.runSuite({
    command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 30e3, baseCacheDir: cacheDir, confirmedOnBase: null,
    base: async () => ({ dir: baseDir, commit: 'bbbb2222red' }),
    lastGreenBase: async () => ({ dir: greenDir, commit: 'aaaa1111green' }),
  });
}

test('#736 a guard red on the run and on the current base but green on the last green base is the run\'s failure, not pre-existing', async (t) => {
  const out = await guardRedOnBase(t, { greenOnLastGreen: true });
  assert.ok(out.failures.some((f) => f.test === GUARD_TEST), `counted as the run's failure: ${JSON.stringify(out.failures.map((f) => f.test))}`);
  assert.equal(out.preexisting.some((f) => f.test === GUARD_TEST), false, `not pre-existing: ${JSON.stringify(out.preexisting)}`);
  assert.equal((out.preexisting_failures || []).some((f) => f.test === GUARD_TEST), false, 'not in preexisting_failures');
  assert.equal(out.status, 'fail', out.message);
});

// Guard (may be green before the change): red on the last green base too stays pre-existing (#211).
test('#736 guard: a guard red on the last green base too stays pre-existing', async (t) => {
  const out = await guardRedOnBase(t, { greenOnLastGreen: false });
  assert.equal(out.failures.some((f) => f.test === GUARD_TEST), false, `not counted: ${JSON.stringify(out.failures.map((f) => f.test))}`);
  assert.ok(out.preexisting.some((f) => f.test === GUARD_TEST), 'listed as pre-existing');
  assert.equal(out.status, 'pass', out.message);
});

// ---- slow tests the change touches run before the merge -------------------------------------------------

const SLOW_FILE = 'test/slow/old-workflow.slow.test.js';
const OTHER_SLOW = 'test/slow/z.slow.test.js';
const slowRepo = (t) => repo(t, {
  extra: {
    'workflows/old.yaml': 'id: old\nsteps: []\n',
    [SLOW_FILE]: "const fs = require('fs');\nconst path = require('path');\nconst WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'old.yaml');\nrequire('node:test')('reads the workflow', () => { fs.readFileSync(WORKFLOW, 'utf8'); });\n",
    [OTHER_SLOW]: "require('../../src/z');\n",
  },
});

for (const [label, change] of [
  ['deletes the workflow file it reads', (r) => r.remove('workflows/old.yaml')],
  ['renames the workflow file it reads', (r) => r.rename('workflows/old.yaml', 'workflows/new.yaml')],
  ['edits the slow test itself', (r) => r.commit(SLOW_FILE, "require('node:test');\n// edited\n")],
]) {
  test(`#736 a change that ${label} runs that slow test in a scoped round, before any whole suite`, async (t) => {
    machineFolder(t);
    const r = slowRepo(t);
    r.commit('src/x.js', 'module.exports = 2;\n');
    change(r);
    const { suite, round } = engineRun(t, r.dir);

    await round();
    const first = suite.calls[0];
    assert.ok(first && first.files, `the round starts with a scoped run: ${shown(suite.calls)}`);
    assert.ok(first.files.includes(SLOW_FILE), `the slow test the change touches runs in the scoped run: ${shown(suite.calls)}`);
    assert.equal(first.files.includes(OTHER_SLOW), false, `a slow test the change does not touch stays out: ${shown(suite.calls)}`);
  });
}

test('#736 a slow test the change touches that fails in the scoped run fails the round', async (t) => {
  machineFolder(t);
  const r = slowRepo(t);
  r.commit('src/x.js', 'module.exports = 2;\n');
  r.remove('workflows/old.yaml');
  const { suite, round } = engineRun(t, r.dir);
  suite.failing.add(SLOW_FILE);
  const one = await round();
  assert.equal(one.status, 'fail', one.message);
  assert.ok(one.failures.some((f) => String(f.file).endsWith('old-workflow.slow.test.js')), `the slow test is the round's failure: ${JSON.stringify(one.failures)}`);
  assert.equal(suite.wholeRuns(), 0, `found before any whole suite: ${shown(suite.calls)}`);
});

// ---- docs -------------------------------------------------------------------------------------------------

test('#736 the docs give the rule: the testing topic names the guard list and decisions.md records #736', () => {
  const read = (rel) => { try { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch { return ''; } };
  const testingDir = path.join(REPO_ROOT, 'docs', 'agents', 'testing');
  const topic = [read('docs/agents/testing.md'), ...(fs.existsSync(testingDir) ? fs.readdirSync(testingDir).filter((f) => f.endsWith('.md')).map((f) => read(`docs/agents/testing/${f}`)) : [])].join('\n');
  assert.match(topic, /test\/guards\.json/, 'the testing topic names test/guards.json');
  assert.match(read('docs/agents/decisions.md'), /#736/, 'docs/agents/decisions.md has a decision for #736');
});
