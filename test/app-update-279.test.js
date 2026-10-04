// Acceptance tests for #279: Self-healing applies merged fixes to the app (pause, update, restart,
// resume the roadmap). Written before the code: src/app-update.js is loaded inside each test.
//
// The contract these tests expect from src/app-update.js (temporary git repositories, nothing
// fetched from the network, the install and the restart injected):
// - findSource({ appDir, isPackaged, projects: [{ id, name, dir }] }) -> { ok: true, project: { id, name },
//   dir, head, short, behind } or { ok: false, reason } (the reason the Settings row shows).
// - applyUpdate({ appDir, sourceDir, install }) -> { ok: true, from, to, subjects, installed } or
//   { ok: false, reason } (nothing changed); install({ cwd }) only when package-lock.json changed,
//   a failed install puts the app folder back on `from`.
// - updateDue({ selfHealing, on, when: 'stage' | 'marked', event: { type: 'item-merged', item } |
//   { type: 'stage-done' }, behind }) -> boolean.
// - runUpdateCycle({ workspaceDir, appDir, sourceDir, pause(reason) -> roadmap ids, resume(ids),
//   activeRuns() -> [{ runId, gate }], pollMs, install, notify({ title, body }), relaunch() }) -> result.
// - writeIntent(workspaceDir, intent, { now }), readIntent(workspaceDir), afterRestart(workspaceDir, { now }),
//   dismissFailedUpdate(workspaceDir): the intent lives at <workspace>/oracle/app-update.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const night = require('../src/night-watch');
const roadmapModel = require('../src/roadmap');

const load = () => require('../src/app-update');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// git with an isolated config, so the machine's settings never change a result
function gitEnv(t) {
  const cfgDir = tmp(t, 'appupd-gitcfg-');
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  // the module under test runs git itself: give it the same isolated config
  const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = cfg;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prev.g;
    if (prev.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = prev.s;
  });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  return (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function commit(git, dir, file, content, subject) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD');
}

// An "upstream" repository, the app folder cloned from it, and the workspace project's clone of the
// same upstream, whose local main has `ahead` more commits than the app (subjects "fix 1", "fix 2"...).
function appAndClone(t, { ahead = 3, lockChange = false } = {}) {
  const git = gitEnv(t);
  const root = tmp(t, 'appupd-');
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q');
  commit(git, upstream, 'package-lock.json', '{"lockfileVersion":3}\n', 'initial');
  commit(git, upstream, 'a.txt', 'one\n', 'second');
  const appDir = path.join(root, 'app');
  const cloneDir = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, appDir);
  git(root, 'clone', '-q', upstream, cloneDir);
  const from = git(appDir, 'rev-parse', 'HEAD');
  for (let i = 1; i <= ahead; i++) commit(git, cloneDir, `fix${i}.txt`, `${i}\n`, `fix ${i}`);
  if (lockChange) commit(git, cloneDir, 'package-lock.json', '{"lockfileVersion":3,"x":1}\n', 'bump a dependency');
  const to = git(cloneDir, 'rev-parse', 'HEAD');
  return { git, root, upstream, appDir, cloneDir, from, to };
}

const head = (git, dir) => git(dir, 'rev-parse', 'HEAD');

// ---- Where it applies -------------------------------------------------------------------------

test('#279 source: a packaged app never updates itself and says why', (t) => {
  const { findSource } = load();
  const r = appAndClone(t);
  const s = findSource({ appDir: r.appDir, isPackaged: true, projects: [{ id: 'p1', name: 'multiagent-orchestrator', dir: r.cloneDir }] });
  assert.equal(s.ok, false);
  assert.match(s.reason, /packaged app updates with a new install/);
});

test('#279 source: no project of the workspace is the app repository, the row says why', (t) => {
  const { findSource } = load();
  const r = appAndClone(t);
  const other = tmp(t, 'appupd-other-');
  r.git(other, 'init', '-q');
  commit(r.git, other, 'b.txt', 'b\n', 'unrelated');
  const s = findSource({ appDir: r.appDir, isPackaged: false, projects: [{ id: 'p2', name: 'other', dir: other }] });
  assert.equal(s.ok, false);
  assert.match(s.reason, /no project of this workspace is this app's repository/);
  const none = findSource({ appDir: r.appDir, isPackaged: false, projects: [] });
  assert.equal(none.ok, false);
  assert.match(none.reason, /no project of this workspace is this app's repository/);
});

test('#279 source: a clone with the same origin is the source, with its main short commit and how far the app is behind', (t) => {
  const { findSource } = load();
  const r = appAndClone(t, { ahead: 3 });
  const s = findSource({ appDir: r.appDir, isPackaged: false, projects: [{ id: 'p1', name: 'multiagent-orchestrator', dir: r.cloneDir }] });
  assert.equal(s.ok, true);
  assert.equal(s.project.id, 'p1');
  assert.equal(s.project.name, 'multiagent-orchestrator');
  assert.equal(s.behind, 3);
  assert.ok(s.short.length >= 7 && r.to.startsWith(s.short), `short ${s.short} is not ${r.to}`);
});

test('#279 source: without a shared origin, a clone whose main contains the app commit is the source', (t) => {
  const { findSource } = load();
  const r = appAndClone(t, { ahead: 2 });
  r.git(r.appDir, 'remote', 'remove', 'origin');
  r.git(r.cloneDir, 'remote', 'set-url', 'origin', 'https://example.invalid/someone/else.git');
  const s = findSource({ appDir: r.appDir, isPackaged: false, projects: [{ id: 'p1', name: 'mao', dir: r.cloneDir }] });
  assert.equal(s.ok, true);
  assert.equal(s.behind, 2);
});

// ---- The update itself -------------------------------------------------------------------------

test('#279 update: fast-forwards the app folder to the clone main and installs nothing when the lockfile did not change', async (t) => {
  const { applyUpdate } = load();
  const r = appAndClone(t, { ahead: 3 });
  const installs = [];
  const res = await applyUpdate({ appDir: r.appDir, sourceDir: r.cloneDir, install: async (o) => { installs.push(o); } });
  assert.equal(res.ok, true, res.reason);
  assert.equal(head(r.git, r.appDir), r.to);
  assert.ok(r.from.startsWith(res.from) && res.from.length >= 7);
  assert.ok(r.to.startsWith(res.to) && res.to.length >= 7);
  assert.deepEqual([...res.subjects].sort(), ['fix 1', 'fix 2', 'fix 3']);
  assert.equal(installs.length, 0);
  assert.equal(r.git(r.appDir, 'status', '--porcelain'), '');
});

test('#279 update: refuses an app folder with uncommitted changes and changes nothing', async (t) => {
  const { applyUpdate } = load();
  const r = appAndClone(t);
  fs.writeFileSync(path.join(r.appDir, 'a.txt'), 'edited by hand\n');
  const res = await applyUpdate({ appDir: r.appDir, sourceDir: r.cloneDir, install: async () => {} });
  assert.equal(res.ok, false);
  assert.match(res.reason, /uncommitted/i);
  assert.equal(head(r.git, r.appDir), r.from);
  assert.equal(fs.readFileSync(path.join(r.appDir, 'a.txt'), 'utf8'), 'edited by hand\n');
});

test('#279 update: refuses a history that is not a fast-forward and changes nothing', async (t) => {
  const { applyUpdate } = load();
  const r = appAndClone(t);
  const local = commit(r.git, r.appDir, 'local.txt', 'mine\n', 'a local commit');
  const res = await applyUpdate({ appDir: r.appDir, sourceDir: r.cloneDir, install: async () => {} });
  assert.equal(res.ok, false);
  assert.match(res.reason, /fast-forward/i);
  assert.equal(head(r.git, r.appDir), local);
});

test('#279 update: installs the dependencies in the app folder when package-lock.json changed', async (t) => {
  const { applyUpdate } = load();
  const r = appAndClone(t, { ahead: 1, lockChange: true });
  const installs = [];
  const res = await applyUpdate({ appDir: r.appDir, sourceDir: r.cloneDir, install: async (o) => { installs.push(o); } });
  assert.equal(res.ok, true, res.reason);
  assert.equal(installs.length, 1);
  assert.equal(path.resolve(installs[0].cwd), path.resolve(r.appDir));
  assert.equal(head(r.git, r.appDir), r.to);
});

test('#279 update: a failed install puts the app folder back on the previous commit', async (t) => {
  const { applyUpdate } = load();
  const r = appAndClone(t, { ahead: 1, lockChange: true });
  const res = await applyUpdate({ appDir: r.appDir, sourceDir: r.cloneDir, install: async () => { throw new Error('npm ERR! network'); } });
  assert.equal(res.ok, false);
  assert.equal(head(r.git, r.appDir), r.from);
  assert.equal(fs.readFileSync(path.join(r.appDir, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3}\n');
});

// ---- When it is due ----------------------------------------------------------------------------

test('#279 trigger: only with Self-healing and the switch on, and only when the source is ahead', () => {
  const { updateDue } = load();
  const merged = { type: 'item-merged', item: { updateAfter: true } };
  assert.equal(updateDue({ selfHealing: true, on: true, when: 'marked', event: merged, behind: 2 }), true);
  assert.equal(updateDue({ selfHealing: false, on: true, when: 'marked', event: merged, behind: 2 }), false);
  assert.equal(updateDue({ selfHealing: true, on: false, when: 'marked', event: merged, behind: 2 }), false);
  assert.equal(updateDue({ selfHealing: true, on: true, when: 'marked', event: merged, behind: 0 }), false);
});

test('#279 trigger: "only after marked items" ignores unmarked items and stage ends; "after every stage" updates at a stage end', () => {
  const { updateDue } = load();
  const unmarked = { type: 'item-merged', item: {} };
  const stageDone = { type: 'stage-done' };
  assert.equal(updateDue({ selfHealing: true, on: true, when: 'marked', event: unmarked, behind: 2 }), false);
  assert.equal(updateDue({ selfHealing: true, on: true, when: 'marked', event: stageDone, behind: 2 }), false);
  assert.equal(updateDue({ selfHealing: true, on: true, when: 'stage', event: stageDone, behind: 2 }), true);
});

test('#279 roadmap: an item keeps its "Update the app after this" mark', (t) => {
  const backlogDir = tmp(t, 'appupd-backlog-');
  roadmapModel.saveStages(backlogDir, 'p1', [
    { items: [{ workflow: 'software-development.yaml', number: 1, mock: true, updateAfter: true }, { workflow: 'software-development.yaml', number: 2, mock: true }] },
  ], { issues: [1, 2].map((n) => ({ number: n, title: `Issue ${n}`, state: 'open', url: `https://github.com/o/r/issues/${n}`, body: '' })) });
  const items = roadmapModel.readRoadmap(backlogDir, 'p1').stages[0].items;
  assert.equal(items[0].updateAfter, true);
  assert.equal(!!items[1].updateAfter, false);
});

// ---- The cycle ---------------------------------------------------------------------------------

function cycleHarness(t, r, { runs = () => [] } = {}) {
  const workspaceDir = tmp(t, 'appupd-ws-');
  const calls = { paused: [], resumed: [], notes: [], relaunched: 0, intentAtRelaunch: null };
  const opts = {
    workspaceDir,
    appDir: r.appDir,
    sourceDir: r.cloneDir,
    pollMs: 5,
    pause: (reason) => { calls.paused.push(reason); return ['p1']; },
    resume: (ids) => { calls.resumed.push(ids); },
    activeRuns: runs,
    install: async () => {},
    notify: (n) => { calls.notes.push(`${n.title || ''} ${n.body || ''}`); },
    relaunch: () => {
      calls.relaunched++;
      calls.intentAtRelaunch = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'oracle', 'app-update.json'), 'utf8'));
    },
  };
  return { workspaceDir, calls, opts };
}

test('#279 cycle: pauses with "Updating the app", updates, writes the intent, tells the owner and restarts', async (t) => {
  const { runUpdateCycle } = load();
  const r = appAndClone(t, { ahead: 3 });
  const { workspaceDir, calls, opts } = cycleHarness(t, r);
  const res = await runUpdateCycle(opts);
  assert.equal(res.ok, true, res.reason);
  assert.equal(calls.paused.length, 1);
  assert.match(calls.paused[0], /Updating the app/);
  assert.equal(head(r.git, r.appDir), r.to);
  assert.equal(calls.relaunched, 1);
  const intent = calls.intentAtRelaunch;
  assert.ok(r.from.startsWith(intent.from) && r.to.startsWith(intent.to));
  assert.deepEqual([...intent.subjects].sort(), ['fix 1', 'fix 2', 'fix 3']);
  assert.deepEqual(intent.roadmaps, ['p1']);
  assert.deepEqual(calls.resumed, []); // the new process resumes the roadmap, not this one
  const before = calls.notes.filter((n) => n.includes('Updating the app'));
  assert.equal(before.length, 1);
  assert.ok(before[0].includes(`${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}`), before[0]);
  assert.match(before[0], /3 commits/);
  const logged = night.readNightLog(path.join(workspaceDir, 'oracle')).filter((e) => e.type === 'oracle.action' && e.kind === 'app.update');
  assert.equal(logged.length, 1);
  assert.ok(r.from.startsWith(logged[0].from) && r.to.startsWith(logged[0].to));
  assert.deepEqual([...logged[0].subjects].sort(), ['fix 1', 'fix 2', 'fix 3']);
});

test('#279 cycle: waits for the runs in progress, a run at a human gate included, notifying the owner once', async (t) => {
  const { runUpdateCycle } = load();
  const r = appAndClone(t);
  let polls = 0;
  let relaunchedWhileBusy = false;
  const runs = () => { polls++; return polls <= 6 ? [{ runId: 'run-1', gate: true }, { runId: 'run-2', gate: false }] : []; };
  const { calls, opts } = cycleHarness(t, r, { runs });
  const relaunch = opts.relaunch;
  opts.relaunch = () => { if (polls <= 6) relaunchedWhileBusy = true; relaunch(); };
  const res = await runUpdateCycle(opts);
  assert.equal(res.ok, true, res.reason);
  assert.ok(polls > 6, 'the cycle did not wait for the runs');
  assert.equal(relaunchedWhileBusy, false);
  assert.equal(calls.relaunched, 1);
  assert.equal(calls.notes.filter((n) => /gate/i.test(n)).length, 1);
});

test('#279 cycle: a refusal changes nothing, resumes the roadmap and tells the owner why', async (t) => {
  const { runUpdateCycle } = load();
  const r = appAndClone(t);
  fs.writeFileSync(path.join(r.appDir, 'a.txt'), 'edited by hand\n');
  const { workspaceDir, calls, opts } = cycleHarness(t, r);
  const res = await runUpdateCycle(opts);
  assert.equal(res.ok, false);
  assert.equal(head(r.git, r.appDir), r.from);
  assert.equal(calls.relaunched, 0);
  assert.deepEqual(calls.resumed, [['p1']]);
  assert.ok(calls.notes.some((n) => /uncommitted/i.test(n)), calls.notes.join(' | '));
  assert.equal(fs.existsSync(path.join(workspaceDir, 'oracle', 'app-update.json')), false);
});

test('#279 cycle: a failed install rolls back, resumes the roadmap and does not restart', async (t) => {
  const { runUpdateCycle } = load();
  const r = appAndClone(t, { ahead: 1, lockChange: true });
  const { calls, opts } = cycleHarness(t, r);
  opts.install = async () => { throw new Error('npm ERR! network'); };
  const res = await runUpdateCycle(opts);
  assert.equal(res.ok, false);
  assert.equal(head(r.git, r.appDir), r.from);
  assert.equal(calls.relaunched, 0);
  assert.deepEqual(calls.resumed, [['p1']]);
});

// ---- After the restart -------------------------------------------------------------------------

function pausedRoadmap(ws) {
  const backlogDir = path.join(ws, 'backlog');
  fs.mkdirSync(backlogDir, { recursive: true });
  roadmapModel.saveStages(backlogDir, 'p1', [{ items: [{ workflow: 'software-development.yaml', number: 1, mock: true }] }],
    { issues: [{ number: 1, title: 'Issue 1', state: 'open', url: 'https://github.com/o/r/issues/1', body: '' }] });
  roadmapModel.updateRoadmap(backlogDir, 'p1', (rm) => ({ ...rm, state: 'paused', pausedBy: null, error: 'Updating the app' }));
  return backlogDir;
}

const INTENT = { from: 'febef8b0000000000000000000000000000000000', to: '5d9be330000000000000000000000000000000000', subjects: ['fix 1', 'fix 2'], roadmaps: ['p1'], appDir: 'C:/apps/multiagent-orchestrator' };

test('#279 after restart: the new process resumes the paused roadmaps and deletes the intent', (t) => {
  const { writeIntent, readIntent, afterRestart } = load();
  const ws = tmp(t, 'appupd-ws-');
  const backlogDir = pausedRoadmap(ws);
  const t0 = Date.parse('2026-10-04T18:00:00Z');
  writeIntent(ws, INTENT, { now: t0 });
  assert.equal(fs.existsSync(path.join(ws, 'oracle', 'app-update.json')), true);
  assert.deepEqual(readIntent(ws).roadmaps, ['p1']);

  const res = afterRestart(ws, { now: t0 + 30 * 1000 });
  assert.equal(res.status, 'updated');
  assert.equal(roadmapModel.readRoadmap(backlogDir, 'p1').state, 'running');
  assert.equal(fs.existsSync(path.join(ws, 'oracle', 'app-update.json')), false);
  assert.equal(afterRestart(ws, { now: t0 + 60 * 1000 }), null); // consumed once
});

test('#279 after restart: no "after" record within 2 minutes leaves the intent and a banner with the command to go back', (t) => {
  const { writeIntent, afterRestart, dismissFailedUpdate } = load();
  const ws = tmp(t, 'appupd-ws-');
  const t0 = Date.parse('2026-10-04T18:00:00Z');
  writeIntent(ws, INTENT, { now: t0 });

  const res = afterRestart(ws, { now: t0 + 10 * 60 * 1000 });
  assert.equal(res.status, 'failed');
  assert.match(res.command, /git -C "?C:\/apps\/multiagent-orchestrator"? checkout febef8b/);
  assert.deepEqual(res.subjects, ['fix 1', 'fix 2']);
  assert.equal(fs.existsSync(path.join(ws, 'oracle', 'app-update.json')), true);
  assert.equal(afterRestart(ws, { now: t0 + 11 * 60 * 1000 }).status, 'failed'); // kept until dismissed

  dismissFailedUpdate(ws);
  assert.equal(fs.existsSync(path.join(ws, 'oracle', 'app-update.json')), false);
});
