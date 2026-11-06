// #804: the Skip dialog's RoadmapModel.nextAfterSkip copies the walk of the engine's advance (the screen
// cannot reach the engine). This test keeps the two together: what the model announces for a paused
// roadmap is what a real skip and advance do with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { nextAfterSkip } = require('@multiagent/shared/roadmap-model');

const item = (id, status = 'planned') => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, number: Number(id.slice(1)), url: `https://x/${id}`, title: id, body: '',
  knownPullRequests: [], status, runId: status === 'failed' ? `run-${id}` : null, runs: [], error: null,
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
  const runOf = (id) => (id ? { status: 'failed' } : null);
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
