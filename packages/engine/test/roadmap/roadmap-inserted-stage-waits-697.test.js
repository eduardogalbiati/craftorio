// #697: a stage added before the running stage waits for it instead of starting in parallel
// (packages/engine/domains/roadmap/roadmap.js advance). Acceptance tests, written before the code.
//
// Owner decision: an unstarted stage that sits before a stage with an item `running` (a real run in
// progress: not waiting at a human gate, not parked) starts nothing until that running stage's items
// are finished; then it starts, before any stage after the running one. An item parked at a human
// gate (#395) still does not hold the roadmap. Every way of adding a stage ends in saveStages (the
// roadmap:save channel the screen and the control channel's tools use), so the save path is covered
// through it. Only the run lookup (`runOf`) is stubbed: it is the boundary to the run processes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');

const item = (id, status, extra = {}) => ({ id, workflow: 'software-development.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const started = (id) => item(id, 'planned', { runId: `run-${id}`, runs: [`run-${id}`] });
const stage = (id, items) => ({ id, name: '', note: '', items });
const plan = (stages) => ({ state: 'running', simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null });
// the runs' states by run id; a run not listed does not exist
const runsOf = (map) => (runId) => map[runId] || null;
const RUNNING = { status: 'running' };
const MERGED = { status: 'success', merged: true };

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inserted-697-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('#697 a stage inserted before the running stage starts nothing while that stage runs', () => {
  // stage 1: the inserted one (never started); stage 2: its item's run is in progress; stage 3: planned
  const r = plan([stage('s-new', [item('i9', 'planned')]), stage('s1', [started('i1')]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmaps.advance(r, { runOf: runsOf({ 'run-i1': RUNNING }) });
  assert.deepEqual(step.start.map((x) => x.id), []);
  assert.deepEqual([step.roadmap.state, step.roadmap.pausedBy], ['running', null]);
  assert.equal(step.roadmap.stages[0].items[0].status, 'planned');
});

test('#697 once the running stage is finished, the inserted stage starts before any stage after it', () => {
  const r = plan([stage('s-new', [item('i9', 'planned')]), stage('s1', [started('i1')]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmaps.advance(r, { runOf: runsOf({ 'run-i1': MERGED }) });
  assert.deepEqual(step.start.map((x) => x.id), ['i9']);
});

test('#697 a stage inserted before a running stage with two items waits until both are finished', () => {
  // one item of the running stage is done, the other still runs: still nothing of the inserted stage starts
  const r = plan([stage('s-new', [item('i9', 'planned')]), stage('s1', [started('i1'), started('i2')]), stage('s2', [item('i3', 'planned')])]);
  const step = roadmaps.advance(r, { runOf: runsOf({ 'run-i1': MERGED, 'run-i2': RUNNING }) });
  assert.deepEqual(step.start.map((x) => x.id), []);
});

test('#697 (guards #395) an earlier item parked at a human gate does not hold the stages after it', () => {
  // the parked run still waits at its gate: the next stage starts as today
  const parked = item('i1', 'parked', { runId: 'run-i1', runs: ['run-i1'], parked: { at: null, gate: 'Review' } });
  const r = plan([stage('s1', [parked]), stage('s2', [item('i2', 'planned')])]);
  const step = roadmaps.advance(r, { runOf: runsOf({ 'run-i1': { status: 'running', waiting: true } }) });
  assert.deepEqual(step.start.map((x) => x.id), ['i2']);
});

test('#697 a stage added before the running stage by a save (roadmap:save → saveStages) starts nothing', (t) => {
  const dir = tmpDir(t);
  const issue = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}`, body: '', pullRequests: [] });
  const issues = [issue(1), issue(2), issue(3)];
  const first = roadmaps.saveStages(dir, 'proj', [
    { name: 'One', items: [{ workflow: 'feature.yaml', number: 1 }] },
    { name: 'Two', items: [{ workflow: 'feature.yaml', number: 2 }] },
  ], { issues });
  const [s1, s2] = first.stages;
  roadmaps.markStarted(dir, 'proj', s1.items[0].id, { runId: 'run-one' });
  roadmaps.writeRoadmap(dir, 'proj', { ...roadmaps.readRoadmap(dir, 'proj'), state: 'running' });
  // the owner adds a new stage at the top, before the running stage
  roadmaps.saveStages(dir, 'proj', [
    { name: 'Inserted', items: [{ workflow: 'feature.yaml', number: 3 }] },
    { id: s1.id, name: s1.name, items: [{ id: s1.items[0].id, workflow: 'feature.yaml', number: 1 }] },
    { id: s2.id, name: s2.name, items: [{ id: s2.items[0].id, workflow: 'feature.yaml', number: 2 }] },
  ], { issues, alive: (runId) => runId === 'run-one' });
  const saved = roadmaps.readRoadmap(dir, 'proj');
  assert.deepEqual([saved.state, saved.stages.length, saved.stages[1].items[0].runId], ['running', 3, 'run-one'], 'the save kept the running stage and its run');
  const step = roadmaps.advance(saved, { runOf: runsOf({ 'run-one': RUNNING }) });
  assert.deepEqual(step.start.map((x) => x.id), []);
});
