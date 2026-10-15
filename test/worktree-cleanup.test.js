// Git worktree per run: cleanupWorktrees (src/engine/worktree.js) removes the worktrees and scratch
// workspaces of ended runs and keeps the live ones, in throwaway repositories (no network).
// Split from test/worktree.test.js (#305); shared fixtures in test/worktree-helpers.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareWorktree, cleanupWorktrees, samePath } = require('../src/engine/worktree');
const { age, commit, endedRun, fixture, git, logger, runEvents, spelled, SPELLINGS } = require('./worktree-helpers');

for (const spelling of SPELLINGS) test(`cleanupWorktrees (${spelling} paths): removes the worktrees of ended and interrupted runs (succeeded, failed, no summary) and keeps active ones; a removed worktree's scratch goes with it, its logs and screenshots stay`, async (t) => {
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
  assert.deepEqual(removed.map((d) => path.basename(d)).sort(), ['failed', 'ok', 'running']);
  assert.ok(!fs.existsSync(ok) && !fs.existsSync(failed) && !fs.existsSync(running));
  assert.ok(fs.existsSync(active), 'a run in progress keeps its worktree');
  for (const name of ['ok', 'failed', 'running']) assert.ok(!fs.existsSync(scratchOf(name)), `${name}: the scratch workspace goes with its removed worktree`);
  assert.ok(fs.existsSync(scratchOf('active')), 'a run in progress keeps its scratch');
  // the evidence is never removed, whether or not the worktree (and the scratch workspace) was
  for (const name of ['ok', 'failed', 'running']) {
    assert.ok(fs.existsSync(path.join(runsDir, name, 'logs', 'test.log')));
    assert.ok(fs.existsSync(path.join(runsDir, name, 'screenshots', 'shot.png')));
  }
});


test('cleanupWorktrees: an ended run\'s uncommitted work becomes a WIP commit on its branch (a detached worktree gets a branch first), recorded as worktree.removed; the branch is never deleted', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  // cancelled, detached, with a new file and a changed tracked file left uncommitted
  const cancelled = path.join(f.worktrees, '20261002-125448-cancel01');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: cancelled });
  fs.writeFileSync(path.join(cancelled, 'wip.txt'), 'work in progress\n');
  fs.writeFileSync(path.join(cancelled, 'a.txt'), 'changed\n');
  const cancelledRun = endedRun(runsDir, '20261002-125448-cancel01', { summary: { status: 'cancelled' } });
  // interrupted (no summary, no owner), on its own branch, its work already committed
  const interrupted = path.join(f.worktrees, '20261002-130000-interr01');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: interrupted });
  git(interrupted, 'switch', '-q', '-c', 'feat/interrupted');
  const head = commit(interrupted, 'b.txt', 'b\n', 'own work');
  const interruptedRun = endedRun(runsDir, '20261002-130000-interr01');

  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.deepEqual(removed.map((d) => path.basename(d)).sort(), ['20261002-125448-cancel01', '20261002-130000-interr01']);
  assert.ok(!fs.existsSync(cancelled) && !fs.existsSync(interrupted));

  const wip = runEvents(cancelledRun).filter((e) => e.type === 'worktree.removed').pop();
  assert.ok(wip, 'the run records worktree.removed');
  assert.ok(wip.branch, 'a detached worktree got a branch');
  assert.ok(wip.wip_commit, 'the WIP commit is recorded');
  assert.equal(git(f.repo, 'rev-parse', `refs/heads/${wip.branch}`), wip.wip_commit, 'the branch points at the WIP commit');
  const message = git(f.repo, 'log', '-1', '--format=%B', wip.wip_commit);
  assert.match(message, /WIP/);
  assert.ok(message.includes('20261002-125448-cancel01'), `the message names the run: ${message}`);
  assert.equal(git(f.repo, 'show', `${wip.wip_commit}:wip.txt`), 'work in progress');
  assert.equal(git(f.repo, 'show', `${wip.wip_commit}:a.txt`), 'changed');

  const own = runEvents(interruptedRun).filter((e) => e.type === 'worktree.removed').pop();
  assert.equal(own?.branch, 'feat/interrupted');
  assert.ok(!own.wip_commit, 'nothing uncommitted: no WIP commit');
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/feat/interrupted'), head, 'the branch keeps the run\'s commits');
});

test('cleanupWorktrees: never removes the worktree of a run live in another app process, or of a run waiting at a human gate, however old', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const live = path.join(f.worktrees, 'live-elsewhere');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: live });
  fs.writeFileSync(path.join(live, 'wip.txt'), 'live\n');
  // owned by another live process on this machine (the test runner that started this file)
  const liveRun = endedRun(runsDir, 'live-elsewhere', { owner: { pid: process.ppid, host: os.hostname(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() } });
  const gate = path.join(f.worktrees, 'at-gate');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: gate });
  fs.writeFileSync(path.join(gate, 'wip.txt'), 'gate\n');
  const gateRun = endedRun(runsDir, 'at-gate', { events: [{ ts: new Date().toISOString(), type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Approve?' }] });
  age(live, 30, liveRun);
  age(gate, 30, gateRun);

  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.deepEqual(removed, []);
  assert.ok(fs.existsSync(path.join(live, 'wip.txt')), 'a live run\'s worktree is untouched');
  assert.ok(fs.existsSync(path.join(gate, 'wip.txt')), 'a run waiting at a human gate keeps its worktree');
  assert.match(git(live, 'status', '--porcelain'), /wip\.txt/, 'nothing was committed in a live run\'s worktree');
  assert.match(git(gate, 'status', '--porcelain'), /wip\.txt/);
});

test('cleanupWorktrees: a folder git does not know (e.g. shots-*) is removed once older than an hour; a newer one may be a worktree being created and stays', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const old = path.join(f.worktrees, 'shots-old');
  const fresh = path.join(f.worktrees, 'shots-new');
  for (const dir of [old, fresh]) {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'shot.png'), 'png');
  }
  const twoHours = (Date.now() - 2 * 3600e3) / 1000;
  fs.utimesSync(path.join(old, 'sub', 'shot.png'), twoHours, twoHours);
  fs.utimesSync(path.join(old, 'sub'), twoHours, twoHours);
  fs.utimesSync(old, twoHours, twoHours);

  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.deepEqual(removed.map((d) => path.basename(d)), ['shots-old']);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(fresh));
});

test('cleanupWorktrees: an ended run\'s worktree that could not be removed (a process holds a file) is removed by the next cleanup once it is free', async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const name = '20261002-140000-locked01';
  const dir = path.join(f.worktrees, name);
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  endedRun(runsDir, name, { summary: { status: 'failed' } });
  git(f.repo, 'worktree', 'lock', dir);
  const origRmSync = fs.rmSync.bind(fs);
  const busy = t.mock.method(fs, 'rmSync', (target, opts) => {
    if (samePath(target, dir)) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return origRmSync(target, opts);
  });
  assert.deepEqual(await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] }), []);
  assert.ok(fs.existsSync(dir), 'still there: left for the next cleanup');

  busy.mock.restore();
  git(f.repo, 'worktree', 'unlock', dir);
  const removed = await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.deepEqual(removed.map((d) => path.basename(d)), [name]);
  assert.ok(!fs.existsSync(dir));
});

// #201: the scratch workspace of an ended run goes even when it has no worktree folder left (e.g.
// the folder was removed by hand, or the run never got one), some days after the run ended; the
// run's logs stay, and a live run's scratch is never touched.
test('cleanupWorktrees: removes the scratch workspace of a run that ended days ago, without a worktree folder; keeps a live run\'s scratch and every run\'s logs', async (t) => {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-scratch-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const runsDir = path.join(tmp, 'runs');
  const worktreesDir = path.join(tmp, 'worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });
  const ended = new Date(Date.now() - 10 * 864e5).toISOString();
  const endedDir = endedRun(runsDir, '20260920-100000-ended001', { summary: { status: 'failed', started_at: ended, finished_at: ended } });
  const liveDir = endedRun(runsDir, '20260920-110000-live0001', { owner: { pid: process.ppid, host: os.hostname(), started_at: ended, heartbeat_at: new Date().toISOString() } });
  for (const runDir of [endedDir, liveDir]) {
    fs.mkdirSync(path.join(runDir, 'scratch', 'workspace', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'scratch', 'workspace', 'skills', 'SKILL.md'), 'seeded');
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'logs', 'test.log'), 'log');
    const when = (Date.now() - 10 * 864e5) / 1000;
    fs.utimesSync(path.join(runDir, 'events.jsonl'), when, when);
  }

  await cleanupWorktrees({ worktreesDir, runsDir, active: [] });
  assert.ok(!fs.existsSync(path.join(endedDir, 'scratch')), 'an ended run\'s scratch is removed');
  assert.ok(fs.existsSync(path.join(liveDir, 'scratch', 'workspace', 'skills', 'SKILL.md')), 'a live run\'s scratch stays');
  for (const runDir of [endedDir, liveDir]) assert.ok(fs.existsSync(path.join(runDir, 'logs', 'test.log')), 'logs stay');
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
