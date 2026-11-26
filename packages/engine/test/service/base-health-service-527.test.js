// #527 the base check in the service (slot wait) and no cascade: acceptance tests written before the code.
//
// While another run holds the machine-wide `suite` slot, the service's base check
// (packages/engine/service/areas/base-health.js afterBaseMerge) waits: its suite does not start, and the Roadmap is
// told "base check waiting for the suite slot" (a `baseCheck:changed` push).
// Contract: the area's check takes the slot in machine-slot slotDir() (CRAFTORIO_LOCKS_DIR when set,
// else the machine folder; the test points it at a temp folder); the waiting push has status 'waiting'
// or a string field matching /waiting for the suite slot/; no 'running' push before the slot is free.
//
// The base check inserts a fix item only for confirmed failures, never for an issue already in an
// unfinished roadmap item or in a live run; and the roadmap's dispatcher never pauses the roadmap
// because a base-health fix item's issue "already has a live run": that item is skipped (with a log
// line) and the roadmap goes on.
//
// Seams: runBaseCheck with faked runSuite / exec (packages/engine/domains/project/base-health.js); the service with mock runs
// (test/service/helpers.js): a manual run of issue #1 waiting at its gate, the roadmap read back.
//
// Contract assumed for the developer:
// - runBaseCheck(ws, { ..., liveRunForIssues }) where liveRunForIssues(issues: [{ number }]) → { runId } | null,
//   the shape of packages/engine/service/areas/runs.js liveRunForIssues (the service area passes ctx's). With a live
//   run for a filed issue, no fix item is inserted for it.
// - An ordinary assertion failure (not about time) is confirmed without a re-run alone, so it is filed
//   and gets its fix item as before (#405); the fix item the base check inserts is recognisable by the
//   dispatcher as a base-health item (however the change marks it).
// - The dispatcher skips such an item: the roadmap stays 'running' (no pausedBy, no error), the item
//   reads 'skipped'.
// - runBaseCheck takes the suite slot (base-health-slot-527.test.js): the slot folder is a temp
//   CRAFTORIO_LOCKS_DIR here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');
const { ISSUE_WORKFLOW, makeService, gitRepo, roadmapProject, until, watchRuns } = require('./helpers');
const { acquireSlot, SUITE_SLOT, SUITE_SLOT_ENV } = require('../../engine/machine-slot');

const loadHealth = () => require('../../domains/project/base-health');
const loadArea = () => require('../../service/areas/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const RED = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };

let saved;
test.beforeEach(() => { saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmpLocks(t) {
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527c-locks-'));
  t.after(() => fs.rmSync(locks, { recursive: true, force: true, maxRetries: 3 }));
  process.env.CRAFTORIO_LOCKS_DIR = locks;
  return locks;
}

// the issue CLI, faked: every create returns the issue `number`'s URL
const execFiling = (number) => async (cli, args) => ((args || []).map(String).includes('create') ? `https://github.com/o/r/issues/${number}` : '');
const red = async () => ({ failures: [{ ...RED }], log: 'red' });

// ---- the slot, through the service area ------------------------------------------------------------

const waitingPush = (p) => p?.status === 'waiting' || Object.values(p || {}).some((v) => typeof v === 'string' && /waiting for the suite slot/i.test(v));

test('#527 the service\'s base check waits while a run holds the suite slot and tells the Roadmap so', async (t) => {
  const { service, api } = makeService(t);
  // #85: the base check is off by default; this test needs it on
  api['settings:set']({ baseCheck: { onRed: 'fix' } });
  const locks = tmpLocks(t);
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh527', folder: repo.dir });
  const pushes = [];
  const ctx = {
    ws: service.workspace(), active: new Map(), isReleaseRun: () => false, notify: () => {},
    events: { emit: (channel, payload) => pushes.push({ channel, status: payload?.status ?? null, waiting: waitingPush(payload), projectId: payload?.projectId ?? null }) },
  };
  const area = loadArea()(ctx);
  // another run's whole suite holds the slot (this live process, so it is not stale)
  const other = await acquireSlot(SUITE_SLOT, { dir: locks, holder: 'run-other', waitMs: 1000 });
  let settled = false;
  let check;
  try {
    check = area.afterBaseMerge({ projectId: project.id, runId: 'run-1', mock: false }, { base: 'main', tested: 'not green' });
    assert.ok(check && typeof check.then === 'function', 'a check started (fixture check)');
    check.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 60 && !settled && !pushes.some((x) => x.waiting); i++) await new Promise((r) => setTimeout(r, 50));
    const mine = pushes.filter((x) => x.projectId === project.id);
    assert.ok(mine.some((x) => x.waiting), `a push says the check waits for the suite slot: ${JSON.stringify(mine)}`);
    assert.ok(!mine.some((x) => x.status === 'running'), 'the suite has not started');
    assert.equal(settled, false, 'the check is still waiting');
  } finally {
    other.release();
  }
  await Promise.race([check, new Promise((r) => setTimeout(r, 20000))]);
});

test('#527 runBaseCheck inserts no fix item for an issue a live run is working on', async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527c-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = tmpLocks(t);
  const f = fixture(t, 'canonical');
  const projectId = 'proj-527-cascade';
  const args = { projectId, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', releaseHoldsBase: () => false, exec: execFiling(501), runSuite: red, slot: { dir: locks, pollMs: 20 } };
  const { runBaseCheck } = loadHealth();
  // the issue is filed first (no fix item: onRed 'issue'), then a run takes it up
  const first = await runBaseCheck(ws, { ...args, onRed: 'issue' });
  assert.equal(first.issues?.[0]?.url, 'https://github.com/o/r/issues/501', 'the issue was filed (fixture check)');
  const asked = [];
  const liveRunForIssues = (issues) => {
    const numbers = (issues || []).map((i) => Number(i?.number ?? i));
    asked.push(...numbers);
    return numbers.includes(501) ? { runId: 'run-live-501', issues: [{ number: 501 }] } : null;
  };
  const r = await runBaseCheck(ws, { ...args, onRed: 'fix', liveRunForIssues });
  assert.equal(r.status, 'red');
  assert.equal(r.fixItem ? r.fixItem.id : null, null, 'no fix item for an issue in a live run');
  const stages = loadRoadmap().readRoadmap(path.join(ws, 'backlog'), projectId).stages;
  assert.equal(stages.length, 0, `no stage inserted: ${JSON.stringify(stages.map((s) => s.name))}`);
  assert.ok(asked.includes(501), 'the live runs were asked about the issue');
});

test('#527 the dispatcher skips a base-health fix item whose issue already has a live run, without pausing the roadmap', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const locks = tmpLocks(t);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 4, perProject: null, countSimulations: true } });
  const p = await roadmapProject(api, ws, t, [1, 2], 'cascade527');
  const it = (number) => ({ workflow: 'fixture-issue.yaml', number, mock: true });
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [it(2)] }] });

  // the base check files issue #1 and puts its fix item in front of the roadmap
  const f = fixture(t, 'canonical');
  const check = await loadHealth().runBaseCheck(ws.root, {
    projectId: p.id, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', onRed: 'fix', workflow: 'fixture-issue.yaml',
    releaseHoldsBase: () => false, exec: execFiling(1), runSuite: red, slot: { dir: locks, pollMs: 20 },
  });
  assert.ok(check.fixItem, 'the fix item was inserted (fixture check)');
  const fixId = check.fixItem.id;

  // meanwhile a run works on issue #1 (started by hand), waiting at its gate
  const { gates } = watchRuns(service);
  const started = await api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 'fix it', repo_path: f.repo }, mock: true, projectId: p.id, issues: [{ number: 1, url: 'https://github.com/o/r/issues/1', title: 'Issue 1' }], confirmed: true });
  await until(() => gates.has(started.runId));

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const r = api['roadmap:get']({ projectId: p.id });
  const fix = r.stages.flatMap((s) => s.items).find((x) => x.id === fixId);
  assert.deepEqual({ state: r.state, pausedBy: r.pausedBy ?? null }, { state: 'running', pausedBy: null }, `the roadmap is not paused: ${r.error || ''}`);
  assert.equal(fix?.status, 'skipped', 'the fix item is skipped');
  assert.notEqual(fix?.runId ?? null, started.runId);
});
