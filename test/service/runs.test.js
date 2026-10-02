const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../src/workspace');
const { createService } = require('../../src/service');
const backlog = require('../../src/backlog');
const { WORKFLOW, makeService, until, untilTrue, watchRuns } = require('./helpers');

test('runs a mock workflow, pushes its events and resolves the human gate', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev.type);
      // the engine registers the approval right after emitting the request
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') resolve(ev);
    });
  });
  const { runId, runDir } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.ok(service.isRunning());
  assert.equal(service.runDir(), runDir);
  assert.deepEqual(api['runs:active']().map((r) => r.runId), [runId]);
  await assert.rejects(api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }), /already running/);

  const end = await finished;
  assert.equal(end.status, 'success');
  assert.ok(events.includes('step.finished') && events.includes('approval.resolved'));
  assert.ok(fs.existsSync(path.join(runDir, 'events.jsonl')));
  assert.equal(api['runs:list']().runs[0].runId, runId);
});

// #75: a run parked at a human gate is never only known from the events a client happened to see
// live; runs:active is the source of truth, so a reloaded window (or one that opened after the gate
// was requested) rebuilds it from a fresh read.
test('runs:active lists the gates a run waits at, for a client that saw none of the events live', async (t) => {
  const { api } = makeService(t);

  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await untilTrue(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));

  // a fresh client (e.g. a reloaded window): everything it knows about the gate comes from this call
  const active = api['runs:active']().find((r) => r.runId === runId);
  assert.equal(active.waiting, 1);
  assert.equal(active.gates.length, 1);
  const [gate] = active.gates;
  assert.equal(gate.step_id, 'review');
  assert.equal(gate.message, 'Accept the work?');
  assert.equal(gate.choices, null);
  assert.ok(gate.approval_id);
  assert.ok(gate.requested_at);

  assert.equal(api['approval:resolve']({ runId, id: gate.approval_id, answer: true }), true);
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
});

test('with simulation only, real runs and CLI terminals are refused', async (t) => {
  const { service, api } = makeService(t);
  const asked = [];
  const host = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); } } });
  host.setWorkspace(service.workspace());
  await assert.rejects(host.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /Simulation only .*refusing to start a real run/);
  assert.throws(() => host.api['term:open']({ kind: 'cli-new', provider: 'claude' }), /Simulation only .*claude CLI/);
  assert.deepEqual(asked, []); // refused before the account check: nothing real was attempted
  assert.equal(host.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
  assert.equal(api['app:info']().simulationOnly, true);
  // shares the index with `service`'s workspace: close it here, before makeService's own
  // teardown (registered earlier) removes the workspace folder.
  host.shutdown();
});

test('a run starts only if the host allows it (account / free trial)', async (t) => {
  const { service, api } = makeService(t);
  // the account check comes after the simulation-only guard: lift it for this real-run request
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  const asked = [];
  const blocked = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); throw new Error('Your 7-day free trial has ended.'); } } });
  blocked.setWorkspace(service.workspace());
  await assert.rejects(blocked.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /trial has ended/);
  assert.deepEqual(asked, [{ mock: false }]);
  assert.equal(blocked.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
  // shares the index with `service`'s workspace: close it here, before makeService's own
  // teardown (registered earlier) removes the workspace folder.
  blocked.shutdown();
});

test('concurrent runs: each run resolves its own gates, stop affects only its run, the limit refuses one more', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  const start = () => api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });

  // off by default: one run at a time
  const first = await start();
  await assert.rejects(start(), /already running/);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });
  const second = await start();
  await assert.rejects(start(), /2 of 2 runs in progress/);
  assert.deepEqual(api['runs:active']().map((r) => r.runId).sort(), [first.runId, second.runId].sort());
  assert.throws(() => service.setWorkspace(service.workspace()), /while workflows are running/);

  await until(() => gates.size === 2);
  // both runs wait on a gate with the same id: without the run it is ambiguous
  assert.equal(gates.get(first.runId), gates.get(second.runId));
  assert.equal(api['approval:resolve']({ id: gates.get(first.runId), answer: true }), false);
  assert.throws(() => api['run:stop']({}), /say which one/);

  assert.equal(api['approval:resolve']({ runId: first.runId, id: gates.get(first.runId), answer: true }), true);
  await until(() => finished.has(first.runId));
  assert.equal(finished.get(first.runId), 'success');
  assert.ok(!finished.has(second.runId));
  assert.equal(api['runs:list']().runs.find((r) => r.runId === second.runId).status, 'running');

  // a slot is free again
  const third = await start();
  assert.equal(api['run:stop']({ runId: second.runId }), true);
  await until(() => finished.has(second.runId));
  assert.equal(finished.get(second.runId), 'cancelled');
  assert.ok(!finished.has(third.runId));
  assert.deepEqual(api['runs:active']().map((r) => r.runId), [third.runId]);
  api['run:stop']({ runId: third.runId });
  await until(() => !service.isRunning());
});

test('concurrent runs: simulations do not count unless the setting says so', async (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: false } });
  const a = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const b = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.equal(api['runs:active']().length, 2);
  api['run:stop']({ runId: a.runId });
  api['run:stop']({ runId: b.runId });
  await until(() => !service.isRunning());
});

// #174: a `type: workflow` step's child run ignores Settings > Execution entirely, even the
// default of one run at a time (its parent holds that slot and waits for the child, so counting
// the child too would deadlock every such workflow forever).
test('concurrent runs: a `type: workflow` step\'s child run takes no execution slot, even with the default limit of one', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: fixture-service.yaml
`);
  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent.yaml', inputs: {}, mock: true });
  // a plain second run is still refused: the default limit of one is still in force for normal runs
  await assert.rejects(api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }), /already running/);
  // yet the child reaches its own gate: starting it never hit the same limit as the rejected run above
  await until(() => api['runs:active']().length === 2);
  const [childInfo] = api['runs:active']().filter((r) => r.runId !== parentId);
  assert.ok(childInfo, 'the child shows up in runs:active next to its parent');

  await until(() => gates.has(childInfo.runId));
  assert.equal(api['approval:resolve']({ runId: childInfo.runId, id: gates.get(childInfo.runId), answer: true }), true);
  await until(() => finished.has(parentId));
  assert.equal(finished.get(parentId), 'success');
  assert.equal(finished.get(childInfo.runId), 'success');
});

// Resolves the fixture workflow's human gate and waits for the run to leave runs:active, so no
// mock step keeps writing to the workspace after the test (and its t.after cleanup) is done.
async function finishPendingRun(api, runId) {
  await untilTrue(() => (api['runs:active']().find((r) => r.runId === runId)?.gates || []).length > 0);
  const [gate] = api['runs:active']().find((r) => r.runId === runId).gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
}

test('prepareRestart refuses while a run start is still reserved (e.g. cloning its repository)', async (t) => {
  const { service: base } = makeService(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async () => { await gate; } } });
  service.setWorkspace(base.workspace());
  const starting = service.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.prepareRestart({ interruptRuns: true }), /starting/);
  release();
  const { runId } = await starting;
  await finishPendingRun(service.api, runId);
  // shares the index with `base`'s workspace: close it here, before makeService's own teardown
  // (registered earlier) removes the workspace folder.
  service.shutdown();
});

test('prepareRestart refuses with active runs unless confirmed; once confirmed it pauses the Backlog queues', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-restart-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  backlog.enqueue(ws.backlog, p.id, { issues: [{ number: 1, url: 'u1', title: 'T1', body: 'B1' }], workflow: 'fixture-service.yaml' });

  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.prepareRestart(), /1 run is in progress.*confirm the restart/s);
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, false, 'refused: nothing paused yet');

  const result = service.prepareRestart({ interruptRuns: true });
  assert.deepEqual(result, { interrupted: [{ runId, workflow: 'fixture-service' }] });
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, true);
  await finishPendingRun(api, runId);
});

test('prepareRestart with no runs in progress needs no confirmation and still pauses queued Backlog work', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-restart-idle-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  backlog.enqueue(ws.backlog, p.id, { issues: [{ number: 1, url: 'u1', title: 'T1', body: 'B1' }], workflow: 'fixture-service.yaml' });

  assert.deepEqual(service.prepareRestart(), { interrupted: [] });
  assert.equal(backlog.readQueue(ws.backlog, p.id).paused, true);
});

// ---- Backlog issue enrichment: run:start records the issue, backlog:save-doc saves to it (#103) --

test('run:start forwards projectId and issues (sanitized), recorded in the run and shown by runs:list', async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-enrich-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const { runId } = await api['run:start']({
    file: 'writer-reviewer.yaml', inputs: { prompt: 'Enrich #29', goal: 'g' }, mock: true, projectId: p.id,
    issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen', extra: 'dropped' }],
  });
  const run = api['runs:active']().find((r) => r.runId === runId);
  assert.equal(run.projectId, p.id);
  assert.deepEqual(run.issues, [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'Backlog screen' }]);
  api['run:stop']({ runId });
});

// ---- One app per workspace: a second process never judges or duplicates the first's runs (#112) --

test('two services on one workspace: the second sees the first\'s active run as "running" (never interrupted); its roadmap advance leaves that item alone', async (t) => {
  // hooks run in the order they are added (see makeService above): both services' shutdown must be
  // registered before the dir removal, or the SQLite index they still hold open fails to unlink.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-twoapp-'));
  const a = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  a.setWorkspace(setupWorkspace(dir, { persist: false }));
  const wsA = a.workspace();
  fs.writeFileSync(path.join(wsA.workflows, 'fixture-service.yaml'), WORKFLOW);
  t.after(async () => {
    for (const run of a.api['runs:active']()) { try { a.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ } }
    await untilTrue(() => a.api['runs:active']().length === 0);
    a.shutdown();
  });

  const gateP = new Promise((resolve) => a.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await a.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await gateP; // a's run is now stuck at a gate, still active, owner.json held by this OS process

  // a second app process on the same host writes its own, different (but genuinely alive) pid there
  const ownerFile = path.join(wsA.runs, runId, 'owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, pid: process.ppid }));

  const b = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => b.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  b.setWorkspace(setupWorkspace(dir, { persist: false }));

  const seenByB = b.api['runs:list']().runs.find((r) => r.runId === runId);
  assert.equal(seenByB.status, 'running');
  assert.deepEqual(seenByB.runningElsewhere, { pid: process.ppid, host: owner.host });
  assert.deepEqual(b.api['runs:active'](), [], 'b never started or tracks this run itself');

  // a roadmap item that names a's live run: b's advance must never fail it as "interrupted", or start a twin
  const roadmapModel = require('../../src/roadmap');
  roadmapModel.writeRoadmap(wsA.backlog, 'proj-twoapp', {
    state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null,
    stages: [{
      id: 's1',
      items: [{
        id: 'i1', workflow: 'fixture-service.yaml', workflowName: 'w', inputs: {}, mock: true,
        number: 1, url: 'https://github.com/o/r/issues/1', title: '#1', body: '', knownPullRequests: [],
        status: 'planned', runId, runs: [runId], error: null,
      }],
    }],
  });
  await until(() => b.api['roadmap:get']({ projectId: 'proj-twoapp' }).stages[0].items[0].status === 'running');
  const roadmap = b.api['roadmap:get']({ projectId: 'proj-twoapp' });
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.pausedBy, null);
  assert.deepEqual(b.api['runs:active'](), [], 'advancing the roadmap in b never started a duplicate run');
});
