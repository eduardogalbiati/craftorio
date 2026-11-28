// #7: a run started from the terminal (scripts/run.js) owns its run folder like an app run: it writes
// runs/<id>/owner.json (pid, host, heartbeat) and keeps the heartbeat fresh, so the app sees it as
// running (not interrupted) and refuses to resume it (and reuse its worktree) while it is alive.
// The CLI run is a mock run in a scratch workspace, held in its first agent turn by a slow mock
// (CRAFTORIO_MOCK_DELAY_SCALE=40: the turn lasts well over 15 s); the test kills it at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { removeTemp } = require('../packages/engine/test/worktree-helpers');

const root = path.join(__dirname, '..');

// one (slow) agent turn, then a gate
const GATED = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-cli-owner
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => removeTemp(dir)); // the CLI run killed after it may still hold it on Windows
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// #7 review: a parent whose `type: workflow` step runs a child run (the child holds the agent turn)
const PARENT = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-cli-owner-parent
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: fixture-cli-owner.yaml
    inputs: {}
`;

// Starts scripts/run.js on the workflow `main` (written with the others of `files` into one folder):
// { child, out(), exited(), gone }. Killed after the test when still running.
function startCli(t, scratch, { main = 'fixture-cli-owner.yaml', files = { 'fixture-cli-owner.yaml': GATED }, scale = '40', extra = [] } = {}) {
  const repo = tmp(t, 'cli-owner-repo-');
  const wfDir = tmp(t, 'cli-owner-wf-');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(wfDir, name), text);
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'run.js'), '--mock', ...extra, '--file', path.join(wfDir, main), '--repo', repo], {
    env: { ...process.env, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_WORKSPACE: scratch, CRAFTORIO_MOCK_DELAY_SCALE: scale },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = false;
  const gone = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
  t.after(async () => { if (!exited) { child.kill('SIGKILL'); await gone; } });
  return { child, out: () => out, exited: () => exited, gone };
}

// Starts a CLI run in `scratch` and resolves once one of its runs is in its slow agent turn: { child, runId, runDir }.
async function startBusyCliRun(t, scratch, opts) {
  const cli = startCli(t, scratch, opts);
  const runsDir = path.join(scratch, 'runs');
  const deadline = Date.now() + 30000;
  for (;;) {
    const ids = fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [];
    const runId = ids.find((id) => {
      try {
        return fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
          .some((l) => { const ev = JSON.parse(l); return ev.type === 'session.opened' && ev.session?.agent === 'a'; });
      } catch { return false; }
    });
    if (runId) return { child: cli.child, runId, runDir: path.join(runsDir, runId), runsDir };
    assert.ok(!cli.exited(), `the CLI run ended before its agent turn:\n${cli.out().slice(-2000)}`);
    assert.ok(Date.now() < deadline, `the CLI run never started its agent turn in 30 s:\n${cli.out().slice(-2000)}`);
    await sleep(100);
  }
}

test('a run started from the terminal writes owner.json with its pid and host, and keeps its heartbeat fresh while it runs', { timeout: 60000 }, async (t) => {
  const scratch = tmp(t, 'cli-owner-ws-');
  const { child, runDir } = await startBusyCliRun(t, scratch);
  await sleep(500);
  assert.equal(child.exitCode, null, 'the CLI run is still in its agent turn');

  const owner = readJson(path.join(runDir, 'owner.json'));
  assert.equal(owner === null, false, 'runs/<id>/owner.json exists while the CLI run is running');
  assert.equal(owner.pid, child.pid);
  assert.equal(owner.host, os.hostname());
  assert.equal(Number.isFinite(Date.parse(owner.started_at)), true, 'started_at is a date');
  const first = Date.parse(owner.heartbeat_at);
  assert.equal(Number.isFinite(first), true, 'heartbeat_at is a date');
  assert.ok(Date.now() - first < 30000, 'the heartbeat is fresh');

  // the heartbeat is refreshed (every 5 s) while the run goes on
  await sleep(7000);
  assert.equal(child.exitCode, null, 'the CLI run is still running');
  const later = readJson(path.join(runDir, 'owner.json'));
  assert.equal(later === null, false, 'owner.json is still there while the run goes on');
  assert.ok(Date.parse(later.heartbeat_at) > first, `the heartbeat moved on (was ${owner.heartbeat_at}, now ${later.heartbeat_at})`);
});

test('the app sees a running terminal run as running, not interrupted, and refuses to resume it', { timeout: 60000 }, async (t) => {
  const scratch = tmp(t, 'cli-owner-ws-');
  const { child, runId } = await startBusyCliRun(t, scratch);

  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const { setupWorkspace } = require('../packages/engine/domains/workspace/workspace');
  const { createService } = require('../packages/engine/service');
  const { readRun } = require('../packages/engine/domains/run/runs');
  const cliHome = tmp(t, 'cli-owner-home-');
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(scratch, { persist: false }));

  assert.equal(child.exitCode, null, 'the CLI run is still running');
  assert.equal(readRun(path.join(scratch, 'runs'), runId).status, 'running');
  await assert.rejects(
    async () => service.api['runs:resume']({ runId, mock: true }),
    /still running|still active/i,
  );
  // nothing was started over it
  assert.deepEqual(service.api['runs:active']().map((r) => r.runId), []);
});

test('a child run of a terminal run (a type: workflow step) owns its own folder: the app lists it as running and refuses to resume it', { timeout: 60000 }, async (t) => {
  const scratch = tmp(t, 'cli-owner-ws-');
  const { child, runId, runDir, runsDir } = await startBusyCliRun(t, scratch, {
    main: 'fixture-cli-owner-parent.yaml',
    files: { 'fixture-cli-owner-parent.yaml': PARENT, 'fixture-cli-owner.yaml': GATED },
  });
  const started = readJson(path.join(runDir, 'owner.json'));
  const parentId = fs.readdirSync(runsDir).find((id) => id !== runId);
  assert.equal(typeof parentId, 'string', 'the parent run has its own folder');
  assert.equal(started === null, false, "the child run's owner.json exists while it runs");
  assert.equal(started.pid, child.pid);
  assert.equal(started.host, os.hostname());
  assert.equal(readJson(path.join(runsDir, parentId, 'owner.json'))?.pid, child.pid, 'the parent is owned by the same terminal');

  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const { setupWorkspace } = require('../packages/engine/domains/workspace/workspace');
  const { createService } = require('../packages/engine/service');
  const { readRun } = require('../packages/engine/domains/run/runs');
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome: tmp(t, 'cli-owner-home-') } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(scratch, { persist: false }));

  assert.equal(child.exitCode, null, 'the CLI run is still running');
  assert.equal(readRun(runsDir, runId).status, 'running');
  await assert.rejects(async () => service.api['runs:resume']({ runId, mock: true }), /still running|still active/i);
  assert.deepEqual(service.api['runs:active']().map((r) => r.runId), []);
});

test('a terminal run and its child runs remove their owner.json when they end', { timeout: 60000 }, async (t) => {
  const scratch = tmp(t, 'cli-owner-ws-');
  const cli = startCli(t, scratch, {
    main: 'fixture-cli-owner-parent.yaml',
    files: { 'fixture-cli-owner-parent.yaml': PARENT, 'fixture-cli-owner.yaml': GATED },
    scale: '0.05',
    extra: ['--auto-approve'],
  });
  await cli.gone;
  assert.equal(cli.child.exitCode, 0, `the CLI run succeeded:\n${cli.out().slice(-2000)}`);
  const runsDir = path.join(scratch, 'runs');
  const ids = fs.readdirSync(runsDir);
  assert.equal(ids.length, 2, 'a parent and a child run');
  for (const id of ids) {
    assert.equal(fs.existsSync(path.join(runsDir, id, 'summary.json')), true, `${id} ended`);
    assert.equal(fs.existsSync(path.join(runsDir, id, 'owner.json')), false, `${id} has no owner.json once ended`);
  }
});
