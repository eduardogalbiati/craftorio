// #607: a restart continues live runs by itself, once, and reports the lost turn. A "crash" is a
// finished mock run whose folder is cut back to what the app had written when it died: events.jsonl
// up to the cut, no summary.json, an owner.json whose heartbeat went stale and the active-run marker.
// A new service started on the same workspace (setWorkspace: the start-up of the app and of
// `npm run serve`) must continue it in its own folder, with its own run id.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { createService } = require('../../service');
const { RESUME_WORKFLOW } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEAD_PID = 999999;

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const untilIdle = (service) => waitFor(() => service.api['runs:active']().length === 0, 'the service to be idle', 60000);

// One workspace folder shared by every service of the test; a single hook stops them all (in the
// order they were booted) and only then removes the folder.
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-ws-'));
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-cli-home-'));
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
  const services = [];
  t.after(async () => {
    for (const s of services) {
      if (s.down) continue;
      for (const run of s.api['runs:active']()) {
        try { s.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ }
      }
      await untilIdle(s.service).catch(() => {});
      s.service.shutdown();
    }
    for (let i = 0; ; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) {
        if (i >= 100 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e.code)) throw e;
        await sleep(100);
      }
    }
    fs.rmSync(cliHome, { recursive: true, force: true });
  });
  return { dir, cliHome, services };
}

// Starts a service on the scratch workspace. Its events are collected from before setWorkspace, so a
// run recovered at start-up is seen from its first event; gates are approved unless autoApprove is off.
function boot(sc, { autoApprove = true } = {}) {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome: sc.cliHome } });
  const events = [];
  service.events.on('run:event', (ev) => {
    events.push(ev);
    if (autoApprove && ev.type === 'approval.requested') setImmediate(() => service.api['approval:resolve']({ runId: ev.run_id, id: ev.approval_id, answer: true }));
  });
  const s = { service, api: service.api, events, down: false };
  sc.services.push(s);
  service.setWorkspace(setupWorkspace(sc.dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-resume.yaml'), RESUME_WORKFLOW);
  return s;
}

function shutdown(s) { s.service.shutdown(); s.down = true; }

// Runs fixture-resume.yaml to its end in `s` (gates approved) and returns its run id and folder.
async function runToEnd(s) {
  const { runId } = await s.api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true });
  await waitFor(() => s.events.some((e) => e.type === 'workflow.finished' && e.run_id === runId), `run ${runId} to end`);
  await untilIdle(s.service);
  return { runId, runDir: path.join(s.service.workspace().runs, runId) };
}

const readLines = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
const readEvents = (runDir) => readLines(runDir).map((l) => JSON.parse(l));
const readSummary = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
const visits = (summary) => Object.fromEntries(Object.entries(summary.steps).map(([id, s]) => [id, s.visits]));
const agentTurns = (summary) => summary.sessions.filter((x) => x.agent !== 'orchestrator').reduce((n, x) => n + (x.turns || 0), 0);

// Cuts a finished run's folder back to what a crash right after event `cutIndex` leaves behind: the
// log up to that event, no summary.json, a stale owner.json (a dead process, 60 s without a beat)
// and the workspace's active-run marker naming it. Returns how many events were kept.
function crash(ws, runDir, cutIndex, { owner, mock = true } = {}) {
  const lines = readLines(runDir).slice(0, cutIndex + 1);
  if (!mock) lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), mock: false });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), lines.join('\n') + '\n');
  fs.rmSync(path.join(runDir, 'summary.json'), { force: true });
  fs.rmSync(path.join(runDir, 'result.md'), { force: true });
  const beat = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify(owner || { pid: DEAD_PID, host: os.hostname(), started_at: beat, heartbeat_at: beat }));
  const runId = path.basename(runDir);
  fs.writeFileSync(ws.activeRun, JSON.stringify([{ runId, workflow: 'fixture-resume', mock, project: null, title: null }]));
  return lines.length;
}

const indexOf = (events, pred) => {
  const i = events.findIndex(pred);
  assert.ok(i >= 0, 'cut point not found in the recorded log');
  return i;
};

test('a run killed between two steps continues by itself at start-up, in its own folder with its own id, to the same end as an uninterrupted run', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const reference = await runToEnd(a);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);

  const before = readEvents(victim.runDir);
  const planCost = readSummary(victim.runDir).sessions.find((x) => x.step_id === 'plan').cost_usd;
  const planDone = indexOf(before, (e) => e.type === 'step.finished' && e.step_id === 'plan');
  const kept = crash(ws, victim.runDir, indexOf(before.slice(planDone), (e) => e.type === 'step.transition') + planDone);
  const foldersBefore = fs.readdirSync(ws.runs).sort();

  boot(sc);
  await waitFor(() => fs.existsSync(path.join(victim.runDir, 'summary.json')), 'the recovered run to end');

  const summary = readSummary(victim.runDir);
  const ref = readSummary(reference.runDir);
  assert.equal(summary.run_id, victim.runId, 'same run id');
  assert.equal(summary.status, 'success');
  assert.equal(summary.mock, true, 'a simulated run recovers as a simulation');
  assert.deepEqual(fs.readdirSync(ws.runs).sort(), foldersBefore, 'no new run folder: it continues in its own');
  assert.deepEqual(visits(summary), visits(ref));
  assert.equal(agentTurns(summary), agentTurns(ref), 'the finished turn before the crash is not run again');
  assert.equal(summary.sessions.find((x) => x.step_id === 'plan').cost_usd, planCost, 'the cost before the crash is kept');
  const sum = summary.sessions.reduce((n, x) => n + (x.cost_usd || 0), 0);
  assert.equal(summary.cost_usd.toFixed(4), sum.toFixed(4), 'the run cost is its sessions\' cost, nothing lost or counted twice');

  const after = readEvents(victim.runDir).slice(kept);
  assert.equal(after.some((e) => e.type === 'step.started' && e.step_id === 'plan'), false, 'plan is not run again');
  assert.equal(readEvents(victim.runDir).filter((e) => e.type === 'workflow.finished').length, 1);
});

test('a run killed at a gate asks the gate again and waits for the owner; Resume from step is refused while it runs and works once it ended', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);
  const kept = crash(ws, victim.runDir, indexOf(readEvents(victim.runDir), (e) => e.type === 'approval.requested'));

  const b = boot(sc, { autoApprove: false });
  await waitFor(() => b.events.some((e) => e.type === 'approval.requested' && e.run_id === victim.runId), 'the gate to be asked again');
  const asked = b.events.find((e) => e.type === 'approval.requested' && e.run_id === victim.runId);
  assert.equal(asked.step_id, 'approve');
  assert.ok(b.api['runs:active']().some((r) => r.runId === victim.runId), 'the recovered run is live, with its own id');

  await sleep(500);
  assert.equal(readEvents(victim.runDir).slice(kept).some((e) => e.type === 'approval.resolved'), false, 'the recovery never answers the gate');
  assert.throws(() => b.api['runs:resume']({ runId: victim.runId, step: 'plan' }), /still active/);

  b.api['approval:resolve']({ runId: victim.runId, id: asked.approval_id, answer: true });
  await waitFor(() => fs.existsSync(path.join(victim.runDir, 'summary.json')), 'the recovered run to end');
  await untilIdle(b.service);
  const summary = readSummary(victim.runDir);
  assert.equal(summary.status, 'success');
  assert.deepEqual(visits(summary), { plan: 1, approve: 1, work: 1 });

  const { runId } = await b.api['runs:resume']({ runId: victim.runId, step: 'plan' });
  assert.notEqual(runId, victim.runId, 'Resume from step still starts a new run');
  // the resumed run meets the gate again: only the owner answers it (#112)
  await waitFor(() => b.events.some((e) => e.type === 'approval.requested' && e.run_id === runId), 'the resumed run\'s gate');
  const gate = b.events.find((e) => e.type === 'approval.requested' && e.run_id === runId);
  b.api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await waitFor(() => b.events.some((e) => e.type === 'workflow.finished' && e.run_id === runId), 'the resumed run to end');
});

test('a run killed during a turn records the lost turn as a stopped attempt with its cost, and the next turn gets a <previous_attempt> block', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);
  const before = readEvents(victim.runDir);
  const answered = indexOf(before, (e) => e.type === 'session.message_received' && e.step_id === 'work');
  const kept = crash(ws, victim.runDir, answered - 1);

  boot(sc);
  await waitFor(() => fs.existsSync(path.join(victim.runDir, 'summary.json')), 'the recovered run to end');

  const after = readEvents(victim.runDir).slice(kept);
  const stopped = after.filter((e) => e.type === 'session.attempt_stopped');
  assert.equal(stopped.length, 1, 'the turn cut by the crash is recorded once');
  assert.equal(stopped[0].step_id, 'work');
  assert.ok(Object.hasOwn(stopped[0], 'cost_usd'), 'the stopped attempt carries its cost (or says it was not recorded)');
  const next = after.find((e) => e.type === 'session.message_sent' && e.step_id === 'work');
  assert.ok(next, 'the step that was cut runs its turn again');
  assert.match(next.prompt, /<previous_attempt>/);

  const summary = readSummary(victim.runDir);
  assert.equal(summary.status, 'success');
  assert.deepEqual(visits(summary), { plan: 1, approve: 1, work: 1 });
});

test('simulation-only never recovers a real run: it stays interrupted, untouched', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);
  const before = readEvents(victim.runDir);
  crash(ws, victim.runDir, indexOf(before, (e) => e.type === 'step.finished' && e.step_id === 'plan'), { mock: false });
  const log = fs.readFileSync(path.join(victim.runDir, 'events.jsonl'), 'utf8');

  const b = boot(sc);
  await sleep(1500);
  assert.equal(b.api['runs:active']().some((r) => r.runId === victim.runId), false);
  assert.equal(fs.readFileSync(path.join(victim.runDir, 'events.jsonl'), 'utf8'), log, 'nothing was appended to the real run');
  const row = (await b.api['runs:list']()).runs.find((r) => r.runId === victim.runId);
  assert.equal(row.status, 'interrupted');
});

test('a run another live app still owns is never taken over (#112)', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);
  const before = readEvents(victim.runDir);
  const now = new Date().toISOString();
  crash(ws, victim.runDir, indexOf(before, (e) => e.type === 'step.finished' && e.step_id === 'plan'), {
    owner: { pid: process.ppid, host: os.hostname(), started_at: now, heartbeat_at: now },
  });
  const log = fs.readFileSync(path.join(victim.runDir, 'events.jsonl'), 'utf8');

  const b = boot(sc);
  await sleep(1500);
  assert.equal(b.api['runs:active']().some((r) => r.runId === victim.runId), false, 'not a second copy');
  assert.equal(fs.readFileSync(path.join(victim.runDir, 'events.jsonl'), 'utf8'), log);
});

test('a run recovered by one process is not recovered again by another started on the same workspace', async (t) => {
  const sc = scratch(t);
  const a = boot(sc);
  const victim = await runToEnd(a);
  const ws = a.service.workspace();
  shutdown(a);
  const kept = crash(ws, victim.runDir, indexOf(readEvents(victim.runDir), (e) => e.type === 'approval.requested'));

  const b = boot(sc, { autoApprove: false });
  await waitFor(() => b.events.some((e) => e.type === 'approval.requested' && e.run_id === victim.runId), 'the first recovery');
  // seen from another process: the owner is the recovering one, alive, with a fresh heartbeat
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(victim.runDir, 'owner.json'), JSON.stringify({ pid: process.ppid, host: os.hostname(), started_at: now, heartbeat_at: now }));

  const c = boot(sc, { autoApprove: false });
  await sleep(1500);
  assert.equal(c.api['runs:active']().some((r) => r.runId === victim.runId), false, 'the second process leaves it alone');
  const asks = readEvents(victim.runDir).slice(kept).filter((e) => e.type === 'approval.requested');
  assert.equal(asks.length, 1, 'the gate is asked again once, by the first recovery only');

  const asked = b.events.find((e) => e.type === 'approval.requested' && e.run_id === victim.runId);
  b.api['approval:resolve']({ runId: victim.runId, id: asked.approval_id, answer: true });
  await waitFor(() => fs.existsSync(path.join(victim.runDir, 'summary.json')), 'the recovered run to end');
});
