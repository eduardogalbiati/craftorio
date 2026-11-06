// #804: Skip can leave the roadmap paused. Acceptance tests written before the code, on the roadmap's
// file (packages/engine/domains/roadmap/roadmap.js).
//
// Interface assumed (the contract shared with the screen's and the channel's tests):
// itemAction(dir, projectId, itemId, 'skip', { alive, keepPaused: true }): on the item that paused the
// roadmap the item is skipped, the state stays `paused`, `pausedBy` and `error` are cleared (the item no
// longer blocks it, the screen stops offering it). On a skip of another item, or on retry and park, the
// option changes nothing.
//
// Guarded elsewhere, not repeated here: a skip or retry without the option
// (roadmap.test.js 'itemAction retry or skip on the item that paused the roadmap resumes it').
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-804-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const ERROR = 'Stage 1: #1 failed.';
// i1 failed and paused the roadmap, i2 failed too, i3 is planned in the next stage
function pausedRoadmap(t, first = { status: 'failed', runId: 'r1', runs: ['r1'], error: 'boom' }) {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', {
    state: 'paused', simulated: false, error: ERROR, pausedBy: 'i1', updatedAt: null,
    stages: [
      { id: 's1', items: [mkItem('i1', 1, first), mkItem('i2', 2, { status: 'failed', runId: 'r2', runs: ['r2'], error: 'also' })] },
      { id: 's2', items: [mkItem('i3', 3)] },
    ],
  });
  return dir;
}
const pause = (r) => [r.state, r.pausedBy, r.error];
// an item's stored status (the file keeps a failed item as planned: the screen reads it from its run)
const statusOf = (r, id) => r.stages.flatMap((s) => s.items).find((x) => x.id === id).status;

test('#804 skip with keepPaused on the item that paused the roadmap: the item is skipped, the roadmap stays paused and no longer blames it', (t) => {
  const r = roadmaps.itemAction(pausedRoadmap(t), 'proj', 'i1', 'skip', { alive: () => false, keepPaused: true });
  assert.deepEqual(pause(r), ['paused', null, null]);
  assert.equal(statusOf(r, 'i1'), 'skipped');
  assert.equal(r.stages[0].items[0].error, 'Skipped by the owner.');
});

test('#804 keepPaused on a skip of another item changes nothing: the item that paused it still does', (t) => {
  const r = roadmaps.itemAction(pausedRoadmap(t), 'proj', 'i2', 'skip', { alive: () => false, keepPaused: true });
  assert.deepEqual(pause(r), ['paused', 'i1', ERROR]);
  assert.equal(statusOf(r, 'i2'), 'skipped');
});

test('#804 keepPaused on a retry changes nothing: the roadmap goes on and the item is planned again', (t) => {
  const r = roadmaps.itemAction(pausedRoadmap(t), 'proj', 'i1', 'retry', { alive: () => false, keepPaused: true });
  assert.deepEqual(pause(r), ['running', null, null]);
  assert.deepEqual([statusOf(r, 'i1'), r.stages[0].items[0].runId], ['planned', null]);
});

test('#804 keepPaused on a park changes nothing: the roadmap goes on and the item is parked', (t) => {
  const dir = pausedRoadmap(t, { status: 'interrupted', runId: 'r1', runs: ['r1'] });
  const r = roadmaps.itemAction(dir, 'proj', 'i1', 'park', { runOf: () => ({ status: 'interrupted', waiting: true, gate: 'Review' }), keepPaused: true });
  assert.deepEqual(pause(r), ['running', null, null]);
  assert.equal(statusOf(r, 'i1'), 'parked');
});

// skipClosed from the dispatch is also guarded in packages/engine/test/service/roadmap.test.js
// ('roadmap: #168 a simulated roadmap ... skips a cached-closed issue'); no test held skipItem's state
test('#804 the automatic skips (skipClosed, base-health skipItem) leave the state, pausedBy and error of a paused roadmap as they were', (t) => {
  const closed = roadmaps.skipClosed(pausedRoadmap(t), 'proj', 'i3');
  const health = roadmaps.skipItem(pausedRoadmap(t), 'proj', 'i3', 'A live run has the issue.');
  assert.deepEqual([pause(closed), closed.stages[1].items[0].error], [['paused', 'i1', ERROR], 'Every issue is closed.']);
  assert.deepEqual([pause(health), health.stages[1].items[0].error], [['paused', 'i1', ERROR], 'A live run has the issue.']);
});
