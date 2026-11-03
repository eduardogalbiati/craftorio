const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { createService } = require('../../service');
const {
  ISSUE_WORKFLOW, WORKFLOW, makeService, until, untilTrue, watchRuns,
} = require('./helpers');

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
  assert.equal((await api['runs:list']()).runs[0].runId, runId);
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
  const host = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false } });
  host.setWorkspace(service.workspace());
  await assert.rejects(host.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /Simulation only .*refusing to start a real run/);
  assert.throws(() => host.api['term:open']({ kind: 'cli-new', provider: 'claude' }), /Simulation only .*claude CLI/);
  assert.equal(host.isRunning(), false);
  assert.deepEqual((await api['runs:list']()).runs, []);
  assert.equal(api['app:info']().simulationOnly, true);
  // shares the index with `service`'s workspace: close it here, before makeService's own
  // teardown (registered earlier) removes the workspace folder.
  host.shutdown();
});

// #315: the account only counts users; no account state ever blocks a run. A host that still
// passes the retired account hook (one that would refuse everything) is never consulted.
test('#315: no account state blocks a run: a host account hook that refuses is never consulted', async (t) => {
  const { service } = makeService(t);
  const asked = [];
  const host = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); throw new Error('Sign in to start runs.'); } } });
  host.setWorkspace(service.workspace());
  // shares the index with `service`'s workspace: closed here, before makeService's own teardown
  // (registered earlier) removes the workspace folder.
  try {
    const { runId } = await host.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
    await finishPendingRun(host.api, runId);
    assert.deepEqual(asked, []);
  } finally {
    host.shutdown();
  }
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
  assert.equal((await api['runs:list']()).runs.find((r) => r.runId === second.runId).status, 'running');

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

// #175: a `type: workflow` step's child run takes a slot of Settings > Execution like any run, but
// its idle parent (which only waits for it) lends it its own, so a limit of one never deadlocks.
test('concurrent runs: a `type: workflow` step\'s child run takes a slot its idle parent lends it, even with the default limit of one', async (t) => {
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

// #175: children started together (a foreach step) wait for a slot instead of failing; the slot is
// reserved in the same tick as the check that lets a child through, so two children that call
// run:start at nearly the same time never both pass the check before either one reserves.
test('concurrent runs: a limit of 1 runs a foreach step\'s children one at a time, even started in the same tick', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } });
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-foreach.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent-foreach
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: fixture-service.yaml
    foreach: [1, 2, 3]
    max_parallel: 3
`);
  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent-foreach.yaml', inputs: {}, mock: true });

  let peakChildren = 0;
  const resolved = new Set();
  while (!finished.has(parentId)) {
    const kids = api['runs:active']().filter((r) => r.runId !== parentId);
    peakChildren = Math.max(peakChildren, kids.length);
    for (const k of kids) {
      if (gates.has(k.runId) && !resolved.has(k.runId)) {
        resolved.add(k.runId);
        api['approval:resolve']({ runId: k.runId, id: gates.get(k.runId), answer: true });
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(peakChildren, 1, 'at most one child was active at a time');
  assert.equal(resolved.size, 3, 'all three children ran, one at a time, before the parent finished');
  assert.equal(finished.get(parentId), 'success');
});

// #175: stopping the parent while a child waits for a free slot cancels that wait (never starts the
// child) and leaves no stale reservation behind.
test('concurrent runs: stopping the parent while a child waits for a slot cancels it, without leaving a stale reservation', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } });
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-foreach2.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent-foreach2
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: fixture-service.yaml
    foreach: [1, 2]
    max_parallel: 2
`);
  const childFinished = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.child_finished') childFinished.push(ev); });
  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent-foreach2.yaml', inputs: {}, mock: true });

  // the first child takes the parent's lent slot and reaches its gate; the second has none free and waits
  await until(() => gates.size === 1);
  await until(() => api['runs:active']().length === 2); // parent + the one child that got the slot

  api['run:stop']({ runId: parentId });
  await until(() => finished.has(parentId));
  await until(() => childFinished.length === 2);
  const cancelledChild = childFinished.find((e) => e.child_run_id == null); // never got a run: it was still waiting
  assert.ok(cancelledChild, 'the waiting child is reported cancelled, never started');
  assert.match(cancelledChild.error, /Cancelled: the parent run was stopped before this child run could start\./);
  assert.equal(service.isRunning(), false, 'no stale reservation or active run is left behind');
});

// #175: a per-project limit serializes a parent's children (the parent lends its own slot like the
// global limit does), and a plain run of the same project (not a child) is still refused at once,
// never made to wait.
test('concurrent runs: a project\'s limit serializes its parent\'s children; an unrelated run of the same project is refused at once', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 5, perProject: 1, countSimulations: true } });
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-proj.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent-proj
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: fixture-service.yaml
    foreach: [1, 2]
    max_parallel: 2
`);
  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent-proj.yaml', inputs: {}, mock: true, projectId: 'proj-1' });

  // only one child of the project-bound parent runs at a time, even though the global limit (5) is not reached
  await until(() => gates.size === 1);
  await until(() => api['runs:active']().filter((r) => r.runId !== parentId).length === 1);

  // a plain run of the same project, not a child: refused at once (never made to wait)
  await assert.rejects(
    api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true, projectId: 'proj-1' }),
    /1 of 1 runs of this project in progress/,
  );

  // resolving the first child frees the project's slot for the second
  const [firstChild] = api['runs:active']().filter((r) => r.runId !== parentId);
  api['approval:resolve']({ runId: firstChild.runId, id: gates.get(firstChild.runId), answer: true });
  await until(() => gates.size === 2);
  const [secondChild] = api['runs:active']().filter((r) => r.runId !== parentId && r.runId !== firstChild.runId);
  assert.ok(secondChild, 'the second child started only once the first one freed the project slot');
  api['approval:resolve']({ runId: secondChild.runId, id: gates.get(secondChild.runId), answer: true });
  await until(() => finished.has(parentId));
  assert.equal(finished.get(parentId), 'success');
});

// #175: a child inherits its parent's project when the parent has one; when the parent has none, the
// child's own project (from its inputs) is only known once it starts, so it waits again for a slot
// of that project if the first (project-less) reservation turns out to be the wrong one.
test('concurrent runs: a child whose project is only known after it starts waits again for a slot of that project', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-proj-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'demo', folder });
  api['settings:set']({ concurrentRuns: { enabled: true, max: 5, perProject: 1, countSimulations: true } });

  // this run alone fills the project's slot
  const busy = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true, projectId: project.id });
  await until(() => gates.has(busy.runId));

  // the parent itself has no project; its child's repo_path points at the project's folder, so the
  // project is only discovered once the child's own inputs are read
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-late-project.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-parent-late-project
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: fixture-issue.yaml
    inputs: { task: "do it", repo_path: ${JSON.stringify(folder)} }
`);
  const waiting = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'log' && /waits for a free slot/.test(ev.message || '')) waiting.push(ev); });
  const { runId: parentId } = await api['run:start']({ file: 'fixture-parent-late-project.yaml', inputs: {}, mock: true });

  await until(() => waiting.length > 0); // the child discovered the project and is waiting for its slot
  assert.equal(api['runs:active']().filter((r) => r.runId !== parentId && r.runId !== busy.runId).length, 0, 'the child has not started yet');

  // freeing the busy run's project slot lets the child proceed
  api['run:stop']({ runId: busy.runId });
  await until(() => api['runs:active']().some((r) => r.runId !== parentId && r.runId !== busy.runId));
  const [child] = api['runs:active']().filter((r) => r.runId !== parentId && r.runId !== busy.runId);
  await until(() => gates.has(child.runId));
  api['approval:resolve']({ runId: child.runId, id: gates.get(child.runId), answer: true });
  await until(() => finished.has(parentId));
  assert.equal(finished.get(parentId), 'success');
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
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  // repo_path is a git URL already cloned into <workspace>/repos (a repository with no remote): the
  // start only fetches it, a real git process that keeps the start reserved for a moment
  const url = 'https://example.invalid/octo/demo.git';
  const local = path.join(ws.repos, 'octo-demo');
  fs.mkdirSync(local, { recursive: true });
  execFileSync('git', ['init', '-q', local], { stdio: 'ignore' });
  const starting = api['run:start']({ file: 'fixture-issue.yaml', inputs: { task: 'do it', repo_path: url }, mock: true });
  assert.throws(() => service.prepareRestart({ interruptRuns: true }), /starting/);
  const { runId } = await starting;
  await finishPendingRun(api, runId);
});

test('prepareRestart refuses with active runs unless confirmed', async (t) => {
  const { service, api } = makeService(t);
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.prepareRestart(), /1 run is in progress.*confirm the restart/s);

  const result = service.prepareRestart({ interruptRuns: true });
  assert.deepEqual(result, { interrupted: [{ runId, workflow: 'fixture-service' }] });
  await finishPendingRun(api, runId);
});

test('prepareRestart with no runs in progress needs no confirmation', (t) => {
  const { service } = makeService(t);
  assert.deepEqual(service.prepareRestart(), { interrupted: [] });
});

// ---- Backlog issue enrichment: run:start records the issue, backlog:save-doc saves to it (#103) --

test('run:start forwards projectId and issues (sanitized), recorded in the run and shown by runs:list', async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-enrich-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const { runId } = await api['run:start']({
    // #648: Enrich is a write-doc run on the issue's spec (writer-reviewer is its alias)
    file: 'write-doc.yaml', inputs: { project_path: folder, item: 'issue-29-backlog-screen', document: 'spec', prompt: 'Enrich #29' }, mock: true, projectId: p.id,
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

  const seenByB = (await b.api['runs:list']()).runs.find((r) => r.runId === runId);
  assert.equal(seenByB.status, 'running');
  assert.deepEqual(seenByB.runningElsewhere, { pid: process.ppid, host: owner.host });
  assert.deepEqual(b.api['runs:active'](), [], 'b never started or tracks this run itself');

  // a roadmap item that names a's live run: b's advance must never fail it as "interrupted", or start a twin
  const roadmapModel = require('../../domains/roadmap/roadmap');
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
