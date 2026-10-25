// #368 acceptance: pause a run or a stage after the current agent turn, and resume from that point.
// Whole simulated runs (mock provider, scratch workspace, tiny inline workflows). Written before the
// code; the cheap part (roadmap model, night watch, labels, worktree cleanup) is in
// test/pause-after-turn-368.test.js.
//
// The seam these tests pin down (the developer implements against it):
// - Engine: WorkflowRun#pause() next to stop(): no new agent turn, step command or child run starts
//   after it; the turns (every agent of a parallel step) and the step command in progress finish,
//   never cut. Emits `run.pausing` { step_id, agents?, command? } at once; the run then ends with
//   `workflow.finished` status 'paused' (summary.json status 'paused'). A run waiting at a human gate
//   ends paused at once, the gate unanswered. WorkflowRun#cancelPause() takes it back while pausing
//   (`run.pause_cancelled`): the run goes on.
// - Service channels (src/service/channels/runs.js, next to run:stop): `run:pause` { runId } and
//   `run:cancel-pause` { runId }. runs:active gives a pausing run `pause: { state: 'pausing', step,
//   agents?, command? }`. runs:list rows of a paused run have status 'paused'.
// - `runs:resume` { runId } without a step, on a paused run: continues where it paused (the step
//   after the last finished turn; the gate it waited at is asked again), also from a new service on
//   the same workspace (an app restart). No finished turn runs again.
// - Roadmap: `roadmap:pause-stage` { projectId, stageId } pauses every run of the stage and the
//   roadmap (state 'paused', pausedStage, pausedBy null, items 'paused'); `roadmap:start` (Resume)
//   resumes the stage's paused runs where they paused.
// Each wait has a deadline, so a missing behaviour fails its test instead of hanging the file.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const { createService } = require('../../src/service');
const { WorkflowRun } = require('../../src/engine/workflow');
const machineActions = require('../../src/engine/machine-actions');
const {
  ISSUE_WORKFLOW, makeService, roadmapProject, until,
} = require('../service/helpers');

const PARALLEL_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pause-parallel
agents:
  a: { provider: claude, model: m, session: ephemeral }
  b: { provider: claude, model: m, session: ephemeral }
steps:
  - id: review
    agents: [a, b]
    prompt: "review the work"
  - id: after
    agent: a
    prompt: "go on"
`;

const TWO_STEPS_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pause-two-steps
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: plan
    agent: a
    prompt: "plan the work"
  - id: work
    agent: a
    prompt: "do the work"
`;

const SUITE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pause-suite
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: suite
    type: suite
    command: "npm test"
  - id: after
    agent: a
    prompt: "go on"
`;

const DEADLINE_MS = 20000;

// Every pushed run event, in order.
function record(service) {
  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  return events;
}

// The first pushed event matching `pred` (seen from now on), or a rejection naming `what` at the deadline.
function waitFor(service, pred, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.events.off('run:event', on); reject(new Error(`timed out waiting for ${what}`)); }, DEADLINE_MS);
    function on(ev) {
      if (!pred(ev)) return;
      clearTimeout(timer);
      service.events.off('run:event', on);
      resolve(ev);
    }
    service.events.on('run:event', on);
  });
}

// How a run ended: its workflow.finished, or the first gate it opened instead (a pause not taken).
const endOrGate = (service, runId) => waitFor(service, (e) => e.run_id === runId && (e.type === 'workflow.finished' || e.type === 'approval.requested'), `run ${runId} to end`);
const finishedOf = (service, runId) => waitFor(service, (e) => e.run_id === runId && e.type === 'workflow.finished', `run ${runId} to finish`);

// Calls `run:pause` once `turns` turns of `stepId` are in progress (their tool call started), and
// keeps what runs:active said right after; a missing channel is kept as the error (never thrown
// into the engine's event loop).
function pauseDuringTurns(service, api, stepId, turns = 1, channel = 'run:pause') {
  const stepOf = new Map(); // session id -> step id of its last message
  const out = { error: null, active: null, called: false };
  let seen = 0;
  service.events.on('run:event', (ev) => {
    if (ev.type === 'session.message_sent') stepOf.set(ev.session_id, ev.step_id);
    if (out.called || ev.type !== 'session.stream' || ev.item?.kind !== 'tool_call' || stepOf.get(ev.session_id) !== stepId) return;
    if (++seen < turns) return;
    out.called = true;
    try {
      api[channel]({ runId: ev.run_id });
      out.active = api['runs:active']().find((r) => r.runId === ev.run_id) || null;
    } catch (e) { out.error = e; }
  });
  return out;
}

const turnsOf = (events, runId, stepId) => events.filter((e) => e.run_id === runId && e.type === 'session.message_received' && e.step_id === stepId);
const started = (events, runId, stepId) => events.some((e) => e.run_id === runId && e.type === 'step.started' && e.step_id === stepId);
const stepsOf = (summary) => Object.fromEntries(Object.entries(summary.steps).map(([id, s]) => [id, JSON.stringify({ visits: s.visits, output: s.output })]));

// ---- A run paused during a single agent's turn -----------------------------------------------

test('pause during a single-agent step: the turn finishes once, no next step starts, the run ends paused', async (t) => {
  const { service, api } = makeService(t);
  const events = record(service);
  const pause = pauseDuringTurns(service, api, 'work');
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true, mockSequences: { slow_tools: { work: 400 } } });
  const end = await endOrGate(service, runId);
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(end.type, 'workflow.finished');
  assert.equal(end.status, 'paused');
  assert.equal(turnsOf(events, runId, 'work').length, 1);
  assert.equal(started(events, runId, 'review'), false);
});

test('while pausing, runs:active says which step it waits for; once paused, the run list says paused', async (t) => {
  const { service, api } = makeService(t);
  const pause = pauseDuringTurns(service, api, 'work');
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true, mockSequences: { slow_tools: { work: 400 } } });
  await endOrGate(service, runId);
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(pause.active?.pause?.state, 'pausing');
  assert.equal(pause.active?.pause?.step, 'work');
  const row = (await api['runs:list']()).runs.find((r) => r.runId === runId);
  assert.equal(row.status, 'paused');
});

test('Cancel pause while pausing: the run goes on to its next step', async (t) => {
  const { service, api } = makeService(t);
  const pause = pauseDuringTurns(service, api, 'work');
  const cancel = pauseDuringTurns(service, api, 'work', 1, 'run:cancel-pause');
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true, mockSequences: { slow_tools: { work: 400 } } });
  const end = await endOrGate(service, runId);
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(cancel.error, null, cancel.error?.message);
  assert.equal(end.type, 'approval.requested');
  assert.equal(end.step_id, 'review');
});

// ---- A parallel step: every agent finishes its turn -------------------------------------------

test('pause during a parallel step: both agents finish their turn, each once, and the run ends paused before the next step', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pause-parallel.yaml'), PARALLEL_WORKFLOW);
  const events = record(service);
  const pause = pauseDuringTurns(service, api, 'review', 2);
  const { runId } = await api['run:start']({ file: 'fixture-pause-parallel.yaml', inputs: {}, mock: true, mockSequences: { slow_tools: { review: 400 } } });
  const end = await endOrGate(service, runId);
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(end.status, 'paused');
  assert.deepEqual(turnsOf(events, runId, 'review').map((e) => e.session.agent).sort(), ['a', 'b']);
  assert.equal(started(events, runId, 'after'), false);
});

// ---- A run waiting at a human gate ------------------------------------------------------------

test('pause at a human gate: the run ends paused at once, the gate unanswered; Resume asks the same gate again and redoes no turn', async (t) => {
  const { service, api } = makeService(t);
  const events = record(service);
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const gate = await waitFor(service, (e) => e.run_id === runId && e.type === 'approval.requested', 'the gate');
  assert.equal(gate.step_id, 'review');
  api['run:pause']({ runId });
  const end = await finishedOf(service, runId);
  assert.equal(end.status, 'paused');
  assert.equal(events.some((e) => e.run_id === runId && e.type === 'approval.resolved'), false);

  const resumed = await api['runs:resume']({ runId });
  const again = await waitFor(service, (e) => e.run_id === resumed.runId && e.type === 'approval.requested', 'the gate asked again');
  assert.equal(again.step_id, 'review');
  assert.equal(turnsOf(events, resumed.runId, 'work').length, 0);
});

// ---- Resume after an app restart --------------------------------------------------------------

// A service on `dir` (a workspace that outlives it: the app closed and opened again).
function serviceOn(dir) {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  return service;
}

test('resume after a restart: the paused run ends with the same step outputs as an uninterrupted run, and no turn runs twice', async (t) => {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-368-ws-'));
  const open = new Set(); // the services not shut down yet
  t.after(async () => {
    for (const s of open) {
      for (const r of s.api['runs:active']()) { try { s.api['run:stop']({ runId: r.runId }); } catch { /* ended */ } }
      await until(() => s.api['runs:active']().length === 0);
      s.shutdown();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const first = serviceOn(dir);
  open.add(first);
  fs.writeFileSync(path.join(first.workspace().workflows, 'fixture-pause-two-steps.yaml'), TWO_STEPS_WORKFLOW);

  const plain = await first.api['run:start']({ file: 'fixture-pause-two-steps.yaml', inputs: {}, mock: true });
  const plainEnd = await finishedOf(first, plain.runId);
  assert.equal(plainEnd.status, 'success');

  const pause = pauseDuringTurns(first, first.api, 'plan');
  const paused = await first.api['run:start']({ file: 'fixture-pause-two-steps.yaml', inputs: {}, mock: true, mockSequences: { slow_tools: { plan: 400 } } });
  const pausedEnd = await finishedOf(first, paused.runId);
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(pausedEnd.status, 'paused');
  open.delete(first);
  first.shutdown();

  const second = serviceOn(dir);
  open.add(second);
  const events = record(second);
  const resumed = await second.api['runs:resume']({ runId: paused.runId });
  const end = await finishedOf(second, resumed.runId);
  assert.equal(end.status, 'success', end.error);
  assert.deepEqual(stepsOf(end.summary), stepsOf(plainEnd.summary));
  assert.equal(turnsOf(events, resumed.runId, 'plan').length, 0);
  assert.equal(turnsOf(events, resumed.runId, 'work').length, 1);
});

// ---- A step command in progress ---------------------------------------------------------------

test('pause during the suite command: the command is not killed and runs to its end, no agent turn starts after it', async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-368-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const file = path.join(runsDir, 'fixture-pause-suite.yaml');
  fs.writeFileSync(file, SUITE_WORKFLOW);
  const base = machineActions.simulated({});
  const suite = { calls: 0, aborted: false, finished: false, error: null };
  let run = null;
  const machine = {
    ...base,
    // the suite's command: still running when the pause comes, it ends 150 ms later
    runSuite: (opts) => new Promise((resolve) => {
      suite.calls++;
      opts.signal?.addEventListener('abort', () => { suite.aborted = true; });
      setImmediate(() => {
        try { run.pause(); } catch (e) { suite.error = e; }
        setTimeout(() => { suite.finished = true; resolve(base.runSuite(opts)); }, 150);
      });
    }),
  };
  run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [], machine });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const end = events.find((e) => e.type === 'workflow.finished');
  assert.equal(suite.error, null, suite.error?.message);
  assert.equal(end.status, 'paused');
  assert.equal(suite.calls, 1);
  assert.equal(suite.aborted, false);
  assert.equal(suite.finished, true);
  assert.equal(events.find((e) => e.type === 'run.pausing')?.command, 'npm test');
  assert.equal(events.find((e) => e.type === 'step.finished' && e.step_id === 'suite')?.output?.status, 'pass');
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'after'), false);
});

// ---- A stage with two runs --------------------------------------------------------------------

// A roadmap whose one stage has two items, both runs waiting at their gate; resolves once
// roadmap:pause-stage ended them.
async function pauseStageWithTwoRuns(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'pause-stage');
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });
  const events = record(service);
  const gates = () => events.filter((e) => e.type === 'approval.requested');
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }, { workflow: 'fixture-issue.yaml', number: 2, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => gates().length === 2);
  const runIds = gates().map((e) => e.run_id).sort();
  const stageId = api['roadmap:get']({ projectId: p.id }).stages[0].id;
  await api['roadmap:pause-stage']({ projectId: p.id, stageId });
  await until(() => events.filter((e) => e.type === 'workflow.finished').length === 2);
  return { service, api, events, p, stageId, runIds };
}

test('pause a stage with two runs: both runs end paused, gates unanswered, and the roadmap shows the stage paused, not failed', async (t) => {
  const { api, events, p, stageId } = await pauseStageWithTwoRuns(t);
  assert.deepEqual(events.filter((e) => e.type === 'workflow.finished').map((e) => e.status), ['paused', 'paused']);
  assert.equal(events.some((e) => e.type === 'approval.resolved'), false);
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'paused');
  assert.equal(roadmap.pausedStage, stageId);
  assert.equal(roadmap.pausedBy, null);
  assert.deepEqual(roadmap.stages[0].items.map((x) => x.status), ['paused', 'paused']);
});

test('Resume on a roadmap paused at a stage resumes both runs at the gate they waited at', async (t) => {
  const { service, api, events, p, runIds } = await pauseStageWithTwoRuns(t);
  const before = events.length;
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => events.slice(before).filter((e) => e.type === 'approval.requested').length === 2);
  const resumed = events.slice(before).filter((e) => e.type === 'workflow.started');
  assert.deepEqual(resumed.map((e) => e.resumed_from?.run_id).sort(), runIds);
  assert.deepEqual(events.slice(before).filter((e) => e.type === 'approval.requested').map((e) => e.step_id), ['review', 'review']);
  assert.equal(events.slice(before).some((e) => e.type === 'session.message_received'), false);
  assert.equal(service.isRunning(), true);
});
