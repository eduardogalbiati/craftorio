// #414 "Runs give their tests a temp folder inside the run, removed when the run ends": acceptance
// tests written before the code.
//
// Every process of a run (the agents' CLIs, the suite and e2e steps) gets TMP, TEMP and TMPDIR set to
// `<run dir>/tmp`, one of the run's folders agents may write to; the folder goes when the run ends
// and cleanupWorktrees removes the `tmp` of ended runs left behind. A simulated (mock) run does not
// change.
//
// Seams:
// - capabilities (packages/engine/engine/capabilities.js): RUN_DIRS and runDirs(caps, runDir), the folders an
//   agent may write to (Claude Code gets them with --add-dir); agentEnv(scratch, workers), the
//   agents' environment.
// - runSuite (packages/engine/engine/suite-step.js) with a stubbed `run` (no real process): the env the suite
//   command is started with.
// - cleanupWorktrees (packages/engine/engine/worktree.js) on run folders written the way the engine leaves them.
//
// Assumptions:
// - The run's scratch (the object scratchWorkspace() hands agentEnv) carries the run's temp folder
//   as `tmp`, next to `workspace` and `userData`; agentEnv sets the three variables from it.
// - runSuite creates `<runDir>/tmp` before it starts the command (a test's mkdtemp fails otherwise).
// - The `tmp` of an ended run without a worktree folder is removed at least once the run ended days
//   ago (the scratch workspace's rule, #201); the tests age the run by 10 days.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { endedRun, fixture } = require('./worktree-helpers');

const loadCaps = () => require('../engine/capabilities');
const loadSuite = () => require('../engine/suite-step');
const loadWorktree = () => require('../engine/worktree');

const TMP_VARS = ['TMP', 'TEMP', 'TMPDIR'];
const tmpVars = (env) => TMP_VARS.map((k) => env[k]);

function tmpdir(t, prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

/** What a test of the run leaves in its temp folder. */
function seedTmp(runDir) {
  const dir = path.join(runDir, 'tmp', 'service-ws-a1b2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
}

const daysAgo = (runDir, days) => {
  const when = (Date.now() - days * 864e5) / 1000;
  fs.utimesSync(path.join(runDir, 'events.jsonl'), when, when);
};

// ---- the folders an agent may write to --------------------------------------------------------------

test('#414 tmp is one of the run\'s folders, so an agent with commands may write to <run dir>/tmp (Claude Code gets it with --add-dir)', () => {
  const caps = loadCaps();
  assert.ok(caps.RUN_DIRS.includes('tmp'), `RUN_DIRS: ${JSON.stringify(caps.RUN_DIRS)}`);
  const dirs = caps.runDirs(caps.normalize({ tools: ['read', 'bash:git'] }), 'C:/run');
  assert.ok(dirs.includes(path.join('C:/run', 'tmp')), `runDirs: ${JSON.stringify(dirs)}`);
});

// ---- the agents' environment -----------------------------------------------------------------------

test('#414 agentEnv: an agent of a run gets TMP, TEMP and TMPDIR set to the run\'s tmp folder', () => {
  const scratch = { workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data', tmp: path.join('C:/run', 'tmp') };
  const env = loadCaps().agentEnv(scratch);
  assert.deepEqual(tmpVars(env), [path.join('C:/run', 'tmp'), path.join('C:/run', 'tmp'), path.join('C:/run', 'tmp')]);
  assert.equal(env.CRAFTORIO_WORKSPACE, 'C:/run/scratch/workspace', 'the scratch workspace is still given');
});

test('#414 agentEnv: the run\'s test workers do not drop the temp folder', () => {
  const scratch = { workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data', tmp: path.join('C:/run', 'tmp') };
  const env = loadCaps().agentEnv(scratch, { testWorkers: 2 });
  assert.deepEqual(tmpVars(env), [path.join('C:/run', 'tmp'), path.join('C:/run', 'tmp'), path.join('C:/run', 'tmp')]);
});

test('#414 agentEnv: without a run scratch (a simulated run, no worktree) the environment sets no temp folder', () => {
  const { agentEnv } = loadCaps();
  for (const env of [agentEnv(), agentEnv(null)]) assert.deepEqual(tmpVars(env), [undefined, undefined, undefined]);
});

// ---- the suite step's environment ------------------------------------------------------------------

test('#414 runSuite: the suite command gets TMP, TEMP and TMPDIR set to <run dir>/tmp, created before it starts, over the inherited ones', async (t) => {
  const runDir = tmpdir(t, 'tmp-414-run-');
  const cwd = tmpdir(t, 'tmp-414-wt-');
  let seen = null;
  const run = async ({ env }) => {
    seen = { vars: tmpVars(env), exists: fs.existsSync(path.join(runDir, 'tmp')) };
    return { code: 0, timedOut: false, error: null };
  };
  const inherited = { PATH: process.env.PATH, TMP: 'C:/Users/u/AppData/Local/Temp', TEMP: 'C:/Users/u/AppData/Local/Temp', TMPDIR: '/tmp' };
  const out = await loadSuite().runSuite({ command: 'npm test', cwd, runDir, round: 1, env: inherited, run });
  assert.equal(out.status, 'pass', out.message);
  const tmp = path.join(runDir, 'tmp');
  assert.deepEqual(seen, { vars: [tmp, tmp, tmp], exists: true });
});

test('#414 runSuite (mock): a simulated suite creates no temp folder', async (t) => {
  const runDir = tmpdir(t, 'tmp-414-mock-');
  const out = await loadSuite().runSuite({ command: 'npm test', cwd: '/x', runDir, round: 1, mock: true, mockResult: 'pass' });
  assert.equal(out.status, 'pass');
  assert.equal(fs.existsSync(path.join(runDir, 'tmp')), false);
});

// ---- cleanupWorktrees removes what ended runs left behind ------------------------------------------

test('#414 cleanupWorktrees: an ended run\'s tmp goes with its worktree; a live run keeps its tmp; logs stay', async (t) => {
  const { prepareWorktree, cleanupWorktrees } = loadWorktree();
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  const ended = '20261015-212604-8f1f5b9a';
  const live = '20261015-212635-3dc17ed9';
  for (const name of [ended, live]) await prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, name) });
  const endedDir = endedRun(runsDir, ended, { summary: { status: 'failed' } });
  const liveDir = endedRun(runsDir, live, { owner: { pid: process.ppid, host: os.hostname(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() } });
  for (const runDir of [endedDir, liveDir]) {
    seedTmp(runDir);
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'logs', 'suite-1.log'), 'log');
  }

  await cleanupWorktrees({ worktreesDir: f.worktrees, runsDir, active: [] });
  assert.equal(fs.existsSync(path.join(f.worktrees, ended)), false, 'the ended run\'s worktree is removed');
  assert.equal(fs.existsSync(path.join(endedDir, 'tmp')), false, 'its tmp goes with it');
  assert.equal(fs.existsSync(path.join(liveDir, 'tmp', 'service-ws-a1b2', 'settings.json')), true, 'a live run keeps its tmp');
  for (const runDir of [endedDir, liveDir]) assert.equal(fs.existsSync(path.join(runDir, 'logs', 'suite-1.log')), true, 'logs stay');
});

test('#414 cleanupWorktrees: removes the tmp an ended run left behind without a worktree folder (a crash); keeps the tmp of a live run and of a run waiting at a gate', async (t) => {
  const { cleanupWorktrees } = loadWorktree();
  const tmp = tmpdir(t, 'tmp-414-clean-');
  const runsDir = path.join(tmp, 'runs');
  const worktreesDir = path.join(tmp, 'worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });
  const at = new Date(Date.now() - 10 * 864e5).toISOString();
  const endedDir = endedRun(runsDir, '20261005-100000-ended414', { summary: { status: 'failed', started_at: at, finished_at: at } });
  const liveDir = endedRun(runsDir, '20261005-110000-live0414', { owner: { pid: process.ppid, host: os.hostname(), started_at: at, heartbeat_at: new Date().toISOString() } });
  const gateDir = endedRun(runsDir, '20261005-120000-gate0414', { events: [{ ts: at, type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Approve?' }] });
  for (const runDir of [endedDir, liveDir, gateDir]) {
    seedTmp(runDir); // only tmp: no scratch workspace, no worktree folder
    daysAgo(runDir, 10);
  }

  await cleanupWorktrees({ worktreesDir, runsDir, active: [] });
  assert.equal(fs.existsSync(path.join(endedDir, 'tmp')), false, 'an ended run\'s tmp is removed');
  assert.equal(fs.existsSync(path.join(liveDir, 'tmp', 'service-ws-a1b2', 'settings.json')), true, 'a live run keeps its tmp');
  assert.equal(fs.existsSync(path.join(gateDir, 'tmp', 'service-ws-a1b2', 'settings.json')), true, 'a run waiting at a gate keeps its tmp');
});

test('#414 cleanupWorktrees: a tmp a process still holds stays without an error, and the next cleanup removes it once free', async (t) => {
  const { cleanupWorktrees, samePath } = loadWorktree();
  const tmp = tmpdir(t, 'tmp-414-locked-');
  const runsDir = path.join(tmp, 'runs');
  const worktreesDir = path.join(tmp, 'worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });
  const at = new Date(Date.now() - 10 * 864e5).toISOString();
  const runDir = endedRun(runsDir, '20261005-130000-lock0414', { summary: { status: 'success', started_at: at, finished_at: at } });
  seedTmp(runDir);
  daysAgo(runDir, 10);
  const held = path.join(runDir, 'tmp');
  const origRmSync = fs.rmSync.bind(fs);
  const busy = t.mock.method(fs, 'rmSync', (target, opts) => {
    if (samePath(target, held)) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return origRmSync(target, opts);
  });

  await cleanupWorktrees({ worktreesDir, runsDir, active: [] });
  assert.equal(fs.existsSync(path.join(held, 'service-ws-a1b2', 'settings.json')), true, 'still there: left for the next cleanup');

  busy.mock.restore();
  await cleanupWorktrees({ worktreesDir, runsDir, active: [] });
  assert.equal(fs.existsSync(held), false, 'removed once no process holds it');
});

// ---- suiteEnv: the option runSuite passes --------------------------------------------------------

test('#414 suiteEnv: tmpDir sets TMP, TEMP and TMPDIR over the inherited ones; without it the inherited values pass through and nothing more is removed', () => {
  const { suiteEnv } = loadSuite();
  const inherited = { PATH: '/bin', TMP: 'C:/Users/u/AppData/Local/Temp', TEMP: 'C:/Users/u/AppData/Local/Temp', TMPDIR: '/tmp' };
  const tmp = path.join('C:/ws/runs/r1', 'tmp');
  const withTmp = suiteEnv(inherited, { tmpDir: tmp });
  assert.deepEqual(tmpVars(withTmp.env), [tmp, tmp, tmp]);
  assert.equal(withTmp.env.PATH, '/bin');
  const without = suiteEnv(inherited);
  assert.deepEqual(tmpVars(without.env), ['C:/Users/u/AppData/Local/Temp', 'C:/Users/u/AppData/Local/Temp', '/tmp']);
  assert.deepEqual(withTmp.removed, without.removed, 'the temp variables are replaced, not reported as removed');
});
