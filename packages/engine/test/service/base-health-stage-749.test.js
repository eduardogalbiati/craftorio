// #749 the base check once per roadmap stage, not per merge: acceptance tests written before the code
// (packages/engine/service/areas/base-health.js).
//
// - A roadmap run's `merge: local` starts no check; the check runs once when the stage ends
//   (`afterStageEnded`, called by the roadmap's dispatch when the last item of a stage finished,
//   merged or not), on the base tip.
// - A merge "not tested green" still starts a check at once, roadmap run or not.
// - Runs outside the roadmap still check after their merge, coalesced: two merges close together
//   start one check, on the latest tip.
// - A stage end with nothing new since the last green check runs no suite, and the base status
//   (`baseCheckState`, what the Roadmap shows) reads green at that commit.
//
// Seam: the area built from a small ctx as test/service/base-health-push-465.test.js builds it; the
// project's repo (test/service/helpers.js gitRepo) has no test command, so a check that runs ends
// `error`, and each check that reaches the suite pushes one `baseCheck:changed` with
// status 'running' (#465): those pushes count the checks.
// Assumptions (the new seam's name and arguments are this test's contract):
// - `area.afterStageEnded(projectId, { base })` → the check's promise (resolves with the check's result).
// - A run is a roadmap run when an item of the project's roadmap names its runId.
// - A skipped check resolves with `status: 'skipped'`.
// - "Close together" means calls in the same moment (no wait between them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('./helpers');

const loadArea = () => require('../../service/areas/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');
const loadStore = () => require('../../engine/base-health-store');

let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env.CRAFTORIO_SUITE_SLOT };
  delete process.env.CRAFTORIO_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh749s-locks-'));
  process.env.CRAFTORIO_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', savedSlot.locks], ['CRAFTORIO_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

const item = (id, runId, status) => ({ id, workflow: 'feature.yaml', inputs: { task: `task ${id}` }, status, ...(runId ? { runId } : {}) });

// stage s1 runs two items (run-1, run-2); stage s2 is planned
function writeStage(ws, projectId, s1 = ['running', 'running']) {
  loadRoadmap().writeRoadmap(ws.backlog, projectId, {
    state: 'running', simulated: false, error: null, pausedBy: null, scope: null,
    stages: [
      { id: 's1', name: 'Stage one', note: '', items: [item('i1', 'run-1', s1[0]), item('i2', 'run-2', s1[1])] },
      { id: 's2', name: 'Stage two', note: '', items: [item('i3', null, 'planned')] },
    ],
  });
}

async function setup(t) {
  const { service, api } = makeService(t);
  // #85: the base check is off by default; this test needs it on
  api['settings:set']({ baseCheck: { onRed: 'fix' } });
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh749', folder: repo.dir });
  const pushes = [];
  const ctx = {
    ws, active: new Map(), isReleaseRun: () => false, notify: () => {},
    events: { emit: (channel, payload) => pushes.push({ channel, payload: JSON.parse(JSON.stringify(payload ?? null)) }) },
  };
  const area = loadArea()(ctx);
  const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo.dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const head = gitIn('rev-parse', 'HEAD');
  // the checks that reached the suite: one 'running' push each
  const started = () => pushes.filter((x) => x.channel === 'baseCheck:changed' && x.payload?.projectId === project.id && x.payload?.status === 'running');
  return { ws, repo, project, area, pushes, head, gitIn, started };
}

const settle = (ms = 150) => new Promise((res) => setTimeout(res, ms));
const run = (projectId, runId) => ({ projectId, runId, mock: false });

test('#749 a stage of two runs triggers one check, after both, on the base tip', async (t) => {
  const { ws, project, area, head, started } = await setup(t);
  writeStage(ws, project.id);
  const first = area.afterBaseMerge(run(project.id, 'run-1'), { base: 'main' });
  writeStage(ws, project.id, ['done', 'running']);
  const second = area.afterBaseMerge(run(project.id, 'run-2'), { base: 'main' });
  await Promise.all([first, second].map((p) => (p && typeof p.then === 'function' ? Promise.race([p, settle()]) : null)));
  await settle();
  assert.equal(started().length, 0, 'a roadmap run\'s merge starts no check of its own');

  writeStage(ws, project.id, ['done', 'done']);
  assert.equal(typeof area.afterStageEnded, 'function', 'the area has afterStageEnded (the roadmap calls it when a stage ends)');
  const check = area.afterStageEnded(project.id, { base: 'main' });
  assert.ok(check && typeof check.then === 'function', 'the stage end starts the check');
  const r = await check;
  assert.equal(r.commit, head, 'the check runs on the base tip');
  await settle(50);
  assert.equal(started().length, 1, 'one check for the whole stage');
});

test('#749 a roadmap run\'s merge "not tested green" still starts a check at once', async (t) => {
  const { ws, project, area, head, started } = await setup(t);
  writeStage(ws, project.id);
  const check = area.afterBaseMerge(run(project.id, 'run-1'), { base: 'main', tested: 'not green' });
  assert.ok(check && typeof check.then === 'function', 'a check started at the merge, the stage still running');
  const r = await check;
  assert.notEqual(r.status, 'deferred');
  assert.notEqual(r.status, 'skipped', 'a merge "not tested green" is checked');
  assert.equal(r.commit, head);
  assert.equal(started().length, 1);
});

test('#749 two runs outside the roadmap ending together trigger one check, on the latest tip', async (t) => {
  const { ws, repo, project, area, gitIn, started } = await setup(t);
  writeStage(ws, project.id);
  const p1 = area.afterBaseMerge(run(project.id, 'solo-1'), { base: 'main' });
  fs.writeFileSync(path.join(repo.dir, 'b.txt'), 'b\n');
  gitIn('add', 'b.txt');
  gitIn('commit', '-q', '-m', 'second merge');
  const tip = gitIn('rev-parse', 'HEAD');
  const p2 = area.afterBaseMerge(run(project.id, 'solo-2'), { base: 'main' });
  for (const p of [p1, p2]) assert.ok(p && typeof p.then === 'function', 'a run outside the roadmap still gets a check after its merge');
  const [r1, r2] = await Promise.all([p1, p2]);
  await settle(50);
  assert.equal(started().length, 1, 'the two merges share one check');
  assert.equal(r1.commit, tip, 'the check runs on the latest tip');
  assert.equal(r2.commit, tip);
});

test('#749 a stage end at the last green commit runs no suite; the base status reads green at that commit', async (t) => {
  const { ws, project, area, head, started } = await setup(t);
  writeStage(ws, project.id, ['done', 'done']);
  loadStore().writeStore(ws.root, project.id, { failures: [], flaky: [], lastGreen: { commit: head, at: '2026-11-01T10:00:00.000Z' } });
  assert.equal(typeof area.afterStageEnded, 'function', 'the area has afterStageEnded');
  const r = await area.afterStageEnded(project.id, { base: 'main' });
  assert.equal(r.status, 'skipped');
  await settle(50);
  assert.equal(started().length, 0, 'no suite ran');
  const state = area.baseCheckState(project.id);
  assert.equal(state?.status, 'green', `the base status is green: ${JSON.stringify(state)}`);
  assert.equal(state?.commit, head, 'at the last green commit');
});
