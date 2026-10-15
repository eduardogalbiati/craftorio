// #395 through the service: the wiring of Move on that the acceptance tests (test/roadmap-park-395.test.js)
// do not reach. The Night watch's minute tick parks a roadmap run waiting at a human gate (with the skip
// permission, after settings.oracle.parkAfterMinutes, nothing else of the roadmap running), logs
// oracle.parked and notifies with the gate's name; a run interrupted at its gate (app closed) can be
// parked through roadmap:item and the roadmap it paused goes on; Undo of roadmap:park-stage.
// The tick runs on a mocked setInterval with a fake ctx (activeRuns, parkItem, notify), the boundary the
// channel module is given by the service; the other tests use the service and its mock runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const actions = require('../../src/oracle-actions');
const night = require('../../src/night-watch');
const roadmaps = require('../../src/roadmap');
const workspace = require('../../src/workspace');
const { ISSUE_WORKFLOW, makeService, roadmapProject, roadmapIssue, until, watchRuns } = require('./helpers');

const MINUTE = 60e3;
const item = (id, status, extra = {}) => ({ id, workflow: 'fixture-issue.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const plan = (stages) => ({ state: 'running', simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null });
const flush = () => new Promise((r) => setImmediate(r));

// ---- the Night watch tick ----------------------------------------------------------------------

// An active run as ctx.activeRuns() gives it (src/service/areas/runs.js): at its gate since `waitedMin`
// minutes, or in a turn (waitedMin null).
function activeRun(runId, waitedMin) {
  const base = { runId, projectId: 'p1', status: 'running', startedAt: new Date(Date.now() - 60 * MINUTE).toISOString(), display: { steps: { review: 'Developer check' } } };
  if (waitedMin == null) return { ...base, waiting: 0, gates: [] };
  return { ...base, waiting: 1, gates: [{ step_id: 'review', approval_id: `a-${runId}`, requested_at: new Date(Date.now() - waitedMin * MINUTE).toISOString() }] };
}

// The channel module with a fake ctx, a Night watch on, the roadmap of project p1 written with `items`
// in its first stage (and a planned item in a second stage). Returns what the tick did.
function watched(t, { items, active, allowed = ['skip'], parkAfterMinutes }) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'park-tick-395-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = workspace.setupWorkspace(root, { persist: false });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.mkdirSync(ws.oracle, { recursive: true });
  workspace.writeSettings(ws, { oracle: { wakeScope: 'off', ...(parkAfterMinutes == null ? {} : { parkAfterMinutes }) } });
  actions.setNightWatch(ws.oracle, { on: true, until: new Date(Date.now() + 8 * 3600e3).toISOString(), by: 'test' });
  fs.writeFileSync(path.join(ws.oracle, 'night-permissions.json'), JSON.stringify({ allowed, updatedAt: new Date().toISOString() }));
  roadmaps.writeRoadmap(ws.backlog, 'p1', plan([{ id: 's1', name: '', note: '', items }, { id: 's2', name: '', note: '', items: [item('i9', 'planned')] }]));
  const parked = [];
  const notes = [];
  const ctx = {
    ws,
    events: new EventEmitter(),
    active: new Map(),
    activeRuns: () => active,
    liveRun: () => null,
    parkItem: async (a) => { parked.push(`${a.projectId}/${a.itemId}`); },
    notify: (n) => { notes.push(n); },
  };
  require('../../src/service/channels/nightwatch')(ctx);
  return {
    parked,
    notes,
    async tick() { t.mock.timers.tick(MINUTE); await flush(); await flush(); },
    log: () => night.readNightLog(ws.oracle).filter((e) => e.type === 'oracle.parked'),
  };
}

test('#395 Night watch tick: a run at its gate past parkAfterMinutes, skip allowed, nothing else running: moved on, logged with the gate name, the owner notified', async (t) => {
  const w = watched(t, { items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })], active: [activeRun('run-1', 20)] });
  await w.tick();
  assert.deepEqual(w.parked, ['p1/i1']);
  const log = w.log();
  assert.deepEqual(log.map((e) => [e.target, e.runId, e.gate]), [['p1/i1', 'run-1', 'Developer check']]);
  assert.equal(w.notes.length, 1);
  assert.match(`${w.notes[0].title} ${w.notes[0].body}`, /Developer check/);
});

test('#395 Night watch tick: the wait is the parkAfterMinutes setting (5 min: parks at 6, not at 4)', async (t) => {
  const early = watched(t, { items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })], active: [activeRun('run-1', 4)], parkAfterMinutes: 5 });
  await early.tick();
  assert.deepEqual([early.parked.length, early.log().length, early.notes.length], [0, 0, 0]);
});

test('#395 Night watch tick: parkAfterMinutes 5 and a gate waiting 6 min: moved on', async (t) => {
  const w = watched(t, { items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })], active: [activeRun('run-1', 6)], parkAfterMinutes: 5 });
  await w.tick();
  assert.deepEqual(w.parked, ['p1/i1']);
});

test('#395 Night watch tick: without the skip permission nothing is moved on, logged or notified', async (t) => {
  const w = watched(t, { items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })], active: [activeRun('run-1', 60)], allowed: ['retry'] });
  await w.tick();
  assert.deepEqual([w.parked.length, w.log().length, w.notes.length], [0, 0, 0]);
});

test('#395 Night watch tick: another run of the roadmap in a turn: the gate run is not moved on', async (t) => {
  const w = watched(t, {
    items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] }), item('i2', 'planned', { runId: 'run-2', runs: ['run-2'] })],
    active: [activeRun('run-1', 60), activeRun('run-2', null)],
  });
  await w.tick();
  assert.deepEqual([w.parked.length, w.log().length, w.notes.length], [0, 0, 0]);
});

test('#395 Night watch tick: an item already parked is not moved on again', async (t) => {
  const w = watched(t, { items: [item('i1', 'parked', { runId: 'run-1', runs: ['run-1'] })], active: [activeRun('run-1', 60)] });
  await w.tick();
  assert.deepEqual(w.parked, []);
});

// ---- a run interrupted at its gate (the app closed) ------------------------------------------------

const INTERRUPTED = '20261015-090000-intgate1';

// The run folder as a closed app leaves it at a human gate: no summary.json, no owner.json.
function writeInterruptedAtGate(runsDir, runId, projectId) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now() - 30 * MINUTE;
  const iso = (ms) => new Date(ms).toISOString();
  const events = [
    { ts: iso(t0), type: 'workflow.started', run_id: runId, workflow: 'fixture-service', file: 'fixture-service.yaml', mock: true, inputs: { task: 'x' }, project_id: projectId, display: { steps: { review: 'Developer check' } } },
    { ts: iso(t0 + 1000), type: 'step.started', step_id: 'review', visit: 1, step_type: 'human_approval' },
    { ts: iso(t0 + 2000), type: 'approval.requested', step_id: 'review', approval_id: 'a1' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

test('#395 roadmap:item park: a run interrupted at its gate can be moved on; the roadmap it paused goes on and the item stays parked', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'park-interrupted');
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  roadmaps.markStarted(ws.backlog, p.id, itemId, { runId: INTERRUPTED });
  writeInterruptedAtGate(ws.runs, INTERRUPTED, p.id);
  roadmaps.writeRoadmap(ws.backlog, p.id, { ...roadmaps.readRoadmap(ws.backlog, p.id), state: 'paused', simulated: true, pausedBy: itemId, error: 'Run interrupted' });

  const before = api['roadmap:get']({ projectId: p.id }).stages[0].items[0];
  assert.equal(typeof before.run?.atGate, 'string', 'the view says which gate the interrupted run waits at');
  await api['roadmap:item']({ projectId: p.id, itemId, action: 'park' });
  const r = api['roadmap:get']({ projectId: p.id });
  assert.equal(r.stages[0].items[0].status, 'parked');
  assert.deepEqual([r.state === 'paused', r.pausedBy ?? null], [false, null]);
});

// ---- Undo of Move on from this stage ---------------------------------------------------------------

test('#395 roadmap:undo of roadmap:park-stage: the item is back at its gate and the skipped item is planned again', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'park-stage-undo');
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } });
  const { gates } = watchRuns(service);
  const it = (number) => ({ workflow: 'fixture-issue.yaml', number, mock: true });
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [it(1), it(2)] }, { items: [it(3)] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const get = () => api['roadmap:get']({ projectId: p.id });
  await until(() => !!get().stages[0].items[0].runId && gates.has(get().stages[0].items[0].runId));
  const run1 = get().stages[0].items[0].runId;

  const out = await api['roadmap:park-stage']({ projectId: p.id, stageId: get().stages[0].id });
  assert.deepEqual(get().stages[0].items.map((x) => x.status), ['parked', 'skipped']);
  await api['roadmap:undo']({ projectId: p.id, editId: out.edit.id });
  const [first, second] = get().stages[0].items;
  assert.deepEqual([first.status, first.runId, gates.has(run1)], ['running', run1, true]);
  assert.notEqual(second.status, 'skipped', 'Undo takes back the whole move, the skip included');
});
