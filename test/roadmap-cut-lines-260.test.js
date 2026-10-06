// Releases (#260): a cut line on the Roadmap between two stages ("Release here", with a name or
// version) is a `release: { name }` field on the stage before the line. cleanStages and the
// roadmap file keep it; advance() stops at it: when every item of that stage is done it starts no
// item of the next stage and returns `release: { stage, name }` (the caller starts the release
// run). Once the release shipped (`release.status: 'shipped'`) the next stage starts as usual.
// Roadmaps without cut lines behave as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../src/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-cut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A roadmap item as advance() expects it (copied from test/roadmap.test.js).
const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const mkRoadmap = (stages, over = {}) => ({ state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null, stages, ...over });
const merged = { r1: { status: 'success', merged: true }, r2: { status: 'success', merged: true } };
const runOf = (id) => merged[id] || null;

// ---- cleanStages / the roadmap file --------------------------------------------------------

test('cleanStages keeps a stage\'s release name trimmed (#260)', () => {
  const [s1, s2] = roadmaps.cleanStages([
    { name: 'One', items: [{ workflow: 'a.yaml', number: 1 }], release: { name: '  v1.4  ' } },
    { name: 'Two', items: [{ workflow: 'a.yaml', number: 2 }] },
  ]);
  assert.deepEqual(s1.release, { name: 'v1.4' });
  assert.equal(s2.release, undefined);
});

test('cleanStages drops a release with an empty name and keeps a named one (#260)', () => {
  const [s1, s2] = roadmaps.cleanStages([
    { items: [{ workflow: 'a.yaml', number: 1 }], release: { name: '   ' } },
    { items: [{ workflow: 'a.yaml', number: 2 }], release: { name: 'v2' } },
  ]);
  assert.equal(s1.release, undefined);
  assert.deepEqual(s2.release, { name: 'v2' });
});

test('saving and reading the roadmap file keeps the cut line (#260)', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [
    { name: 'One', items: [{ workflow: 'a.yaml', number: 1 }], release: { name: 'v1.4' } },
    { name: 'Two', items: [{ workflow: 'a.yaml', number: 2 }] },
  ]);
  const read = roadmaps.readRoadmap(dir, 'proj');
  assert.equal(read.stages[0].release?.name, 'v1.4');
  assert.equal(read.stages[1].release, undefined);
});

// ---- advance() --------------------------------------------------------------------------------

test('advance stops at a cut line: no item of the next stage starts and it asks for the release (#260)', () => {
  const roadmap = mkRoadmap([
    { id: 's1', release: { name: 'v1.4' }, items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.equal(result.roadmap.stages[0].items[0].status, 'done');
  assert.deepEqual(result.start, []);
  assert.deepEqual(result.release, { stage: 's1', name: 'v1.4' });
  assert.notEqual(result.roadmap.state, 'done');
});

test('advance goes past a shipped cut line and stops at the next one that has not shipped (#260)', () => {
  const roadmap = mkRoadmap([
    { id: 's1', release: { name: 'v1.3', status: 'shipped' }, items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    { id: 's2', release: { name: 'v1.4' }, items: [mkItem('i2', 2, { status: 'running', runId: 'r2' })] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual(result.start, []);
  assert.deepEqual(result.release, { stage: 's2', name: 'v1.4' });
});

test('advance starts the next stage once the cut line\'s release shipped (#260)', () => {
  const roadmap = mkRoadmap([
    { id: 's1', release: { name: 'v1.4', status: 'shipped' }, items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual(result.start.map((x) => x.id), ['i2']);
  assert.equal(result.release, undefined);
});

test('without cut lines stage 2 starts after stage 1 as before (#260 regression)', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual(result.start.map((x) => x.id), ['i2']);
  assert.equal(result.release, undefined);
});
