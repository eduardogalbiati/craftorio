// #284 Disable a roadmap stage. Acceptance tests written before the code.
//
// Contract assumed (public seams only):
// - packages/engine/domains/roadmap/roadmap.js: a stage may carry `disabled: true` (stored in the roadmap JSON; an enabled stage
//   has no such field). cleanStages / saveStages keep `disabled` when the incoming stage omits it
//   (an Oracle or Product Owner edit), set it on an explicit true and drop it on an explicit false.
//   advance() never starts an item of a disabled stage and moves past it; a disabled stage's cut line
//   (`release`, #260) holds nothing; a roadmap whose enabled stages are all finished is `done` while
//   the disabled stages stay planned. currentStage() names the first unfinished ENABLED stage.
//   setState(..., 'running', { stage }) on a disabled stage throws a message asking to enable it.
// - packages/engine/domains/night/night-watch.js roadmapIncidents: a running roadmap with only disabled stages left is not
//   `dispatch-idle`.
// - packages/engine/domains/roadmap/roadmap-undo.js (#281): undoing a Disable / Enable puts the stage's switch back.
// - the service: roadmap:start with a disabled stage's id (Run this stage) is refused (/enable/i).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const roadmaps = () => require('../../domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-disabled-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// an item as advance() expects it (as in test/roadmap-cut-lines-260.test.js)
const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const mkRoadmap = (stages, over = {}) => ({ state: 'running', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null, stages, ...over });
const RUNS = { r1: { status: 'success', merged: true }, live: { status: 'running' } };
const runOf = (id) => RUNS[id] || null;
const issues = (...numbers) => numbers.map((n) => ({ number: n, title: `Issue ${n}`, state: 'open', url: `https://github.com/o/r/issues/${n}`, body: '' }));
const ids = (list) => Array.from(list || [], (x) => x.id);

// ---- storage -----------------------------------------------------------------------------------

test('#284 storage: a disabled stage is stored with disabled: true in the roadmap file', (t) => {
  const dir = tmp(t);
  roadmaps().saveStages(dir, 'p1', [
    { id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] },
    { id: 's2', disabled: true, items: [{ workflow: 'w.yaml', number: 2 }] },
  ], { issues: issues(1, 2) });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'p1.roadmap.json'), 'utf8'));
  assert.equal(raw.stages[1].disabled, true);
});

test('#284 storage: an enabled stage has no disabled field', (t) => {
  const dir = tmp(t);
  roadmaps().saveStages(dir, 'p1', [{ id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] }], { issues: issues(1) });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'p1.roadmap.json'), 'utf8'));
  assert.equal('disabled' in raw.stages[0], false);
});

test('#284 save: a stage sent without the field (an Oracle or Product Owner edit) stays disabled', (t) => {
  const dir = tmp(t);
  const R = roadmaps();
  R.saveStages(dir, 'p1', [{ id: 's1', disabled: true, items: [{ workflow: 'w.yaml', number: 1 }] }], { issues: issues(1) });
  const item = R.readRoadmap(dir, 'p1').stages[0].items[0];
  R.saveStages(dir, 'p1', [{ id: 's1', name: 'Renamed', items: [{ id: item.id, workflow: 'w.yaml', number: 1 }] }], { issues: issues(1) });
  const s = R.readRoadmap(dir, 'p1').stages[0];
  assert.deepEqual([s.name, s.disabled], ['Renamed', true]);
});

test('#284 save: an explicit disabled: false enables the stage and removes the field', (t) => {
  const dir = tmp(t);
  const R = roadmaps();
  R.saveStages(dir, 'p1', [{ id: 's1', disabled: true, items: [{ workflow: 'w.yaml', number: 1 }] }], { issues: issues(1) });
  const item = R.readRoadmap(dir, 'p1').stages[0].items[0];
  R.saveStages(dir, 'p1', [{ id: 's1', disabled: false, items: [{ id: item.id, workflow: 'w.yaml', number: 1 }] }], { issues: issues(1) });
  assert.equal('disabled' in R.readRoadmap(dir, 'p1').stages[0], false);
});

test('#284 cleanStages keeps disabled from the previous roadmap when the incoming stage omits it', () => {
  const previous = { stages: [{ id: 's1', disabled: true, items: [] }] };
  const [s1] = roadmaps().cleanStages([{ id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] }], { previous });
  assert.equal(s1.disabled, true);
});

// ---- advance -----------------------------------------------------------------------------------

test('#284 advance: a disabled first stage starts nothing; the next enabled stage starts', () => {
  const r = mkRoadmap([
    { id: 's1', disabled: true, items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  assert.deepEqual(ids(roadmaps().advance(r, { runOf }).start), ['i2']);
});

test('#284 advance: a disabled middle stage is skipped once the stage before it is done', () => {
  const r = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { runId: 'r1', runs: ['r1'] })] },
    { id: 's2', disabled: true, items: [mkItem('i2', 2)] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ]);
  assert.deepEqual(ids(roadmaps().advance(r, { runOf }).start), ['i3']);
});

test('#284 advance: with a disabled last stage the roadmap is done once the enabled stages are finished, the disabled stage staying planned', () => {
  const r = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { runId: 'r1', runs: ['r1'] })] },
    { id: 's2', disabled: true, items: [mkItem('i2', 2)] },
  ]);
  const out = roadmaps().advance(r, { runOf });
  assert.deepEqual([out.roadmap.state, ids(out.start).length, out.roadmap.stages[1].items[0].status], ['done', 0, 'planned']);
});

test('#284 currentStage names the first unfinished enabled stage, never a disabled one', () => {
  const r = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'done' })] },
    { id: 's2', disabled: true, items: [mkItem('i2', 2)] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ]);
  assert.equal(roadmaps().currentStage(r), 2);
});

test('#284 advance with a scope (Run this stage): when the scoped stage ends and only disabled stages are left, the roadmap is done', () => {
  const r = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { runId: 'r1', runs: ['r1'] })] },
    { id: 's2', disabled: true, items: [mkItem('i2', 2)] },
  ], { scope: { stage: 's1' } });
  const out = roadmaps().advance(r, { runOf });
  assert.deepEqual([out.roadmap.state, ids(out.start).length], ['done', 0]);
});

test('#284 advance: a disabled stage\'s cut line holds nothing: the stage after it starts and no release is asked', () => {
  const r = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { runId: 'r1', runs: ['r1'] })] },
    { id: 's2', disabled: true, release: { name: 'v2.0' }, items: [mkItem('i2', 2)] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ]);
  const out = roadmaps().advance(r, { runOf });
  assert.deepEqual([ids(out.start), out.release === undefined], [['i3'], true]);
});

test('#284 advance: a disabled first stage with a cut line does not start its own items either', () => {
  const r = mkRoadmap([
    { id: 's1', disabled: true, release: { name: 'v1.0' }, items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const out = roadmaps().advance(r, { runOf });
  assert.deepEqual([ids(out.start), out.release === undefined], [['i2'], true]);
});

test('#284 enabling a stage again (save with disabled: false) makes it run in its order at the next dispatch', (t) => {
  const dir = tmp(t);
  const R = roadmaps();
  R.saveStages(dir, 'p1', [
    { id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] },
    { id: 's2', disabled: true, items: [{ workflow: 'w.yaml', number: 2 }] },
    { id: 's3', items: [{ workflow: 'w.yaml', number: 3 }] },
  ], { issues: issues(1, 2, 3) });
  R.setState(dir, 'p1', 'running', { simulated: false });
  const first = R.readRoadmap(dir, 'p1').stages[0].items[0];
  R.markStarted(dir, 'p1', first.id, { runId: 'r1' });
  const disabledStart = R.advance(R.readRoadmap(dir, 'p1'), { runOf }).start.map((x) => x.number);
  const stages = R.readRoadmap(dir, 'p1').stages.map((s) => ({ ...s, ...(s.id === 's2' ? { disabled: false } : {}) }));
  R.saveStages(dir, 'p1', stages, { issues: issues(1, 2, 3) });
  const enabledStart = R.advance(R.readRoadmap(dir, 'p1'), { runOf }).start.map((x) => x.number);
  assert.deepEqual([disabledStart, enabledStart], [[3], [2]], 'disabled: stage 3 starts; enabled again: stage 2 starts first');
});

test('#284 enabling a stage after the roadmap is done never starts it by itself', (t) => {
  const dir = tmp(t);
  const R = roadmaps();
  R.saveStages(dir, 'p1', [
    { id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] },
    { id: 's2', disabled: true, items: [{ workflow: 'w.yaml', number: 2 }] },
  ], { issues: issues(1, 2) });
  R.setState(dir, 'p1', 'running', { simulated: false });
  R.markStarted(dir, 'p1', R.readRoadmap(dir, 'p1').stages[0].items[0].id, { runId: 'r1' });
  const ended = R.advance(R.readRoadmap(dir, 'p1'), { runOf });
  assert.equal(ended.roadmap.state, 'done');
  R.writeRoadmap(dir, 'p1', ended.roadmap);
  const stages = R.readRoadmap(dir, 'p1').stages.map((s) => ({ ...s, disabled: false }));
  R.saveStages(dir, 'p1', stages, { issues: issues(1, 2) });
  const after = R.readRoadmap(dir, 'p1');
  assert.deepEqual([after.state, R.advance(after, { runOf }).start.length], ['done', 0]);
});

// ---- Run this stage on a disabled stage ----------------------------------------------------------

test('#284 setState running with a disabled stage as the scope is refused, asking to enable it', (t) => {
  const dir = tmp(t);
  const R = roadmaps();
  R.saveStages(dir, 'p1', [
    { id: 's1', items: [{ workflow: 'w.yaml', number: 1 }] },
    { id: 's2', disabled: true, items: [{ workflow: 'w.yaml', number: 2 }] },
  ], { issues: issues(1, 2) });
  assert.throws(() => R.setState(dir, 'p1', 'running', { simulated: true, stage: 's2' }), /enable/i);
});

test('#284 service: roadmap:start with a disabled stage (Run this stage) is refused with a message about enabling it', async (t) => {
  const { makeService, roadmapProject, ISSUE_WORKFLOW } = require('../service/helpers');
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-disabled');
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { id: 's1', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
      { id: 's2', disabled: true, items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
    ],
  });
  const stageId = api['roadmap:get']({ projectId: p.id }).stages[1].id;
  await assert.rejects(async () => api['roadmap:start']({ projectId: p.id, simulated: true, stage: stageId }), /enable/i);
  assert.equal(api['runs:active']().length, 0);
});

// ---- Night watch -----------------------------------------------------------------------------------

test('#284 night watch: a running roadmap with only disabled stages left is not reported as dispatch-idle', () => {
  const { roadmapIncidents } = require('../../domains/night/night-watch');
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'done' })] },
    { id: 's2', disabled: true, items: [mkItem('i2', 2)] },
  ]);
  const kinds = roadmapIncidents([{ projectId: 'p1', roadmap }], []).map((x) => x.kind);
  assert.equal(kinds.includes('dispatch-idle'), false);
});

test('#284 night watch: an enabled planned stage with no run in progress is still dispatch-idle (regression)', () => {
  const { roadmapIncidents } = require('../../domains/night/night-watch');
  const roadmap = mkRoadmap([
    { id: 's1', disabled: true, items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const kinds = roadmapIncidents([{ projectId: 'p1', roadmap }], []).map((x) => x.kind);
  assert.equal(kinds.includes('dispatch-idle'), true);
});

// ---- Undo (#281) -------------------------------------------------------------------------------------

const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const undoItem = (id, number) => ({ id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, ...ref(number), issues: [ref(number)], status: 'planned', runId: null, runs: [], error: null });
const clone = (x) => JSON.parse(JSON.stringify(x));

test('#284 undo of "Disabled stage 2" enables the stage again', () => {
  const { recordEdit, undoEdit } = require('../../domains/roadmap/roadmap-undo');
  const before = [{ id: 'st1', name: '', note: '', items: [undoItem('it1', 1)] }, { id: 'st2', name: '', note: '', items: [undoItem('it2', 2)] }];
  const after = clone(before);
  after[1].disabled = true;
  const out = undoEdit(clone(after), recordEdit(clone(before), clone(after), 'Disabled stage 2'));
  assert.equal(out.ok, true);
  assert.equal(!!out.stages[1].disabled, false);
});

test('#284 undo of "Enabled stage 2" disables the stage again', () => {
  const { recordEdit, undoEdit } = require('../../domains/roadmap/roadmap-undo');
  const before = [{ id: 'st1', name: '', note: '', items: [undoItem('it1', 1)] }, { id: 'st2', name: '', note: '', disabled: true, items: [undoItem('it2', 2)] }];
  const after = clone(before);
  delete after[1].disabled;
  const out = undoEdit(clone(after), recordEdit(clone(before), clone(after), 'Enabled stage 2'));
  assert.equal(out.ok, true);
  assert.equal(out.stages[1].disabled, true);
});
