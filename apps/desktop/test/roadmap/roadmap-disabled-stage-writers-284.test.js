// #284 Disable a roadmap stage: what the review of the first round added (the developer's own tests).
// - apps/desktop/host/keep-awake.js keepAwakeLabel / workToDo: the disabled stages are said apart in the status
//   line ("roadmap stage 3/6 (1 disabled)"); a roadmap without one reads as before.
// - packages/engine/domains/roadmap/roadmap.js saveStages / restoreStages: a stage with a running item is not disabled by any
//   writer (the screen's Disable is off then); enabling it, or keeping it disabled, still saves.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { keepAwakeLabel, workToDo } = require('../../host/keep-awake');
const roadmaps = require('@multiagent/engine/domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-disabled-writers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const write = (dir, stages) => fs.writeFileSync(path.join(dir, 'p1.roadmap.json'),
  JSON.stringify({ state: 'running', simulated: true, error: null, pausedBy: null, scope: null, updatedAt: null, stages }));
const sent = (stage, over = {}) => ({ id: stage.id, name: stage.name, items: stage.items.map((x) => ({ id: x.id, workflow: x.workflow, number: x.number })), ...over });

test('#284 keep awake: the status line says the disabled stages apart', () => {
  const work = workToDo({ runs: [{ waiting: false }], roadmaps: [{ projectId: 'p1', state: 'running', stage: 3, of: 6, disabled: 1 }] });
  assert.equal(work.roadmaps[0].disabled, 1);
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work }), 'Active: 1 run, roadmap stage 3/6 (1 disabled)');
});

test('#284 keep awake: a roadmap without a disabled stage reads as before', () => {
  const work = workToDo({ roadmaps: [{ projectId: 'p1', state: 'running', stage: 3, of: 6, disabled: 0 }] });
  assert.equal('disabled' in work.roadmaps[0], false);
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work }), 'Active: roadmap stage 3/6');
});

test('#284 save: disabling a stage whose item runs is refused, with the reason; the file is unchanged', (t) => {
  const dir = tmp(t);
  const stages = [
    { id: 's1', name: 'One', note: '', items: [mkItem('a', 1, { status: 'running', runId: 'live', runs: ['live'] })] },
    { id: 's2', name: 'Two', note: '', items: [mkItem('b', 2)] },
  ];
  write(dir, stages);
  assert.throws(() => roadmaps.saveStages(dir, 'p1', [sent(stages[0], { disabled: true }), sent(stages[1])]), /running.*before disabling/i);
  assert.equal(roadmaps.readRoadmap(dir, 'p1').stages.some((s) => s.disabled), false);
  // a stage with nothing running is disabled as usual
  roadmaps.saveStages(dir, 'p1', [sent(stages[0]), sent(stages[1], { disabled: true })]);
  assert.deepEqual(roadmaps.readRoadmap(dir, 'p1').stages.map((s) => !!s.disabled), [false, true]);
});

test('#284 save: a disabled stage with a running item (a file edited outside) keeps the switch and can be enabled', (t) => {
  const dir = tmp(t);
  const stages = [{ id: 's1', name: 'One', note: '', disabled: true, items: [mkItem('a', 1, { status: 'running', runId: 'live', runs: ['live'] })] }];
  write(dir, stages);
  roadmaps.saveStages(dir, 'p1', [sent(stages[0], { name: 'Renamed' })]);
  assert.equal(roadmaps.readRoadmap(dir, 'p1').stages[0].disabled, true);
  roadmaps.saveStages(dir, 'p1', [sent(stages[0], { disabled: false })]);
  assert.equal('disabled' in roadmaps.readRoadmap(dir, 'p1').stages[0], false);
});

test('#284 restore: an Undo that would disable a stage whose item started meanwhile is refused', (t) => {
  const dir = tmp(t);
  const stages = [{ id: 's1', name: 'One', note: '', items: [mkItem('a', 1, { status: 'running', runId: 'live', runs: ['live'] })] }];
  write(dir, stages);
  assert.throws(() => roadmaps.restoreStages(dir, 'p1', (now) => now.map((s) => ({ ...s, disabled: true }))), /running.*before disabling/i);
  assert.equal('disabled' in roadmaps.readRoadmap(dir, 'p1').stages[0], false);
});

// The file stores an item whose run is in progress as `planned` with its runId (packages/engine/domains/roadmap/roadmap.js
// persisted): a running run is told by the service's `alive(runId)`, as for propose / dropIssues /
// itemAction. The cases above store `status: 'running'`, which the file never holds.
const alive = (id) => id === 'live';
const stored = () => [
  { id: 's1', name: 'One', note: '', items: [mkItem('a', 1, { runId: 'live', runs: ['live'] })] },
  { id: 's2', name: 'Two', note: '', items: [mkItem('b', 2, { runId: 'gone', runs: ['gone'] })] },
];

test('#284 save: disabling a stage whose run is alive (stored planned with its runId) is refused; a finished run does not block', (t) => {
  const dir = tmp(t);
  const stages = stored();
  write(dir, stages);
  assert.throws(() => roadmaps.saveStages(dir, 'p1', [sent(stages[0], { disabled: true }), sent(stages[1])], { alive }), /running.*before disabling/i);
  assert.equal(roadmaps.readRoadmap(dir, 'p1').stages.some((s) => s.disabled), false);
  roadmaps.saveStages(dir, 'p1', [sent(stages[0]), sent(stages[1], { disabled: true })], { alive });
  assert.deepEqual(roadmaps.readRoadmap(dir, 'p1').stages.map((s) => !!s.disabled), [false, true]);
});

test('#284 restore: an Undo that would disable a stage whose run is alive (stored planned with its runId) is refused', (t) => {
  const dir = tmp(t);
  write(dir, stored());
  assert.throws(() => roadmaps.restoreStages(dir, 'p1', (now) => now.map((s) => ({ ...s, disabled: s.id === 's1' })), { alive }), /running.*before disabling/i);
  assert.equal('disabled' in roadmaps.readRoadmap(dir, 'p1').stages[0], false);
});
