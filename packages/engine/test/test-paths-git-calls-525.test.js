// #525: the test-file guard around a turn (`snapshot` before it, `changedTestFiles` after it)
// starts few `git` processes, and what a turn can change (HEAD, local changes) is never reused
// from an earlier turn of the same run.
//
// The `git` processes are counted at the system boundary: child_process is wrapped before any
// engine module loads (each test file runs in its own process), so every way of starting git is
// seen, whichever module starts it.
const childProcess = require('child_process');

let calls = null; // the git command lines started while counting, or null when not counting
const isGit = (file) => /^git(\.exe)?$/i.test(require('path').basename(String(file || '')).trim());
const isGitLine = (cmd) => /^\s*"?git(\.exe)?"?(\s|$)/i.test(String(cmd || ''));
for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[name];
  childProcess[name] = function counted(file, args, ...rest) {
    if (calls && isGit(file)) calls.push(['git', ...(Array.isArray(args) ? args : [])].join(' '));
    return original.call(this, file, args, ...rest);
  };
}
for (const name of ['exec', 'execSync']) {
  const original = childProcess[name];
  childProcess[name] = function counted(cmd, ...rest) {
    if (calls && isGitLine(cmd)) calls.push(String(cmd));
    return original.call(this, cmd, ...rest);
  };
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { snapshot, changedTestFiles, existingRefs } = require('../engine/test-paths');
const { WorkflowRun } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

// fixtures run git outside the counting window
const git = (cwd, ...args) => childProcess.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function commit(dir, message, files) {
  for (const [f, text] of Object.entries(files)) { write(dir, f, text); git(dir, 'add', f); }
  git(dir, 'commit', '-q', '-m', message);
}

// a repository on main with production code and one test, checked out on a feature branch
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-calls-525-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  commit(dir, 'base', { 'src/app.js': 'module.exports = 1;\n', 'test/app.test.js': 'ok\n' });
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// One guarded turn: the snapshot, the turn's side effects (`turn`, not counted: the fixture's git
// commands are not the guard's), then the check. Returns the files refused and the git command lines
// the guard started.
async function guardedTurn(repo, bases, turn) {
  const started = [];
  calls = started;
  let snap;
  try { snap = await snapshot(repo); } finally { calls = null; }
  turn(repo);
  calls = started;
  try {
    return { files: await changedTestFiles(snap, { bases }), started };
  } finally {
    calls = null;
  }
}

// One guarded turn as a run with a worktree checks it: the base branch, local and remote (the remote
// one does not exist here). Today it starts 14 git processes; the issue asks for at most half.
test('#525 one guarded turn that changes no test file starts at most 7 git processes, base refs included', async (t) => {
  const repo = makeRepo(t);
  const { files, started } = await guardedTurn(repo, ['refs/heads/main', 'refs/remotes/origin/main'], (r) => {
    commit(r, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
    write(r, 'src/extra.js', 'module.exports = 3;\n');
  });
  assert.deepEqual(files, []);
  assert.ok(started.length <= 7, `${started.length} git processes for one guarded turn (at most 7):\n${started.join('\n')}`);
});

// Without a worktree (a run on the repository itself) there are no base refs. Today: 12.
test('#525 one guarded turn without base refs starts at most 6 git processes', async (t) => {
  const repo = makeRepo(t);
  write(repo, 'src/app.js', 'module.exports = 2;\n');
  const { files, started } = await guardedTurn(repo, [], (r) => write(r, 'src/extra.js', 'module.exports = 3;\n'));
  assert.deepEqual(files, []);
  assert.ok(started.length <= 6, `${started.length} git processes for one guarded turn (at most 6):\n${started.join('\n')}`);
});

test('#525 a guarded turn that changes a test file is still refused with the fewer git processes', async (t) => {
  const repo = makeRepo(t);
  const snap = await snapshot(repo);
  commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
  write(repo, 'test/app.test.js', 'rewritten by the developer\n');
  write(repo, 'test/new.test.js', 'new\n');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main', 'refs/remotes/origin/main'] }), ['test/app.test.js', 'test/new.test.js']);
});

// A mock run of three steps: `develop` and `polish` by a developer that may not edit tests, `write_tests`
// in between by a test writer that may. `onTurn(repo, stepId, n)` plays the CLI's side effects on the
// repository before the n-th turn of a step is answered.
async function runSteps(t, onTurn, { count = false } = {}) {
  const repo = makeRepo(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-git-calls-525-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  const step = (id, agent, next) => [
    `  - id: ${id}`,
    `    agent: ${agent}`,
    '    prompt: "Do your part."',
    '    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }',
    '    transitions:',
    `      - { when: "true", goto: ${next} }`,
  ];
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    '  developer: { provider: claude, model: m, session: handoff, edits_tests: false, capabilities: { tools: [read, edit, write, bash:git] } }',
    '  tester: { provider: claude, model: m, session: handoff, capabilities: { tools: [read, edit, write, bash:git] } }',
    'steps:',
    ...step('develop', 'developer', 'write_tests'),
    ...step('write_tests', 'tester', 'polish'),
    ...step('polish', 'developer', 'end'),
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const events = [];
  const turns = {};
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type !== 'session.message_sent' || !ev.step_id) return;
    // the fixture's git commands are not the engine's: paused around them
    const keep = calls;
    calls = null;
    try { onTurn(repo, ev.step_id, (turns[ev.step_id] = (turns[ev.step_id] || 0) + 1)); } finally { calls = keep; }
  });
  // count: the git command lines the engine starts during the run
  const started = [];
  if (count) calls = started;
  try { await run.start(); } finally { calls = null; }
  return { events, finished: events.find((e) => e.type === 'workflow.finished'), started };
}

// HEAD moves between two guarded turns of the same run (another agent commits a test): the second
// turn's snapshot starts from the new HEAD, so the test writer's commit is not blamed on the developer.
test('#525 a test committed by another agent between two guarded turns is not refused to the developer', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runSteps(t, (repo, stepId) => {
    if (stepId === 'develop') commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
    if (stepId === 'write_tests') commit(repo, 'tests', { 'test/app.test.js': 'written by the test writer\n', 'test/more.test.js': 'more\n' });
    if (stepId === 'polish') commit(repo, 'polish', { 'src/app.js': 'module.exports = 3;\n' });
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.filter((e) => e.type === 'tests.refused').map((e) => `${e.step_id}: ${e.files.join(', ')}`), []);
});

// The second guarded turn of the run changes a test file: its check lists the local changes again
// (nothing is reused from the first turn), refuses it once, and passes once it is put back.
test('#525 the second guarded turn of a run is refused for a test file it changes, then passes once it is put back', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runSteps(t, (repo, stepId, n) => {
    if (stepId === 'develop') write(repo, 'src/app.js', 'module.exports = 2;\n');
    if (stepId === 'write_tests') commit(repo, 'tests', { 'src/app.js': 'module.exports = 2;\n', 'test/app.test.js': 'written by the test writer\n' });
    if (stepId === 'polish' && n === 1) write(repo, 'test/app.test.js', 'rewritten by the developer\n');
    if (stepId === 'polish' && n === 2) git(repo, 'checkout', '--', 'test/app.test.js');
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.filter((e) => e.type === 'tests.refused').map((e) => `${e.step_id}: ${e.files.join(', ')}`), ['polish: test/app.test.js']);
});

// Per run, the repository root and the base refs that exist are found once: the guarded turns after
// the first one start fewer git processes than it did. Two guarded turns of a run without a worktree,
// each changing only production code: today 24 git processes in the whole run.
test('#525 two guarded turns of one run start at most 12 git processes in all', { timeout: 60000 }, async (t) => {
  const { finished, started } = await runSteps(t, (repo, stepId) => {
    if (stepId === 'develop') commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
    if (stepId === 'polish') write(repo, 'src/extra.js', 'module.exports = 3;\n');
  }, { count: true });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(started.length <= 12, `${started.length} git processes in a run of two guarded turns (at most 12):\n${started.join('\n')}`);
});

test('#525 the repository root is asked of git once per run, not on every guarded turn', { timeout: 60000 }, async (t) => {
  const { finished, started } = await runSteps(t, (repo, stepId) => {
    if (stepId === 'polish') write(repo, 'src/extra.js', 'module.exports = 3;\n');
  }, { count: true });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(started.filter((c) => c.includes('--show-toplevel')).length, 1, started.join('\n'));
});

test('#525 snapshot given the repository of an earlier snapshot does not ask git for the root and sees the new HEAD', async (t) => {
  const repo = makeRepo(t);
  const first = await snapshot(repo);
  commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n' });
  write(repo, 'test/app.test.js', 'dirty before the turn\n');
  const started = [];
  calls = started;
  let again;
  try { again = await snapshot(repo, undefined, { repo: { root: first.root, gitDir: first.gitDir } }); } finally { calls = null; }
  assert.deepEqual(started.filter((c) => c.includes('--show-toplevel')), []);
  assert.equal(again.head, git(repo, 'rev-parse', 'HEAD'));
  assert.notEqual(again.head, first.head);
  assert.deepEqual(Object.keys(again.dirty), ['test/app.test.js']);
});

// Porcelain paths: spaces and non-ASCII letters, never quoted
test('#525 changedTestFiles lists modified and untracked test files whose names have spaces and accents', async (t) => {
  const repo = makeRepo(t);
  commit(repo, 'spaced', { 'test/my app ção.test.js': 'ok\n' });
  const snap = await snapshot(repo);
  write(repo, 'test/my app ção.test.js', 'rewritten by the developer\n');
  write(repo, 'test/new file.test.js', 'new\n');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), ['test/my app ção.test.js', 'test/new file.test.js']);
});

test('#525 a test file with spaces that was already dirty and stays so is not refused', async (t) => {
  const repo = makeRepo(t);
  commit(repo, 'spaced', { 'test/my app.test.js': 'ok\n' });
  write(repo, 'test/my app.test.js', 'the user\'s own change\n');
  const snap = await snapshot(repo);
  write(repo, 'src/app.js', 'module.exports = 2;\n');
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), []);
});

test('#525 an unresolved merge conflict on a test file with spaces in its name is not a change', async (t) => {
  const repo = makeRepo(t);
  commit(repo, 'branch', { 'test/my app.test.js': 'from the branch\n' });
  git(repo, 'switch', '-q', 'main');
  commit(repo, 'main', { 'test/my app.test.js': 'from main\n' });
  git(repo, 'switch', '-q', 'feat');
  const snap = await snapshot(repo);
  assert.throws(() => git(repo, 'merge', '-q', '--no-edit', 'main'));
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), []);
});

test('#525 existingRefs keeps, in their order, only the refs that name a commit', async (t) => {
  const repo = makeRepo(t);
  git(repo, 'tag', '-a', '-m', 'v1', 'v1', 'main');
  const refs = ['refs/remotes/origin/main', 'refs/tags/v1', 'refs/heads/feat', 'refs/heads/main', 'main'];
  assert.deepEqual(await existingRefs(repo, refs), ['refs/tags/v1', 'refs/heads/feat', 'refs/heads/main', 'main']);
  assert.deepEqual(await existingRefs(repo, []), []);
});

test('#525 existingRefs does not take a ref under the base name for the base itself', async (t) => {
  const repo = makeRepo(t);
  git(repo, 'branch', '-q', '-m', 'main', 'trunk');
  git(repo, 'branch', '-q', 'main/x', 'trunk');
  assert.deepEqual(await existingRefs(repo, ['refs/heads/main']), []);
});

// A linked worktree keeps its rebase state in its own git dir (.git/worktrees/<name>), not the common one
test('#525 inside a rebase in a linked worktree, a pure combination of both sides is not a change', async (t) => {
  const repo = makeRepo(t);
  const FILE = 'test/app.test.js';
  commit(repo, 'branch', { [FILE]: 'ok\nfrom the branch\n' });
  git(repo, 'switch', '-q', 'main');
  commit(repo, 'main', { [FILE]: 'ok\nfrom main\n' });
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'git-calls-525-wt-'));
  fs.rmSync(wt, { recursive: true, force: true });
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  git(repo, 'worktree', 'add', '-q', wt, 'feat');
  assert.throws(() => git(wt, '-c', 'core.editor=true', 'rebase', 'main'));
  const snap = await snapshot(wt);
  fs.writeFileSync(path.join(wt, FILE), 'ok\nfrom main\nfrom the branch\n');
  git(wt, 'add', FILE);
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), []);
  // a line neither side wrote is still the agent's
  fs.writeFileSync(path.join(wt, FILE), 'ok\nfrom main\nfrom the branch\nnew line\n');
  git(wt, 'add', FILE);
  assert.deepEqual(await changedTestFiles(snap, { bases: ['refs/heads/main'] }), [FILE]);
});
