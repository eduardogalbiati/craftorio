// #395 Move on past an item waiting at a human gate: the roadmap goes on, the gate stays the owner's.
// Acceptance tests written before the code (simulation only: the service runs use the fixture workflow,
// one mock agent turn then a human gate that only the TEST answers, as the owner).
//
// Assumed interface (the developer implements it; names chosen to match the existing code):
// - packages/shared/roadmap-model.js: ITEM_STATES gains 'parked' (persisted), isFinished counts it as finished
//   (so stageProgress and currentStage do too). ACTIONS gains 'park' (the item's "Move on") and
//   'parkStage' (the stage menu's "Move on from this stage"); allowedActions answers both as
//   { allowed, reason }. An item at a human gate is the view's `status: 'running'` with `waiting: true`.
//   parkStage is refused while an item of the stage runs a turn or a command (running, not waiting),
//   its reason naming "Pause after current step".
// - packages/engine/domains/roadmap/roadmap.js: itemAction(dir, projectId, itemId, 'park', ...) parks an item whose run waits at a
//   human gate; advance/withStatus keep a parked item 'parked' while its run waits, 'done' when the run
//   later succeeds merged, 'failed' when it ends otherwise, and a parked item that fails later never
//   pauses the roadmap (pausedBy stays null). parkStage(dir, projectId, stageId, { alive, runOf }) is the
//   stage's Move on (runOf as advance's env); it throws the "Pause after current step" reason when an
//   item of the stage has a turn running.
// - Channels: roadmap:item takes action 'park' (and answers `edit`, kept in roadmap:versions like an
//   owner edit, #281); new roadmap:park-stage { projectId, stageId }, named after roadmap:pause-stage.
// - Renderer (views/backlog/backlog-roadmap.js): a card at a gate shows a "Move on" button
//   (data-rm-item="park", so window.api.roadmapItem(projectId, itemId, 'park')); a parked card reads
//   "Parked at ..."; the roadmap bar counts "N parked at a gate".
// - packages/engine/domains/night/night-watch.js: permissionOf('roadmap.item', { action: 'park' }) is 'skip'; the log accepts
//   'oracle.parked'; gateDecision({ waitingSince, now, allowed, othersRunning, settings }) answers
//   'park' | 'escalate' | 'wait' (settings.oracle.parkAfterMinutes, default 15).
// New exports are looked up inside each test so this file loads before they exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const model = () => require('@craftorio/shared/roadmap-model');
const roadmaps = () => require('@craftorio/engine/domains/roadmap/roadmap');
const night = () => require('@craftorio/engine/domains/night/night-watch');

const item = (id, status, extra = {}) => ({ id, workflow: 'software-development.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });
const plan = (state, stages, extra = {}) => ({ state, simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null, ...extra });
const atGate = (id, extra = {}) => item(id, 'running', { runId: `run-${id}`, runs: [`run-${id}`], waiting: true, ...extra });

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-395-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- Roadmap model -------------------------------------------------------------------------------

test('#395 model: parked is an item state and counts as finished for its stage', () => {
  const m = model();
  assert.equal(m.ITEM_STATES.includes('parked'), true);
  assert.equal(m.isFinished({ status: 'parked' }), true);
  const s = stage('s1', [item('i1', 'parked', { runId: 'run-i1' }), item('i2', 'done')]);
  assert.equal(m.stageProgress(s).finished, 2);
  assert.equal(m.currentStage(plan('running', [s, stage('s2', [item('i3', 'planned')])])), 1);
});

test('#395 model: an item whose run waits at a human gate offers Move on (park)', () => {
  const r = plan('running', [stage('s1', [atGate('i1')])]);
  const acts = model().allowedActions(r, r.stages[0], r.stages[0].items[0]);
  assert.equal(acts.park?.allowed, true);
  assert.equal(model().ACTIONS.includes('park'), true);
});

test('#395 model: an item whose run is running a turn (not at a gate) cannot be parked', () => {
  const r = plan('running', [stage('s1', [item('i1', 'running', { runId: 'run-i1' })])]);
  const acts = model().allowedActions(r, r.stages[0], r.stages[0].items[0]);
  assert.equal(acts.park?.allowed, false);
});

test('#395 model: a failed item keeps Retry and Skip as today, and Move on is refused (no gate)', () => {
  const r = plan('paused', [stage('s1', [item('i1', 'failed', { runId: 'run-i1', error: 'Run run-i1 failed' })])], { pausedBy: 'i1' });
  const acts = model().allowedActions(r, r.stages[0], r.stages[0].items[0]);
  assert.deepEqual([acts.retry.allowed, acts.skip.allowed, acts.park?.allowed], [true, true, false]);
});

test('#395 model: "Move on from this stage" is allowed when its items wait at a gate or are planned', () => {
  const r = plan('running', [stage('s1', [atGate('i1'), item('i2', 'planned')])]);
  const acts = model().allowedActions(r, r.stages[0]);
  assert.equal(acts.parkStage?.allowed, true);
  assert.equal(model().ACTIONS.includes('parkStage'), true);
});

test('#395 model: "Move on from this stage" is refused while an item runs a turn, pointing to "Pause after current step"', () => {
  const r = plan('running', [stage('s1', [atGate('i1'), item('i2', 'running', { runId: 'run-i2' })])]);
  const acts = model().allowedActions(r, r.stages[0]);
  assert.equal(acts.parkStage?.allowed, false);
  assert.match(String(acts.parkStage?.reason), /Pause after current step/);
});

// ---- packages/engine/domains/roadmap/roadmap.js: persisted state, sequencing, late answers -----------------------------------

test('#395 parked is persisted: written and read back as parked', (t) => {
  const dir = tmpDir(t);
  roadmaps().writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'parked', { runId: 'run-i1', runs: ['run-i1'] })])]));
  assert.equal(roadmaps().readRoadmap(dir, 'p1').stages[0].items[0].status, 'parked');
});

test('#395 advance: a parked item whose run still waits at its gate stays parked and the next stage starts', () => {
  const r = plan('running', [stage('s1', [item('i1', 'parked', { runId: 'run-i1', runs: ['run-i1'] })]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmaps().advance(r, { runOf: (id) => (id === 'run-i1' ? { status: 'running', waiting: true } : null) });
  assert.equal(step.roadmap.stages[0].items[0].status, 'parked');
  assert.deepEqual(step.start.map((x) => x.id), ['i2']);
  assert.equal(step.roadmap.state, 'running');
});

test('#395 advance: the gate answered later with Continue and the run merged: the parked item is done', () => {
  const r = plan('running', [stage('s1', [item('i1', 'parked', { runId: 'run-i1', runs: ['run-i1'] })]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmaps().advance(r, { runOf: (id) => (id === 'run-i1' ? { status: 'success', merged: true } : null) });
  assert.equal(step.roadmap.stages[0].items[0].status, 'done');
});

test('#395 advance: the parked item\'s run stopped or failed later: the item is failed, and the roadmap is not paused by it', () => {
  const r = plan('running', [
    stage('s1', [item('i1', 'parked', { runId: 'run-i1', runs: ['run-i1'] })]),
    stage('s2', [item('i2', 'planned', { runId: 'run-i2', runs: ['run-i2'] })]),
  ]);
  const runOf = (id) => (id === 'run-i1' ? { status: 'cancelled', error: 'Stopped at the gate' } : { status: 'running' });
  const step = roadmaps().advance(r, { runOf });
  assert.equal(step.roadmap.stages[0].items[0].status, 'failed');
  assert.deepEqual([step.roadmap.state, step.roadmap.pausedBy ?? null], ['running', null]);
});

test('#395 parkStage: refused while an item of the stage runs a turn, naming "Pause after current step"; nothing written', (t) => {
  const dir = tmpDir(t);
  roadmaps().writeRoadmap(dir, 'p1', plan('running', [
    stage('s1', [item('i1', 'planned', { runId: 'run-i1', runs: ['run-i1'] }), item('i2', 'planned', { runId: 'run-i2', runs: ['run-i2'] })]),
    stage('s2', [item('i3', 'planned')]),
  ]));
  const runOf = (id) => (id === 'run-i1' ? { status: 'running', waiting: true } : { status: 'running' });
  assert.equal(typeof roadmaps().parkStage, 'function');
  assert.throws(() => roadmaps().parkStage(dir, 'p1', 's1', { alive: () => true, runOf }), /Pause after current step/);
  assert.deepEqual(roadmaps().readRoadmap(dir, 'p1').stages[0].items.map((x) => x.status), ['planned', 'planned']);
});

// ---- Through the service (mock runs, the fixture's human gate) -----------------------------------

function svc() { return require('@craftorio/engine/test/service/helpers'); }
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);
const ticks = (ms = 500) => new Promise((r) => setTimeout(r, ms));

// A simulated roadmap started with `max` slots: `stages` = issue numbers per stage, e.g. [[1], [2]].
async function started(t, stages, { name, max = 3 } = {}) {
  const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = svc();
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, stages.flat(), name);
  api['settings:set']({ concurrentRuns: { enabled: true, max, perProject: null, countSimulations: true } });
  const watched = watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: stages.map((numbers) => ({ items: numbers.map((number) => ({ workflow: 'fixture-issue.yaml', number, mock: true })) })) });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const get = () => api['roadmap:get']({ projectId: p.id });
  const runOf = (n) => api['runs:active']().find((r) => hasIssue(r, n));
  // waits until issue n's run waits at its human gate → its run id
  const atGateRun = async (n) => {
    await until(() => !!runOf(n));
    const { runId } = runOf(n);
    await until(() => watched.gates.has(runId));
    return runId;
  };
  return { service, api, ws, p, get, runOf, atGateRun, until, ...watched };
}

test('#395 roadmap:item park: the item is parked, its gate still waits (same approval, unanswered), and the next stage starts', async (t) => {
  const { api, p, get, runOf, atGateRun, until, gates, finished } = await started(t, [[1], [2]], { name: 'park-item' });
  const run1 = await atGateRun(1);
  const approval = gates.get(run1);
  const itemId = get().stages[0].items[0].id;
  await api['roadmap:item']({ projectId: p.id, itemId, action: 'park' });
  assert.equal(get().stages[0].items[0].status, 'parked');
  await until(() => !!runOf(2));
  await ticks();
  assert.deepEqual([finished.has(run1), gates.get(run1) === approval, !!runOf(1)], [false, true, true]);
  assert.equal(get().state, 'running');
});

test('#395 roadmap:item park: the owner answers the parked gate later with Continue: the item is done', async (t) => {
  const { api, p, get, atGateRun, until, gates, finished } = await started(t, [[1], [2]], { name: 'park-late-ok' });
  const run1 = await atGateRun(1);
  await api['roadmap:item']({ projectId: p.id, itemId: get().stages[0].items[0].id, action: 'park' });
  api['approval:resolve']({ runId: run1, id: gates.get(run1), answer: true });
  await until(() => finished.has(run1));
  await until(() => get().stages[0].items[0].status !== 'parked');
  assert.equal(get().stages[0].items[0].status, 'done');
});

test('#395 roadmap:item park: the parked run stopped later: the item is failed and the roadmap is not paused', async (t) => {
  const { api, p, get, runOf, atGateRun, until, finished } = await started(t, [[1], [2]], { name: 'park-late-stop' });
  const run1 = await atGateRun(1);
  await api['roadmap:item']({ projectId: p.id, itemId: get().stages[0].items[0].id, action: 'park' });
  await until(() => !!runOf(2));
  api['run:stop']({ runId: run1 });
  await until(() => finished.has(run1));
  await ticks();
  const r = get();
  assert.equal(r.stages[0].items[0].status, 'failed');
  assert.deepEqual([r.state, r.pausedBy ?? null], ['running', null]);
});

test('#395 roadmap:item park: an item not at a human gate (planned, no run) is refused and stays planned', async (t) => {
  const { api, p, get, atGateRun } = await started(t, [[1], [2]], { name: 'park-refused' });
  await atGateRun(1);
  const second = get().stages[1].items[0].id;
  // refused with a reason about the gate (not as an unknown action)
  await assert.rejects(async () => api['roadmap:item']({ projectId: p.id, itemId: second, action: 'park' }), /gate/i);
  assert.equal(get().stages[1].items[0].status, 'planned');
});

test('#395 roadmap:item park: the move is an owner edit: its answer names the edit and the history keeps the version before it', async (t) => {
  const { api, p, get, atGateRun } = await started(t, [[1], [2]], { name: 'park-history' });
  await atGateRun(1);
  const before = (await api['roadmap:versions']({ projectId: p.id })).length;
  const out = await api['roadmap:item']({ projectId: p.id, itemId: get().stages[0].items[0].id, action: 'park' });
  assert.equal(typeof out.edit?.label, 'string');
  const versions = await api['roadmap:versions']({ projectId: p.id });
  assert.equal(versions.length, before + 1);
  assert.match(String(versions[0].label), /move|park/i);
});

test('#395 roadmap:park-stage: parks the stage\'s item waiting at a gate and skips its planned item not started; the gate still waits', async (t) => {
  const { api, p, get, atGateRun, gates, finished } = await started(t, [[1, 2], [3]], { name: 'park-stage', max: 1 });
  const run1 = await atGateRun(1);
  const approval = gates.get(run1);
  await api['roadmap:park-stage']({ projectId: p.id, stageId: get().stages[0].id });
  assert.deepEqual(get().stages[0].items.map((x) => x.status), ['parked', 'skipped']);
  await ticks();
  assert.deepEqual([finished.has(run1), gates.get(run1) === approval], [false, true]);
});

// ---- The Roadmap screen ------------------------------------------------------------------------

const H = () => require('../roadmap-status-helpers');
const RUN_ID = '20261015-100000-park0001';

test('#395 card: an item waiting at a gate shows "Move on", which asks the service to park it', async () => {
  const h = H();
  const x = h.item('i1', 'running', 1, 'One', { runId: RUN_ID, waiting: true, run: h.run({ waiting: true, gate: 'Accept the work?' }) });
  const d = h.roadmapOf([{ id: 's1', name: '', note: '', items: [x] }, { id: 's2', name: '', note: '', items: [h.item('i2', 'planned', 2, 'Two')] }]);
  const { R, sandbox } = h.loadRoadmap();
  const calls = [];
  sandbox.api.roadmapItem = async (...a) => { calls.push(a.map(String)); return d; };
  const html = R.html(d, () => {}, { showAll: true, since: 'total' });
  const card = h.itemEl(html, 'i1');
  const buttons = h.findAll(card.outer, (e) => e.name === 'button').map((e) => h.visibleText(e.inner).trim());
  assert.equal(buttons.includes('Move on'), true, `buttons: ${buttons.join(' | ')}`);
  const { ctx } = h.makeCtx();
  await R.onClick(h.clickOn(html, (e) => e.name === 'button' && h.visibleText(e.inner).trim() === 'Move on'), ctx, d);
  assert.deepEqual(calls, [['p1', 'i1', 'park']]);
});

test('#395 card and bar: a parked item reads "Parked at ..." and the bar counts "1 parked at a gate"', () => {
  const h = H();
  const x = h.item('i1', 'parked', 1, 'One', { runId: RUN_ID, run: h.run({ waiting: true, gate: 'Accept the work?' }) });
  const d = h.roadmapOf([{ id: 's1', name: '', note: '', items: [x] }, { id: 's2', name: '', note: '', items: [h.item('i2', 'planned', 2, 'Two')] }]);
  const { R } = h.loadRoadmap();
  const html = R.html(d, () => {}, { showAll: true, since: 'total' });
  assert.match(h.visibleText(h.itemEl(html, 'i1').inner), /Parked at/);
  const bar = h.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-bar');
  assert.match(h.visibleText(bar.inner), /1 parked at a gate/);
});

// ---- Night watch ---------------------------------------------------------------------------------

const MIN = 60e3;
const T0 = Date.parse('2026-10-15T02:00:00.000Z');
const since = (minutes) => new Date(T0 - minutes * MIN).toISOString();

test('#395 night watch: Move on needs the skip permission', () => {
  assert.equal(night().permissionOf('roadmap.item', { action: 'park' }), 'skip');
});

test('#395 night watch: the log takes oracle.parked', (t) => {
  const dir = tmpDir(t);
  night().logNight(dir, 'oracle.parked', { target: 'p1/i1', runId: 'run-i1', projectId: 'p1', gate: 'review' });
  assert.deepEqual(night().readNightLog(dir).map((e) => e.type), ['oracle.parked']);
});

test('#395 night watch: with skip allowed, a run at a gate for 15 min and nothing else of the roadmap running is parked', () => {
  const decide = night().gateDecision;
  assert.equal(typeof decide, 'function');
  assert.equal(decide({ waitingSince: since(15), now: T0, allowed: ['retry', 'skip'], othersRunning: false, settings: {} }), 'park');
});

test('#395 night watch: under 15 min at the gate, or another run of the roadmap still going, it does not park', () => {
  const decide = night().gateDecision;
  assert.equal(typeof decide, 'function');
  assert.notEqual(decide({ waitingSince: since(14), now: T0, allowed: ['skip'], othersRunning: false, settings: {} }), 'park');
  assert.notEqual(decide({ waitingSince: since(30), now: T0, allowed: ['skip'], othersRunning: true, settings: {} }), 'park');
});

test('#395 night watch: without the skip permission it escalates as today; the wait is a setting (oracle.parkAfterMinutes)', () => {
  const decide = night().gateDecision;
  assert.equal(typeof decide, 'function');
  assert.equal(decide({ waitingSince: since(60), now: T0, allowed: ['retry'], othersRunning: false, settings: {} }), 'escalate');
  assert.equal(decide({ waitingSince: since(6), now: T0, allowed: ['skip'], othersRunning: false, settings: { oracle: { parkAfterMinutes: 5 } } }), 'park');
});

test('#395 night watch: answering a gate stays never allowed', (t) => {
  assert.equal(night().NEVER_ALLOWED.some((n) => n.id === 'answer-gate'), true);
  assert.throws(() => night().savePermissions(tmpDir(t), ['skip', 'answer-gate']), /never allowed/);
});
