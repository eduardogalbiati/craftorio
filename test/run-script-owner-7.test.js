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
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// Starts a CLI run in `scratch` and resolves once it is in its slow agent turn: { child, runId, runDir }.
async function startBusyCliRun(t, scratch) {
  const repo = tmp(t, 'cli-owner-repo-');
  const file = path.join(tmp(t, 'cli-owner-wf-'), 'fixture-cli-owner.yaml');
  fs.writeFileSync(file, GATED);
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'run.js'), '--mock', '--file', file, '--repo', repo], {
    env: { ...process.env, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_WORKSPACE: scratch, CRAFTORIO_MOCK_DELAY_SCALE: '40' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = false;
  const gone = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
  t.after(async () => { if (!exited) { child.kill('SIGKILL'); await gone; } });

  const runsDir = path.join(scratch, 'runs');
  const deadline = Date.now() + 30000;
  for (;;) {
    const ids = fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [];
    const runId = ids.find((id) => {
      try { return fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8').includes('"session.opened"'); } catch { return false; }
    });
    if (runId) return { child, runId, runDir: path.join(runsDir, runId) };
    assert.ok(!exited, `the CLI run ended before its agent turn:\n${out.slice(-2000)}`);
    assert.ok(Date.now() < deadline, `the CLI run never started its agent turn in 30 s:\n${out.slice(-2000)}`);
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
