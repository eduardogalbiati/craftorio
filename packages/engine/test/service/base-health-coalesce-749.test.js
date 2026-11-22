// #749 merges outside the roadmap share the base check until it starts; the stage check needs a merge.
// Seam: the base-health service area (packages/engine/service/areas/base-health.js) built from a small
// ctx, as test/service/base-health-stage-749.test.js builds it. The project's repo has no test command:
// each check that reaches the suite pushes one `baseCheck:changed` with status 'running' (#465), which
// counts the checks; the slot wait pushes status 'waiting' (#527).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('./helpers');
const { acquireSlot, SUITE_SLOT } = require('../../engine/machine-slot');

const loadArea = () => require('../../service/areas/base-health');

let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env.CRAFTORIO_SUITE_SLOT };
  delete process.env.CRAFTORIO_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh749c-locks-'));
  process.env.CRAFTORIO_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', savedSlot.locks], ['CRAFTORIO_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh749c', folder: repo.dir });
  const pushes = [];
  const ctx = {
    ws, active: new Map(), isReleaseRun: () => false, notify: () => {},
    events: { emit: (channel, payload) => pushes.push({ channel, payload: JSON.parse(JSON.stringify(payload ?? null)) }) },
  };
  const area = loadArea()(ctx);
  const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo.dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const ofProject = (status) => pushes.filter((x) => x.channel === 'baseCheck:changed' && x.payload?.projectId === project.id && x.payload?.status === status);
  return { repo, project, area, gitIn, ofProject };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const run = (projectId, runId) => ({ projectId, runId, mock: false });

test('#749 a merge outside the roadmap that comes while the check waits for the suite slot joins it, on the latest tip', async (t) => {
  const { repo, project, area, gitIn, ofProject } = await setup(t);
  // another run's whole suite holds the machine's slot
  const other = await acquireSlot(SUITE_SLOT, { dir: savedSlot.dir, holder: 'run-other', waitMs: 1000 });
  let p1;
  let p2;
  let tip;
  try {
    p1 = area.afterBaseMerge(run(project.id, 'solo-1'), { base: 'main' });
    for (let i = 0; i < 60 && !ofProject('waiting').length; i++) await sleep(50);
    assert.equal(ofProject('waiting').length > 0, true, 'fixture: the first check waits for the slot');
    fs.writeFileSync(path.join(repo.dir, 'c.txt'), 'c\n');
    gitIn('add', 'c.txt');
    gitIn('commit', '-q', '-m', 'merge during the wait');
    tip = gitIn('rev-parse', 'HEAD');
    p2 = area.afterBaseMerge(run(project.id, 'solo-2'), { base: 'main' });
    assert.equal(!!(p2 && typeof p2.then === 'function'), true, 'the second merge gets a check');
  } finally {
    other.release();
  }
  const [r1, r2] = await Promise.all([p1, p2]);
  await sleep(50);
  assert.equal(ofProject('running').length, 1, 'one check for both merges');
  assert.equal(r1.commit, tip, 'it checks the tip with the merge that came during the wait');
  assert.equal(r2.commit, tip);
});

test('#749 a merge outside the roadmap after the check started gets a check of its own', async (t) => {
  const { repo, project, area, gitIn, ofProject } = await setup(t);
  const r1 = await area.afterBaseMerge(run(project.id, 'solo-1'), { base: 'main' });
  fs.writeFileSync(path.join(repo.dir, 'd.txt'), 'd\n');
  gitIn('add', 'd.txt');
  gitIn('commit', '-q', '-m', 'later merge');
  const tip = gitIn('rev-parse', 'HEAD');
  const r2 = await area.afterBaseMerge(run(project.id, 'solo-2'), { base: 'main' });
  await sleep(50);
  assert.notEqual(r1.commit, tip, 'fixture: the first check ran on the earlier tip');
  assert.equal(r2.commit, tip, 'the later merge is checked on its tip');
  assert.equal(ofProject('running').length, 2);
});

test('#749 a stage end with no merge recorded and no base given starts no check', async (t) => {
  const { project, area, ofProject } = await setup(t);
  assert.equal(area.afterStageEnded(project.id), null);
  await sleep(50);
  assert.equal(ofProject('running').length, 0);
});

test('#749 a stage end with onRed \'off\' starts no check', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh749off', folder: repo.dir });
  api['settings:set']({ baseCheck: { onRed: 'off' } });
  const area = loadArea()({ ws, active: new Map(), isReleaseRun: () => false, notify: () => {} });
  assert.equal(area.afterStageEnded(project.id, { base: 'main' }), null);
});
