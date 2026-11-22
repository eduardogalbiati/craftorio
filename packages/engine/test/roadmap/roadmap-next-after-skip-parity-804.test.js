// #804: the Skip dialog's RoadmapModel.nextAfterSkip copies the walk of the engine's advance (the screen
// cannot reach the engine). This test keeps the two together: what the model announces for a paused
// roadmap is what a real skip and advance do with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { nextAfterSkip } = require('@craftorio/shared/roadmap-model');

const item = (id, status = 'planned', over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, number: Number(id.slice(1)), url: `https://x/${id}`, title: id, body: '',
  knownPullRequests: [], status, runId: ['failed', 'running'].includes(status) ? `run-${id}` : null, runs: [], error: null, ...over,
});
const stage = (id, items, over = {}) => ({ id, name: '', items, ...over });
const release = { kind: 'release', id: 'r1', name: 'v1.4', items: [] };
const FAILED = item('i1', 'failed');

// what the engine does after the skip, in the model's words
function engineGoesOn(t, roadmap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-parity-804-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  roadmaps.writeRoadmap(dir, 'proj', { simulated: false, updatedAt: null, error: 'boom', ...roadmap });
  const after = roadmaps.itemAction(dir, 'proj', 'i1', 'skip', { alive: () => false });
  // each run as its item says: a running item's run is alive, and at a gate when the item waits
  const items = roadmap.stages.flatMap((s) => s.items);
  const runOf = (id) => {
    const of = items.find((x) => x.runId === id);
    return of ? { status: of.status, ...(of.waiting ? { waiting: true } : {}) } : null;
  };
  const out = roadmaps.advance(after, { runOf });
  if (out.release) return { release: out.release.name };
  if (out.refill) return { refill: true };
  return out.start.length ? { items: out.start.map((x) => x.id) } : null;
}

// what the dialog says, in the same words; `items`: those of the stage that moves on
function modelAnnounces(roadmap) {
  const next = nextAfterSkip({ pausedBy: 'i1', ...roadmap }, 'i1');
  return next?.items ? { items: next.items.map((x) => x.id) } : next;
}

const CASES = [
  ['the next item of its stage', { stages: [stage('s1', [FAILED, item('i2')])] }],
  ['the next stage', { stages: [stage('s1', [FAILED]), stage('s2', [item('i2'), item('i3', 'done')])] }],
  ['nothing left: the roadmap ends', { stages: [stage('s1', [FAILED, item('i2', 'done')])] }],
  ['another failure left in the stage', { stages: [stage('s1', [FAILED, item('i2', 'failed'), item('i3')])] }],
  ['a disabled stage is passed over', { stages: [stage('s1', [FAILED]), stage('s2', [item('i2')], { disabled: true }), stage('s3', [item('i3')])] }],
  ['a cut line reached', { stages: [stage('s1', [FAILED]), release, stage('s2', [item('i2')])] }],
  ['a cut line already shipped', { stages: [stage('s1', [FAILED]), { ...release, status: 'shipped' }, stage('s2', [item('i2')])] }],
  ['a live roadmap at its end', { live: true, stages: [stage('s1', [FAILED])] }],
  ['a stage run on its own', { scope: { stage: 's1' }, stages: [stage('s1', [FAILED, item('i2')]), stage('s2', [item('i3')])] }],
  ['a stage run on its own, over', { scope: { stage: 's1' }, stages: [stage('s1', [FAILED]), stage('s2', [item('i3')])] }],
];

for (const [name, roadmap] of CASES) {
  test(`#804 nextAfterSkip says what skip and advance do: ${name}`, (t) => {
    const paused = { state: 'paused', pausedBy: 'i1', ...roadmap };
    assert.deepEqual(modelAnnounces(paused), engineGoesOn(t, paused));
  });
}

// #697: a stage put before the running one waits, only the running stage moves on. The worked answer
// is written out: a model and an engine that both start nothing would agree with each other.
const BEFORE = item('i5');
const RUNNING = item('i2', 'running');
const WAITS_FOR = [
  ['the stage put before waits for the running one', { stages: [stage('s1', [BEFORE]), stage('s2', [FAILED, RUNNING, item('i3')])] }, { items: ['i3'] }],
  ['what is left of the skipped stage waits too', { stages: [stage('s1', [FAILED, BEFORE]), stage('s2', [RUNNING, item('i3')])] }, { items: ['i3'] }],
  ['the later of two running stages', { stages: [stage('s1', [BEFORE]), stage('s2', [item('i6', 'running'), item('i7')]), stage('s3', [FAILED, RUNNING, item('i3')])] }, { items: ['i3'] }],
  ['a cut line between the two does not hold the running stage', { stages: [stage('s1', [BEFORE]), release, stage('s2', [FAILED, RUNNING, item('i3')])] }, { items: ['i3'] }],
  ['the running stage has nothing left to start', { stages: [stage('s1', [BEFORE]), stage('s2', [FAILED, RUNNING])] }, null],
  ['another failure left in the running stage', { stages: [stage('s1', [BEFORE]), stage('s2', [FAILED, RUNNING, item('i3', 'failed'), item('i4')])] }, null],
  ['a run waiting at a gate is not a running stage', { stages: [stage('s1', [BEFORE]), stage('s2', [FAILED, item('i2', 'running', { waiting: true }), item('i3')])] }, { items: ['i5'] }],
];

for (const [name, roadmap, expected] of WAITS_FOR) {
  test(`#804 nextAfterSkip says what skip and advance do, a stage waiting (#697): ${name}`, (t) => {
    const paused = { state: 'paused', pausedBy: 'i1', ...roadmap };
    assert.deepEqual(modelAnnounces(paused), expected);
    assert.deepEqual(engineGoesOn(t, paused), expected);
  });
}

test('#804 nextAfterSkip numbers the running stage, not the stage put before it', () => {
  const next = nextAfterSkip({ state: 'paused', pausedBy: 'i1', stages: [stage('s1', [BEFORE], { name: 'First' }), stage('s2', [FAILED, RUNNING, item('i3')], { name: 'Second' })] }, 'i1');
  assert.deepEqual([next.stage, next.number], ['Second', 2]);
});
