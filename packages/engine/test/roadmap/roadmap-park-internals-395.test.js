// #395 Move on: internal details the acceptance tests leave out (the developer's own tests): Retry of
// a parked item that failed later, Undo of a move, a resumed parked run, an interrupted run at a gate,
// a parked item refused a second time, a stage with nothing to move past.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const model = require('@craftorio/shared/roadmap-model');
const undo = require('../../domains/roadmap/roadmap-undo');

const item = (id, status, extra = {}) => ({ id, workflow: 'software-development.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const stage = (id, items) => ({ id, name: '', note: '', items });
const plan = (state, stages, extra = {}) => ({ state, simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null, ...extra });

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-int-395-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('#395 park: records the gate and when; a second Move on is refused', (t) => {
  const dir = tmpDir(t);
  roadmaps.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'planned', { runId: 'r1', runs: ['r1'] })])]));
  const runOf = () => ({ status: 'running', waiting: true, gate: 'Developer check' });
  roadmaps.itemAction(dir, 'p1', 'i1', 'park', { runOf, now: new Date('2026-10-15T02:00:00Z') });
  const x = roadmaps.readRoadmap(dir, 'p1').stages[0].items[0];
  assert.deepEqual([x.status, x.parked], ['parked', { at: '2026-10-15T02:00:00.000Z', gate: 'Developer check' }]);
  assert.throws(() => roadmaps.itemAction(dir, 'p1', 'i1', 'park', { runOf }), /already parked/);
});

test('#395 park: a run interrupted at its gate (a closed app) can be parked, and the roadmap it paused goes on', (t) => {
  const dir = tmpDir(t);
  roadmaps.writeRoadmap(dir, 'p1', plan('paused', [stage('s1', [item('i1', 'planned', { runId: 'r1', runs: ['r1'] })])], { pausedBy: 'i1', error: 'Stage 1: #1 failed.' }));
  roadmaps.itemAction(dir, 'p1', 'i1', 'park', { runOf: () => ({ status: 'interrupted', waiting: true, gate: 'Review' }) });
  const r = roadmaps.readRoadmap(dir, 'p1');
  assert.deepEqual([r.stages[0].items[0].status, r.state, r.pausedBy], ['parked', 'running', null]);
  // still interrupted: it stays parked (the owner resumes it first)
  const step = roadmaps.advance(r, { runOf: () => ({ status: 'interrupted' }) });
  assert.equal(step.roadmap.stages[0].items[0].status, 'parked');
});

test('#395 a parked item that failed later is finished; Retry plans it again without the mark', (t) => {
  const dir = tmpDir(t);
  const failedParked = item('i1', 'failed', { runId: 'r1', runs: ['r1'], error: 'Run r1 cancelled', parked: { at: null, gate: 'Review' } });
  assert.equal(model.isFinished(failedParked), true);
  roadmaps.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [failedParked]), stage('s2', [item('i2', 'planned')])]));
  const step = roadmaps.advance(roadmaps.readRoadmap(dir, 'p1'), { runOf: () => null });
  assert.deepEqual([step.roadmap.state, step.roadmap.pausedBy, step.start.map((x) => x.id)], ['running', null, ['i2']]);
  roadmaps.itemAction(dir, 'p1', 'i1', 'retry', { alive: () => false });
  const x = roadmaps.readRoadmap(dir, 'p1').stages[0].items[0];
  assert.deepEqual([x.status, x.runId, 'parked' in x], ['planned', null, false]);
});

test('#395 Retry and Skip are refused on a parked item whose run still waits', (t) => {
  const dir = tmpDir(t);
  roadmaps.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'parked', { runId: 'r1', runs: ['r1'], parked: { at: null, gate: 'Review' } })])]));
  assert.throws(() => roadmaps.itemAction(dir, 'p1', 'i1', 'skip', { alive: () => true }), /in progress/);
  const acts = model.allowedActions(plan('running', []), null, item('i1', 'parked', { runId: 'r1' }));
  assert.deepEqual([acts.retry.allowed, acts.skip.allowed, acts.park.allowed], [false, false, false]);
});

test('#395 a resumed parked run keeps its item parked (adoptResumed)', (t) => {
  const dir = tmpDir(t);
  roadmaps.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'parked', { runId: 'r1', runs: ['r1'], parked: { at: null, gate: 'Review' } })])]));
  roadmaps.adoptResumed(dir, 'p1', 'r1', 'r2');
  const x = roadmaps.readRoadmap(dir, 'p1').stages[0].items[0];
  assert.deepEqual([x.status, x.runId, x.runs], ['parked', 'r2', ['r1', 'r2']]);
});

test('#395 Undo of a Move on puts the item back in its stage (no longer parked)', () => {
  const before = [stage('s1', [item('i1', 'planned', { runId: 'r1', runs: ['r1'] })])];
  const after = [stage('s1', [item('i1', 'parked', { runId: 'r1', runs: ['r1'], parked: { at: 'x', gate: 'Review' } })])];
  const edit = undo.recordEdit(before, after, 'Moved on past #1 at its gate');
  const out = undo.undoEdit(after, edit);
  assert.equal(out.ok, true);
  const x = out.stages[0].items[0];
  assert.deepEqual([x.status, x.runId, 'parked' in x], ['planned', 'r1', false]);
});

test('#395 Move on from a stage with nothing at a gate and nothing planned is refused', (t) => {
  const dir = tmpDir(t);
  roadmaps.writeRoadmap(dir, 'p1', plan('running', [stage('s1', [item('i1', 'done', { runId: 'r1' })]), stage('s2', [item('i2', 'planned')])]));
  assert.throws(() => roadmaps.parkStage(dir, 'p1', 's1', { runOf: () => null }), /Nothing of this stage/);
  assert.throws(() => roadmaps.parkStage(dir, 'p1', 'gone', { runOf: () => null }), /no longer in the roadmap/);
});
