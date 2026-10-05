// #284 a disabled stage and a stage run on its own (#141, the roadmap's `scope`): details the
// acceptance tests do not cover. Disabling the scoped stage drops the scope (a Resume runs the
// roadmap); a scope whose stage is disabled in the file starts nothing; the Backlog cards' place
// in the roadmap says the stage is disabled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../src/roadmap');

const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const stages = (over = {}) => [
  { id: 's1', name: '', note: '', items: [mkItem('i1', 1)] },
  { id: 's2', name: '', note: '', items: [mkItem('i2', 2)], ...over },
];

test('#284 disabling the stage run on its own drops the scope; the other stages keep theirs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-scope-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  roadmaps.saveStages(dir, 'p1', stages());
  roadmaps.setState(dir, 'p1', 'running', { simulated: true, stage: 's2' });
  roadmaps.setState(dir, 'p1', 'paused');
  assert.deepEqual(roadmaps.readRoadmap(dir, 'p1').scope, { stage: 's2' });
  const stored = () => roadmaps.readRoadmap(dir, 'p1').stages;
  roadmaps.saveStages(dir, 'p1', stored().map((s) => (s.id === 's1' ? { ...s, disabled: true } : s)));
  assert.deepEqual(roadmaps.readRoadmap(dir, 'p1').scope, { stage: 's2' }, 'another stage disabled: the scope stays');
  roadmaps.saveStages(dir, 'p1', stored().map((s) => (s.id === 's2' ? { ...s, disabled: true } : s)));
  assert.equal(roadmaps.readRoadmap(dir, 'p1').scope, null);
});

test('#284 advance: a scope whose stage is disabled starts nothing and pauses with the reason', () => {
  const r = { state: 'running', simulated: true, error: null, pausedBy: null, scope: { stage: 's2' }, updatedAt: null, stages: stages({ disabled: true }) };
  const out = roadmaps.advance(r, { runOf: () => null });
  assert.deepEqual(Array.from(out.start || []), []);
  assert.equal(out.roadmap.state, 'paused');
  assert.equal(out.roadmap.scope, null);
  assert.match(out.roadmap.error, /disabled/);
});

test('#284 issueStages: an issue planned in a disabled stage says so', () => {
  const at = roadmaps.issueStages({ stages: stages({ disabled: true }) });
  assert.equal(at.get(2).disabled, true);
  assert.equal('disabled' in at.get(1), false);
});
