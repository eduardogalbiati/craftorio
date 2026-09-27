// Git worktree per run (src/engine/worktree.js + orchestrator.worktree in the engine).
// Uses throwaway repositories in os.tmpdir() with a local bare repository as `origin` (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareWorktree, removeWorktree, cleanupWorktrees, listWorktrees, isMerged, samePath } = require('../src/engine/worktree');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const supervisor = require('../src/supervisor');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

// origin (bare) + repo (the workspace clone) + other (someone else pushing to origin)
function fixture(t) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
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

test('prepareWorktree: detached at the freshly fetched origin/<base>, not the stale local base', async (t) => {
  const f = fixture(t);
  const fresh = commit(f.other, 'b.txt', 'b\n');
  git(f.other, 'push', '-q', 'origin', 'main');
  const dir = path.join(f.worktrees, 'run1');
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir });
  assert.equal(wt.ref, 'origin/main');
  assert.equal(wt.commit, fresh);
  assert.ok(samePath(wt.workDir, dir));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), fresh);
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
  assert.notEqual(git(f.repo, 'rev-parse', 'main'), fresh, 'the local main is untouched');
  assert.ok((await listWorktrees(f.repo)).some((w) => samePath(w.dir, dir)));

  // same folder again (resume): reused as is
  const again = await prepareWorktree({ repo: f.repo, base: 'main', dir });
  assert.equal(again.reused, true);
});

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

test('prepareWorktree: a subfolder of the repository keeps the same subfolder in the worktree', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repo, 'app'));
  commit(f.repo, 'app/x.txt', 'x\n');
  git(f.repo, 'push', '-q', 'origin', 'main');
  const dir = path.join(f.worktrees, 'run1');
  const wt = await prepareWorktree({ repo: path.join(f.repo, 'app'), base: 'main', dir });
  assert.ok(samePath(wt.workDir, path.join(dir, 'app')));
  assert.ok(fs.existsSync(path.join(wt.workDir, 'x.txt')));
});

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

test('cleanupWorktrees: removes succeeded and stale runs, keeps failed, recent and active ones', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const mk = async (name, status) => {
    const dir = path.join(f.worktrees, name);
    await prepareWorktree({ repo: f.repo, base: 'main', dir });
    fs.mkdirSync(path.join(runsDir, name), { recursive: true });
    fs.writeFileSync(path.join(runsDir, name, 'events.jsonl'), '{}\n');
    if (status) fs.writeFileSync(path.join(runsDir, name, 'summary.json'), JSON.stringify({ status }));
    return dir;
  };
  const ok = await mk('ok', 'success');
  const failed = await mk('failed', 'failed');
  const active = await mk('active', 'success');
  const running = await mk('running', null);
  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [active] });
  assert.deepEqual(removed.map((d) => path.basename(d)), ['ok']);
  assert.ok(!fs.existsSync(ok) && fs.existsSync(failed) && fs.existsSync(active) && fs.existsSync(running));

  // 30 days without use: removed even if it failed
  const old = (Date.now() - 30 * 864e5) / 1000;
  fs.utimesSync(path.join(runsDir, 'failed', 'events.jsonl'), old, old);
  fs.utimesSync(failed, old, old);
  const index = path.resolve(failed, git(failed, 'rev-parse', '--git-path', 'index'));
  fs.utimesSync(index, old, old);
  const removed2 = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [active], maxAgeDays: 14 });
  assert.deepEqual(removed2.map((d) => path.basename(d)), ['failed']);
});

// ---- engine -----------------------------------------------------------------------
async function runFixture({ inputs, worktreesDir, runsDir, resume }) {
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'worktree.yaml'), inputs, mock: true, runsDir, worktreesDir, resume });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => { rec.write(ev); events.push(ev); });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('engine: agents work in the run worktree; removed on success, kept on failure and reused on resume', { timeout: 60000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');

  const ok = await runFixture({ inputs: { repo_path: f.repo }, worktreesDir: f.worktrees, runsDir });
  assert.equal(ok.finished.status, 'success', ok.finished.error);
  const dir = path.join(f.worktrees, ok.run.runId);
  const sent = ok.events.find((e) => e.type === 'session.message_sent');
  assert.match(sent.prompt, new RegExp(`work in ${dir.replace(/\\/g, '\\\\')}`));
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
