const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { testMatcher, snapshot, changedTestFiles, localChanges } = require('../engine/test-paths');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function commit(dir, message, files) {
  for (const [f, text] of Object.entries(files)) {
    if (text === null) git(dir, 'rm', '-q', f);
    else { write(dir, f, text); git(dir, 'add', f); }
  }
  git(dir, 'commit', '-q', '-m', message);
}

// a repository on main with production code and one test
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  commit(dir, 'base', { 'src/app.js': 'module.exports = 1;\n', 'test/app.test.js': 'ok\n' });
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

test('the default test paths match the usual test files of every language', () => {
  const isTest = testMatcher();
  for (const f of [
    'test/engine.test.js', 'packages/api/tests/helpers.js', 'src/__tests__/App.jsx', 'web/src/login.spec.ts',
    'lib/util.test.mjs', 'pkg/tests/test_models.py', 'app/test_views.py', 'app/views_test.py', 'conftest.py',
    'internal/store/store_test.go', 'internal/store/testdata/in.json', 'service/src/test/java/com/acme/AppTest.java',
    'src/main/java/com/acme/LegacyTests.java', 'App.Tests/LoginTests.cs', 'src/Acme/ParserTest.cs', 'spec/models/user_spec.rb',
    // end-to-end / BDD (#143): feature files and their step definitions
    'features/143-dashboard-filter.feature', 'features/steps/dashboard_steps.js', 'features/step_definitions/dashboard.js',
    'e2e/dashboard.spec.ts', 'src/e2e/login.py', 'cypress/e2e/login.cy.js', 'StepDefinitions/DashboardSteps.cs', 'App.E2E/LoginTests.cs',
  ]) assert.equal(isTest(f), true, f);
  for (const f of [
    'packages/engine/engine/workflow.js', 'scripts/test.js', 'src/testing.py', 'cmd/main.go', 'src/main/java/com/acme/App.java',
    'src/Acme/Latest.cs', 'docs/testing.md', 'contest/entry.py', 'package.json', 'src/attest/sign.js',
    'src/features/dashboard.js', // "features" alone, with no steps/ folder, is production code
    'packages/engine/engine/scenarios.js',
  ]) assert.equal(isTest(f), false, f);
});

test('tests_paths globs: ** crosses folders, * stays in one, a bare name matches at any depth, rooted paths do not', () => {
  const isTest = testMatcher(['qa/**', '**/fixtures/*.json', '*.check.js']);
  assert.equal(isTest('qa/login/flow.js'), true);
  assert.equal(isTest('apps/qa/flow.js'), false); // has a slash: anchored at the repository root
  assert.equal(isTest('a/b/fixtures/user.json'), true);
  assert.equal(isTest('a/fixtures/deep/user.json'), false);
  assert.equal(isTest('src/deep/x.check.js'), true);
  assert.equal(isTest('src\\deep\\x.check.js'), true); // Windows separators
  assert.equal(isTest('test/app.test.js'), false); // the defaults are replaced, not extended
});

test('changedTestFiles lists the test files a turn committed, deleted or left uncommitted, not production code', async (t) => {
  const dir = makeRepo(t);
  const snap = await snapshot(dir);
  commit(dir, 'feature', { 'src/app.js': 'module.exports = 2;\n', 'src/app.test.js': 'new\n', 'test/app.test.js': null });
  write(dir, 'test/extra.test.js', 'untracked\n');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), ['src/app.test.js', 'test/app.test.js', 'test/extra.test.js']);
});

test('changedTestFiles ignores a test change the turn reverted and test files that were already dirty', async (t) => {
  const dir = makeRepo(t);
  write(dir, 'test/wip.test.js', 'the user\'s own work\n');
  const snap = await snapshot(dir);
  commit(dir, 'touch the test', { 'test/app.test.js': 'changed\n', 'src/app.js': 'module.exports = 2;\n' });
  commit(dir, 'put it back', { 'test/app.test.js': 'ok\n' });
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), []);
  write(dir, 'test/wip.test.js', 'changed by the turn\n');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), ['test/wip.test.js']);
});

test('changedTestFiles leaves out what comes from the base: a merge of the base, or a new branch from a newer base', async (t) => {
  const dir = makeRepo(t);
  const snap = await snapshot(dir);
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'another run merged', { 'test/other.test.js': 'from the base\n' });
  git(dir, 'switch', '-q', 'feat');
  commit(dir, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
  git(dir, 'merge', '-q', '--no-edit', 'main');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main', 'refs/remotes/origin/main'] }), []);
  git(dir, 'switch', '-q', '-c', 'fix', 'main');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), []);
});

test('#374 localChanges: the modified and new files of the whole repository, relative to its root', async (t) => {
  const dir = makeRepo(t);
  commit(dir, 'app', { 'app/b.js': 'b\n' });
  write(dir, 'src/app.js', 'module.exports = 2;\n');
  write(dir, 'app/b.js', 'b2\n');
  write(dir, 'app/new.js', 'new\n');
  assert.deepEqual((await localChanges(dir)).sort(), ['app/b.js', 'app/new.js', 'src/app.js']);
});

test('#374 localChanges relative: from a project folder inside the repository, only its files, relative to it', async (t) => {
  const dir = makeRepo(t);
  commit(dir, 'app', { 'app/b.js': 'b\n' });
  write(dir, 'src/app.js', 'module.exports = 2;\n'); // outside the folder: left out
  write(dir, 'app/b.js', 'b2\n');
  write(dir, 'app/lib/new.js', 'new\n');
  assert.deepEqual((await localChanges(path.join(dir, 'app'), { relative: true })).sort(), ['b.js', 'lib/new.js']);
});

test('#374 localChanges gives up when git takes longer than its timeout, instead of waiting for the default', async (t) => {
  const dir = makeRepo(t);
  write(dir, 'src/app.js', 'module.exports = 2;\n');
  // no git process starts and ends within 1 ms: a timeout that reaches git makes the call fail
  await assert.rejects(() => localChanges(dir, { timeout: 1 }));
});

test('snapshot is null outside a git work tree (nothing to check)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paths-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(await snapshot(dir), null);
  assert.deepEqual(await changedTestFiles(null), []);
});

test('snapshot rejects, instead of returning null, when a .git is present but not a valid repository', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paths-badgit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.git')); // looks like a repository, but git init never ran
  await assert.rejects(() => snapshot(dir), /not a git repository/);
});

test('snapshot rejects when HEAD does not resolve (a repository with no commits yet)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paths-nohead-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  await assert.rejects(() => snapshot(dir), /Needed a single revision/);
});

test('loadWorkflow validates edits_tests and tests_paths', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tests-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  const load = (head, agent = '', step = '') => {
    fs.writeFileSync(file, `${head}agents: { a: { provider: claude, model: m${agent} } }\nsteps:\n  - id: s1\n    agent: a\n${step}`);
    return () => loadWorkflow(file);
  };
  assert.doesNotThrow(load('tests_paths: ["qa/**"]\n', ', edits_tests: false', '    edits_tests: true\n'));
  assert.throws(load('', ', edits_tests: "no"'), /Agent "a": edits_tests must be true or false/);
  assert.throws(load('', '', '    edits_tests: 1\n'), /Step "s1": edits_tests must be true or false/);
  assert.throws(load('tests_paths: "qa/**"\n'), /tests_paths must be a non-empty list/);
  assert.throws(load('tests_paths: []\n'), /tests_paths must be a non-empty list/);
});

// A mock run whose `develop` agent may not edit tests. `onTurn(n, prompt)` plays the CLI's side
// effects on the repository before the n-th turn of the step is answered.
async function runGuarded(t, { stepEditsTests, onTurn }) {
  const repo = makeRepo(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    '  developer: { provider: claude, model: m, session: handoff, edits_tests: false, capabilities: { tools: [read, edit, write, bash:git] } }',
    'steps:',
    '  - id: develop',
    '    agent: developer',
    ...(stepEditsTests === undefined ? [] : [`    edits_tests: ${stepEditsTests}`]),
    '    prompt: "Implement the feature."',
    '    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop') onTurn(repo, ++turn, ev.prompt);
  });
  await run.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

test('edits_tests: false sends back a turn that committed a test file, and the step goes on once it is put back', { timeout: 60000 }, async (t) => {
  let base;
  const { events, finished } = await runGuarded(t, {
    onTurn(repo, n) {
      if (n === 1) {
        base = git(repo, 'rev-parse', 'HEAD');
        commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n', 'test/app.test.js': 'rewritten by the developer\n' });
      }
      if (n === 2) git(repo, 'checkout', base, '--', 'test/app.test.js');
      if (n === 2) git(repo, 'commit', '-q', '-m', 'put the test back');
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0].files, ['test/app.test.js']);
  assert.equal(refused[0].agent, 'developer');
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /refused your last turn: it changed test files/);
  assert.match(prompts[1], /- test\/app\.test\.js/);
  assert.match(prompts[1], new RegExp(`git checkout ${base} -- <file>`));
  // a handoff agent answers in a fresh session: the task goes along
  assert.match(prompts[1], /Implement the feature\./);
});

test('edits_tests: false fails the step when the test files are still changed after two send-backs', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runGuarded(t, {
    onTurn(repo, n) { if (n === 1) write(repo, 'src/new.spec.js', 'written by the developer\n'); },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /developer changed test files in develop and did not put them back: src\/new\.spec\.js/);
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 3);
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').length, 3);
});

test('edits_tests: true on the step lets that step change tests (e.g. resolving a rebase)', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runGuarded(t, {
    stepEditsTests: true,
    onTurn(repo, n) { if (n === 1) commit(repo, 'resolve', { 'test/app.test.js': 'merged\n' }); },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 0);
});

test('edits_tests: false fails the turn with a clear message when the snapshot before it cannot be taken', { timeout: 60000 }, async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guard-nohead-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q'); // a repository with no commits yet: snapshot() cannot resolve HEAD
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    '  developer: { provider: claude, model: m, session: handoff, edits_tests: false, capabilities: { tools: [read, edit, write, bash:git] } }',
    'steps:',
    '  - id: develop',
    '    agent: developer',
    '    prompt: "Implement the feature."',
    '    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /Could not snapshot the test files before developer's turn in develop \(edits_tests: false\)/);
  // the turn itself never ran: an unchecked snapshot must not let the turn through the guard
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').length, 0);
});
