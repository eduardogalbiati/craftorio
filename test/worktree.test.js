// Git worktree per run (src/engine/worktree.js + orchestrator.worktree in the engine).
// Uses throwaway repositories in os.tmpdir() with a local bare repository as `origin` (no network).
//
// Must pass on Windows, Linux and macOS, whatever the machine's git config. The paths handed to
// the code under test are deliberately NOT the canonical spelling git prints: by default they go
// through a symlink (a junction on Windows, which needs no admin rights), like macOS's
// /var -> /private/var; on Windows the path tests also run through an 8.3 short name, like
// os.tmpdir() on the GitHub Windows runner (C:\Users\RUNNER~1 vs git's C:/Users/runneradmin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareWorktree, removeWorktree, mergeLocally, cleanupWorktrees, listWorktrees, isMerged, samePath, canonicalPath } = require('../src/engine/worktree');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const supervisor = require('../src/supervisor');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
// No user git config (identity, hooks, aliases), as on CI: a local user.name must not hide a
// production git call that needs one.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

// identity and default branch fixed here: nothing depends on the machine's git setup
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Windows 8.3 short name of an existing folder, or null (other OS, or 8.3 names disabled on the volume). */
function shortPath(dir) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${dir}") do @echo %~sI`], { windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out && out.toLowerCase() !== dir.toLowerCase() && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * A folder in os.tmpdir() spelled in a non-canonical way:
 * 'link' = through a symlink/junction, 'short' = 8.3 short name (Windows; null when unavailable),
 * 'canonical' = the real path.
 */
function scratch(t, spelling = 'link') {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }));
  const real = path.join(base, 'fixture-with-a-long-name');
  fs.mkdirSync(real);
  if (spelling === 'canonical') return real;
  if (spelling === 'short') return shortPath(real);
  const link = path.join(base, 'linked');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
}

// origin (bare) + repo (the workspace clone) + other (someone else pushing to origin)
function fixture(t, spelling = 'link') {
  const tmp = scratch(t, spelling);
  if (!tmp) return null;
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '-b', 'main', origin, other);
  return { tmp, origin, repo, other, worktrees: path.join(tmp, 'worktrees') };
}

// Path tests run with every spelling this machine has (8.3 names only on Windows volumes that keep them).
const SPELLINGS = ['canonical', 'link', 'short'];
// null (and the test skipped) when this machine has no such spelling
const spelled = (t, spelling) => {
  const f = fixture(t, spelling);
  if (!f) t.skip(`no ${spelling} path spelling on this machine`);
  return f;
};

test('canonicalPath/samePath: symlinks, 8.3 names, missing tails, separators and case', (t) => {
  const real = scratch(t, 'canonical');
  const link = path.join(path.dirname(real), 'linked');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(canonicalPath(link), real);
  // a path that does not exist yet: the existing ancestor is resolved, the rest appended
  assert.equal(canonicalPath(path.join(link, 'not', 'yet')), path.join(real, 'not', 'yet'));
  assert.ok(samePath(path.join(link, 'x'), path.join(real, 'x')));
  assert.ok(samePath(`${real}${path.sep}`, real));
  assert.ok(samePath(real.replace(/\\/g, '/'), real), 'forward slashes, as git prints them on Windows');
  assert.ok(!samePath(path.join(real, 'a'), path.join(real, 'b')));
  if (process.platform === 'win32' || process.platform === 'darwin') assert.ok(samePath(real.toUpperCase(), real));
  const short = shortPath(real);
  if (short) {
    assert.equal(canonicalPath(short), real);
    assert.ok(samePath(path.join(short, 'missing'), path.join(link, 'missing')));
  }
});

const logger = () => {
  const lines = [];
  const log = (level, message) => lines.push(`${level}: ${message}`);
  return { lines, log };
};

test('prepareWorktree: a folder outside git returns null (the caller works in the folder)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareWorktree({ repo: dir, base: 'main', dir: path.join(dir, 'wt') }), null);
  assert.equal(await prepareWorktree({ repo: path.join(dir, 'missing'), base: 'main', dir: path.join(dir, 'wt') }), null);
});

for (const spelling of SPELLINGS) {
  test(`prepareWorktree (${spelling} paths): detached at the freshly fetched origin/<base>, not the stale local base`, async (t) => {
    const f = spelled(t, spelling);
    if (!f) return;
    const fresh = commit(f.other, 'b.txt', 'b\n');
    git(f.other, 'push', '-q', 'origin', 'main');
    const dir = path.join(f.worktrees, 'run1');
    const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir });
    assert.equal(wt.ref, 'origin/main');
    assert.equal(wt.commit, fresh);
    assert.equal(wt.dir, canonicalPath(dir));
    assert.equal(wt.workDir, canonicalPath(dir), 'the worktree itself, not the repository or a path climbing out of it');
    assert.equal(wt.repo, canonicalPath(f.repo));
    assert.equal(git(dir, 'rev-parse', 'HEAD'), fresh);
    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
    assert.notEqual(git(f.repo, 'rev-parse', 'main'), fresh, 'the local main is untouched');
    assert.ok((await listWorktrees(f.repo)).some((w) => samePath(w.dir, dir)));

    // same folder again (resume): reused as is
    const again = await prepareWorktree({ repo: f.repo, base: 'main', dir });
    assert.equal(again.reused, true);
    assert.equal(again.workDir, wt.workDir);
  });
}

test('prepareWorktree: no reachable remote only warns and falls back to what is local', async (t) => {
  const f = fixture(t);
  git(f.repo, 'remote', 'set-url', 'origin', path.join(f.tmp, 'gone.git'));
  const { lines, log } = logger();
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), log });
  assert.equal(wt.ref, 'origin/main'); // the last fetched state
  assert.match(lines.join('\n'), /could not fetch origin\/main/);

  git(f.repo, 'remote', 'remove', 'origin');
  const local = await prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run2'), log });
  assert.equal(local.ref, 'main');
  assert.match(lines.join('\n'), /starting from the local main/);
});

for (const spelling of SPELLINGS) {
  test(`prepareWorktree (${spelling} paths): a subfolder of the repository keeps the same subfolder in the worktree`, async (t) => {
    const f = spelled(t, spelling);
    if (!f) return;
    fs.mkdirSync(path.join(f.repo, 'app'));
    commit(f.repo, 'app/x.txt', 'x\n');
    git(f.repo, 'push', '-q', 'origin', 'main');
    const dir = path.join(f.worktrees, 'run1');
    const wt = await prepareWorktree({ repo: path.join(f.repo, 'app'), base: 'main', dir });
    assert.equal(wt.workDir, path.join(canonicalPath(dir), 'app'));
    assert.ok(fs.existsSync(path.join(wt.workDir, 'x.txt')));
  });
}

test('removeWorktree: deletes a squash-merged branch, keeps an unmerged one', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  git(dir, 'switch', '-q', '--no-track', '-c', 'feat/x', 'origin/main');
  commit(dir, 'feature.txt', 'feature\n');
  commit(dir, 'feature2.txt', 'more\n');
  git(dir, 'push', '-q', '-u', 'origin', 'feat/x');
  // the branch cannot be deleted from the main checkout while the worktree has it checked out
  // (git < 2.42 says "checked out at", newer versions "used by worktree at")
  assert.throws(() => git(f.repo, 'branch', '-D', 'feat/x'), /checked out|used by worktree/);
  // squash merge on the "server"
  git(f.other, 'fetch', '-q', 'origin');
  git(f.other, 'merge', '-q', '--squash', 'origin/feat/x');
  git(f.other, 'commit', '-q', '-m', 'squash');
  git(f.other, 'push', '-q', 'origin', 'main');
  git(f.repo, 'fetch', '-q', 'origin');
  assert.equal(await isMerged(f.repo, 'feat/x', 'origin/main'), true);

  const r = await removeWorktree({ repo: f.repo, dir, base: 'main' });
  assert.deepEqual(r, { removed: true, branch: 'feat/x', branchDeleted: true });
  assert.ok(!fs.existsSync(dir));
  assert.equal(git(f.repo, 'branch', '--list', 'feat/x'), '');

  const dir2 = path.join(f.worktrees, 'run2');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: dir2 });
  git(dir2, 'switch', '-q', '-c', 'feat/y');
  commit(dir2, 'y.txt', 'y\n');
  const { lines, log } = logger();
  const r2 = await removeWorktree({ repo: f.repo, dir: dir2, base: 'main', log });
  assert.deepEqual(r2, { removed: true, branch: 'feat/y', branchDeleted: false });
  assert.equal(git(f.repo, 'branch', '--list', 'feat/y').replace(/^[*+ ]+/, ''), 'feat/y');
  assert.match(lines.join('\n'), /not merged .* kept/);
});

test('removeWorktree: a node_modules linking the shared dependency cache (#198) is unlinked first; removal never follows it into the cache', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  const cacheEntry = path.join(f.tmp, 'cache-entry');
  fs.mkdirSync(path.join(cacheEntry, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cacheEntry, 'node_modules', 'kept.txt'), 'kept');
  fs.symlinkSync(path.join(cacheEntry, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const r = await removeWorktree({ repo: f.repo, dir, base: 'main' });
  assert.equal(r.removed, true);
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(cacheEntry, 'node_modules', 'kept.txt')), 'the shared cache entry is untouched');
});

test('prepareWorktree: resume recreates a deleted worktree from the run branch', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  git(dir, 'switch', '-q', '-c', 'feat/z');
  const head = commit(dir, 'z.txt', 'z\n');
  git(f.repo, 'worktree', 'remove', '--force', dir);
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir, branch: 'feat/z' });
  assert.equal(wt.recreated, true);
  assert.equal(wt.ref, 'feat/z');
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/z');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
});

for (const spelling of SPELLINGS) test(`cleanupWorktrees (${spelling} paths): removes succeeded and stale runs, keeps failed, recent and active ones; a removed worktree's scratch goes with it, its logs and screenshots stay`, async (t) => {
  const f = spelled(t, spelling);
  if (!f) return;
  const runsDir = path.join(f.tmp, 'runs');
  // scratch (#120): goes with a removed worktree; logs/screenshots (the evidence) are never touched
  const mk = async (name, status) => {
    const dir = path.join(f.worktrees, name);
    await prepareWorktree({ repo: f.repo, base: 'main', dir });
    const runDir = path.join(runsDir, name);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{}\n');
    if (status) fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ status }));
    fs.mkdirSync(path.join(runDir, 'scratch', 'workspace'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'scratch', 'workspace', 'settings.json'), '{}');
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'logs', 'test.log'), 'log');
    fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'screenshots', 'shot.png'), 'png');
    return dir;
  };
  const scratchOf = (name) => path.join(runsDir, name, 'scratch');
  const ok = await mk('ok', 'success');
  const failed = await mk('failed', 'failed');
  const active = await mk('active', 'success');
  const running = await mk('running', null);
  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [active] });
  assert.deepEqual(removed.map((d) => path.basename(d)), ['ok']);
  assert.ok(!fs.existsSync(ok) && fs.existsSync(failed) && fs.existsSync(active) && fs.existsSync(running));
  assert.ok(!fs.existsSync(scratchOf('ok')), 'the scratch workspace goes with its removed worktree');
  for (const name of ['failed', 'active', 'running']) assert.ok(fs.existsSync(scratchOf(name)), `${name} keeps its scratch while its worktree is kept`);
  // the evidence is never removed, whether or not the worktree (and the scratch workspace) was
  assert.ok(fs.existsSync(path.join(runsDir, 'ok', 'logs', 'test.log')));
  assert.ok(fs.existsSync(path.join(runsDir, 'ok', 'screenshots', 'shot.png')));

  // 30 days without use: removed even if it failed
  const old = (Date.now() - 30 * 864e5) / 1000;
  fs.utimesSync(path.join(runsDir, 'failed', 'events.jsonl'), old, old);
  fs.utimesSync(failed, old, old);
  const index = path.resolve(failed, git(failed, 'rev-parse', '--git-path', 'index'));
  fs.utimesSync(index, old, old);
  const removed2 = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [active], maxAgeDays: 14 });
  assert.deepEqual(removed2.map((d) => path.basename(d)), ['failed']);
  assert.ok(!fs.existsSync(scratchOf('failed')), 'the scratch workspace goes with the worktree once it is finally removed');
  assert.ok(fs.existsSync(path.join(runsDir, 'failed', 'logs', 'test.log')), 'the evidence still stays');
});

test('cleanupWorktrees: a worktree still there after removal (locked by a process) keeps the run\'s scratch workspace and is not reported as removed', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const name = 'locked';
  const dir = path.join(f.worktrees, name);
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  const runDir = path.join(runsDir, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{}\n');
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ status: 'success' }));
  fs.mkdirSync(path.join(runDir, 'scratch', 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'scratch', 'workspace', 'settings.json'), '{}');

  // a locked worktree: `git worktree remove --force` (one --force) refuses it, as it would a
  // folder a process still has open; the fallback (fs.rmSync) is mocked to fail too, as it would
  // for a file still in use
  git(f.repo, 'worktree', 'lock', dir);
  const origRmSync = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, opts) => {
    if (samePath(target, dir)) throw new Error('EBUSY: resource busy or locked');
    return origRmSync(target, opts);
  });

  const { lines, log } = logger();
  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [], log });
  assert.deepEqual(removed, []);
  assert.ok(fs.existsSync(dir), 'the worktree folder is still there: kept for the next cleanup');
  assert.ok(fs.existsSync(path.join(runDir, 'scratch')), 'the scratch workspace stays with it');
  assert.match(lines.join('\n'), /cannot remove a locked working tree/);
});

// ---- engine -----------------------------------------------------------------------
// answer: what every human gate gets (true/false, or a choice id)
async function runFixture({ inputs, worktreesDir, runsDir, resume, file = 'worktree.yaml', answer = true, stopProcesses }) {
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', file), inputs, mock: true, runsDir, worktreesDir, resume, stopProcesses });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, answer));
  });
  await run.start();
  if (!rec.events.writableFinished) await new Promise((r) => rec.events.once('finish', r)); // events.jsonl flushed
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

for (const spelling of SPELLINGS) test(`engine (${spelling} paths): agents work in the run worktree; removed on success, kept on failure and reused on resume`, { timeout: 60000 }, async (t) => {
  const f = spelled(t, spelling);
  if (!f) return;
  const runsDir = path.join(f.tmp, 'runs');

  const ok = await runFixture({ inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir });
  assert.equal(ok.finished.status, 'success', ok.finished.error);
  const dir = path.join(f.worktrees, ok.run.runId);
  const sent = ok.events.find((e) => e.type === 'session.message_sent');
  // worktree_dir is the worktree itself, spelled canonically (no doubled or climbing segments)
  assert.equal(/work in (.+)$/m.exec(sent.prompt)?.[1].trim(), canonicalPath(dir));
  assert.ok(samePath(ok.finished.summary.sessions.find((s) => s.agent === 'a').cwd, dir));
  assert.equal(ok.finished.summary.worktree.removed, true);
  assert.ok(!fs.existsSync(dir));

  const bad = await runFixture({ inputs: { repo_path: f.repo, skill: 'does-not-exist' }, worktreesDir: f.worktrees, runsDir });
  assert.equal(bad.finished.status, 'failed');
  const kept = path.join(f.worktrees, bad.run.runId);
  assert.ok(fs.existsSync(kept));
  assert.equal(bad.finished.summary.worktree.removed, false);
  assert.ok(bad.events.some((e) => e.type === 'worktree.kept'));

  // resume: the new run continues in the previous run's worktree
  fs.writeFileSync(path.join(kept, 'wip.txt'), 'work in progress\n');
  const spec = supervisor.resumeSpec(path.join(runsDir, bad.run.runId), 'work');
  assert.ok(samePath(spec.worktree.dir, kept));
  const resumed = await runFixture({
    inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir,
    resume: { runId: spec.runId, fromStep: 'work', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree },
  });
  assert.equal(resumed.finished.status, 'success', resumed.finished.error);
  assert.equal(resumed.events.find((e) => e.type === 'worktree.ready').reused, true);
  assert.ok(samePath(resumed.finished.summary.sessions.find((s) => s.agent === 'a').cwd, kept));
  assert.ok(!fs.existsSync(kept), 'removed once the resumed run succeeds');
});

// #120: an agent of a run with a worktree never writes a simulated run or a screenshot into the
// owner's own workspace: it gets MULTIAGENT_WORKSPACE pointing at a scratch workspace of its own,
// under the run's folder, created on the first agent turn and removed with the worktree.
test('engine: an agent of a run with a worktree gets MULTIAGENT_WORKSPACE in its environment, pointing at the run\'s own scratch workspace; removed once the worktree is removed', { timeout: 30000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const guard = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.MULTIAGENT_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main }',
    'agents:',
    '  dev: { provider: claude, model: fake, session: handoff, capabilities: { tools: [read, bash:git] } }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, runsDir, worktreesDir: f.worktrees });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const scratchWorkspaceDir = path.join(run.runDir, 'scratch', 'workspace');
  const received = events.find((e) => e.type === 'session.message_received');
  assert.ok(received.text.includes(`MULTIAGENT_WORKSPACE: ${scratchWorkspaceDir}`), received.text);
  // the scratch workspace goes with the worktree once the run succeeds (never left for the owner to find)
  assert.ok(!fs.existsSync(path.join(run.runDir, 'scratch')));
});

test('engine: `goto: end` + `status` sets the outcome; a rejected failure gate is failed and keeps the worktree', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');

  // approved: plain `goto: end` → success, worktree removed
  const ok = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: true });
  assert.equal(ok.finished.status, 'success', ok.finished.error);
  assert.equal(ok.finished.error, null);
  assert.equal(ok.finished.summary.status, 'success');
  assert.equal(ok.finished.summary.worktree.removed, true);
  assert.ok(!fs.existsSync(path.join(f.worktrees, ok.run.runId)));

  // rejected: `goto: end` + `status: failed` → failed, worktree kept for a resume
  const bad = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: false });
  assert.equal(bad.finished.status, 'failed');
  assert.equal(bad.finished.summary.status, 'failed');
  assert.match(bad.finished.error, /ended as failed at step "work_failed" \(rejected\)/);
  const end = bad.events.find((e) => e.type === 'step.transition' && e.from === 'work_failed');
  assert.deepEqual([end.to, end.status], ['end', 'failed']);
  assert.equal(bad.finished.summary.worktree.removed, false);
  assert.ok(bad.events.some((e) => e.type === 'worktree.kept'));
  assert.ok(fs.existsSync(path.join(f.worktrees, bad.run.runId)));
  // summary.json and the runs list agree (the UI reads them)
  assert.equal(JSON.parse(fs.readFileSync(path.join(bad.run.runDir, 'summary.json'), 'utf8')).status, 'failed');
  const listed = require('../src/runs').readRun(runsDir, bad.run.runId);
  assert.equal(listed.status, 'failed');
  assert.match(listed.error, /work_failed/);
});

test('engine: processes left in the worktree are stopped after each agent step and before the worktree is removed', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const calls = [];
  // the process table is the boundary: this one has an electron.exe left by the `work` step
  const stopProcesses = async (dir) => {
    calls.push({ dir, removed: !fs.existsSync(dir) });
    return calls.length > 1 ? [] : [{ pid: 4242, exe: path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe'), reason: 'executable', stopped: true }];
  };
  const r = await runFixture({ file: 'gate-end.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, answer: true, stopProcesses });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const dir = path.join(f.worktrees, r.run.runId);
  // after the agent step `work` and at the end of the run; not after the human gate
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => samePath(c.dir, dir) && !c.removed), 'the worktree still exists when its processes are stopped');
  const ev = r.events.find((e) => e.type === 'worktree.processes_stopped');
  assert.equal(ev.after, 'step work');
  assert.deepEqual(ev.processes.map((p) => [p.pid, path.basename(p.exe), p.reason, p.stopped]), [[4242, 'electron.exe', 'executable', true]]);
  const warn = r.events.find((e) => e.type === 'log' && e.kind === 'worktree_processes');
  assert.match(warn.message, /stopped 1 process\(es\) left running .* after step work: electron\.exe \(pid 4242\)/);

  // a failing check only warns: the run goes on
  const failing = await runFixture({ inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, stopProcesses: async () => { throw new Error('no access'); } });
  assert.equal(failing.finished.status, 'success', failing.finished.error);
  assert.ok(failing.events.some((e) => e.type === 'log' && e.level === 'warn' && /could not check for processes left .*no access/.test(e.message)));
});

test('engine: processes left in the worktree are also stopped after a delegation', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const calls = [];
  // a process left running by the delegated agent (2nd call only): step build (visit 1) ->
  // delegation to dev -> step build (visit 2, exhausted, no delegate this time) -> run end
  const stopProcesses = async (dir) => {
    calls.push(dir);
    return calls.length === 2 ? [{ pid: 5555, exe: path.join(dir, 'node_modules', '.bin', 'watch'), reason: 'executable', stopped: true }] : [];
  };
  const r = await runFixture({ file: 'worktree-delegate.yaml', inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir, stopProcesses });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const dir = path.join(f.worktrees, r.run.runId);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => samePath(c, dir)));
  const ev = r.events.find((e) => e.type === 'worktree.processes_stopped');
  assert.equal(ev.after, 'build delegation to dev');
  assert.deepEqual(ev.processes.map((p) => [p.pid, p.reason, p.stopped]), [[5555, 'executable', true]]);
});

test('engine: without worktreesDir (simulation) or outside git, worktree_dir is the repository folder', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runsDir = path.join(dir, 'runs');
  for (const worktreesDir of [null, path.join(dir, 'worktrees')]) {
    const r = await runFixture({ inputs: { repo_path: dir }, worktreesDir, runsDir });
    assert.equal(r.finished.status, 'success', r.finished.error);
    assert.ok(samePath(r.finished.summary.sessions.find((s) => s.agent === 'a').cwd, dir));
    assert.ok(!r.events.some((e) => e.type === 'worktree.ready'));
    assert.ok(!fs.existsSync(path.join(dir, 'worktrees')));
  }
});

// ---- local workflows (orchestrator.worktree.remote: false + merge: local) -------------------

test('prepareWorktree remote: false starts from the local base, with unpushed commits, and fetches nothing', async (t) => {
  const f = fixture(t);
  const local = commit(f.repo, 'local.txt', 'only here\n', 'local, never pushed');
  // someone pushes to origin: a remote worktree would start there, a local one must not
  commit(f.other, 'remote.txt', 'remote\n');
  git(f.other, 'push', '-q', 'origin', 'main');
  const dir = path.join(f.worktrees, 'run-local');
  const info = await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  assert.equal(info.ref, 'main');
  assert.equal(info.remote, false);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
  assert.ok(fs.existsSync(path.join(dir, 'local.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'remote.txt')));
});

test('mergeLocally: fast-forwards the checked-out local base; the merged branch is deleted with the worktree', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  git(dir, 'switch', '-q', '-c', 'feat/local');
  const head = commit(dir, 'feature.txt', 'feature\n');
  const { lines, log } = logger();
  const r = await mergeLocally({ repo: f.repo, dir, base: 'main', log });
  assert.deepEqual(r, { branch: 'feat/local', base: 'main', commit: head, checkout: canonicalPath(f.repo), rebased: false });
  assert.equal(git(f.repo, 'rev-parse', 'main'), head);
  assert.ok(fs.existsSync(path.join(f.repo, 'feature.txt')), 'the main checkout was updated too');
  assert.match(lines.join('\n'), /fast-forwarded to feat\/local .*nothing pushed/);
  // nothing was pushed
  assert.notEqual(git(f.repo, 'rev-parse', 'origin/main'), head);

  const rm = await removeWorktree({ repo: f.repo, dir, base: 'main', remote: false });
  assert.deepEqual(rm, { removed: true, branch: 'feat/local', branchDeleted: true });
});

test('mergeLocally: rebases onto a base that moved (another local merge), then fast-forwards', async (t) => {
  const f = fixture(t);
  const a = path.join(f.worktrees, 'run-a');
  const b = path.join(f.worktrees, 'run-b');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: a, remote: false });
  await prepareWorktree({ repo: f.repo, base: 'main', dir: b, remote: false });
  git(a, 'switch', '-q', '-c', 'feat/a');
  commit(a, 'a-feature.txt', 'a\n');
  git(b, 'switch', '-q', '-c', 'feat/b');
  commit(b, 'b-feature.txt', 'b\n');
  await mergeLocally({ repo: f.repo, dir: a, base: 'main' });
  const r = await mergeLocally({ repo: f.repo, dir: b, base: 'main' });
  assert.equal(r.rebased, true);
  assert.equal(git(f.repo, 'rev-parse', 'main'), git(b, 'rev-parse', 'HEAD'));
  // linear history: both features on main, no merge commit
  assert.ok(fs.existsSync(path.join(f.repo, 'a-feature.txt')) && fs.existsSync(path.join(f.repo, 'b-feature.txt')));
  assert.equal(git(f.repo, 'rev-list', '--merges', '--count', 'main'), '0');
});

test('mergeLocally: a conflict aborts the rebase, leaves the branch and the base untouched, and names the files', async (t) => {
  const f = fixture(t);
  const a = path.join(f.worktrees, 'run-a');
  const b = path.join(f.worktrees, 'run-b');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: a, remote: false });
  await prepareWorktree({ repo: f.repo, base: 'main', dir: b, remote: false });
  git(a, 'switch', '-q', '-c', 'feat/a');
  commit(a, 'a.txt', 'from a\n');
  git(b, 'switch', '-q', '-c', 'feat/b');
  const bHead = commit(b, 'a.txt', 'from b\n');
  await mergeLocally({ repo: f.repo, dir: a, base: 'main' });
  const mainBefore = git(f.repo, 'rev-parse', 'main');
  await assert.rejects(mergeLocally({ repo: f.repo, dir: b, base: 'main' }), /feat\/b conflicts with the local main in a\.txt/);
  assert.equal(git(b, 'rev-parse', 'HEAD'), bHead, 'branch left as it was');
  assert.equal(git(b, 'symbolic-ref', '--short', 'HEAD'), 'feat/b', 'no rebase in progress');
  assert.equal(git(f.repo, 'rev-parse', 'main'), mainBefore);
});

test('mergeLocally: refuses uncommitted changes where the base is checked out, and moves the ref when it is checked out nowhere', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  git(dir, 'switch', '-q', '-c', 'feat/x');
  const head = commit(dir, 'x.txt', 'x\n');
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'edited, not committed\n');
  await assert.rejects(mergeLocally({ repo: f.repo, dir, base: 'main' }), /has uncommitted changes on main/);
  assert.notEqual(git(f.repo, 'rev-parse', 'main'), head);
  // the owner works on another branch: main is checked out nowhere, so the ref moves
  git(f.repo, 'checkout', '-q', 'a.txt');
  git(f.repo, 'switch', '-q', '-c', 'owner-work');
  const r = await mergeLocally({ repo: f.repo, dir, base: 'main' });
  assert.equal(r.checkout, null);
  assert.equal(git(f.repo, 'rev-parse', 'main'), head);
  assert.equal(git(f.repo, 'symbolic-ref', '--short', 'HEAD'), 'owner-work', 'the owner\'s checkout is untouched');
  // uncommitted changes in the run's own worktree are refused too
  const dir2 = path.join(f.worktrees, 'run2');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: dir2, remote: false });
  git(dir2, 'switch', '-q', '-c', 'feat/y');
  commit(dir2, 'y.txt', 'y\n');
  fs.writeFileSync(path.join(dir2, 'y.txt'), 'dirty\n');
  await assert.rejects(mergeLocally({ repo: f.repo, dir: dir2, base: 'main' }), /run's worktree has uncommitted changes/);
});
