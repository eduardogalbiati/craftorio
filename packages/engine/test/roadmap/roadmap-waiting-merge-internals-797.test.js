// #797 internals the acceptance tests do not reach: where a PR known by its number lives, a parked item
// whose run ends with an open PR, and a stage whose paused run sits next to an item waiting for its merge.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prOnProject } = require('../../domains/run/run-pr');
const roadmaps = require('../../domains/roadmap/roadmap');
const RoadmapModel = require('@multiagent/shared/roadmap-model');

const PR = { number: 7, url: null };
const item = (id, status, extra = {}) => ({ id, workflow: 'w.yaml', number: 1, status, runId: `run-${id}`, runs: [], error: null, ...extra });
const roadmap = (items, extra = {}) => ({ state: 'running', stages: [{ id: 's1', items }, { id: 's2', items: [{ id: 'next', workflow: 'w.yaml', number: 2, status: 'planned', runId: null, error: null }] }], ...extra });
const waiting = { status: 'success', merged: false, pr: { number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' } };

test('#797 prOnProject: a number becomes a URL on the upstream, on the repository without a fork, in the platform\'s form', () => {
  assert.equal(prOnProject(PR, { repo: 'https://github.com/me/r', fork: { upstream: 'git@github.com:up/r.git' } }).url, 'https://github.com/up/r/pull/7');
  assert.equal(prOnProject(PR, { repo: 'https://github.com/o/r.git' }).url, 'https://github.com/o/r/pull/7');
  assert.equal(prOnProject(PR, { repo: 'https://gitlab.com/g/s/r' }).url, 'https://gitlab.com/g/s/r/-/merge_requests/7');
});

test('#797 prOnProject: a PR with its URL stays, and one no project places keeps none', () => {
  const pr = { number: 7, url: 'https://github.com/o/r/pull/7' };
  assert.equal(prOnProject(pr, { repo: 'https://github.com/x/y' }), pr);
  assert.equal(prOnProject(PR, null).url, null);
  assert.equal(prOnProject(PR, { repo: 'not a url' }).url, null);
});

test('#797 a parked item whose run ended with an open PR stays parked, with its PR, and never holds the stage', () => {
  const parked = { at: null, gate: 'Check' };
  const { roadmap: r, start } = roadmaps.advance(roadmap([item('a', 'parked', { parked })]), { runOf: () => waiting });
  assert.deepEqual([r.stages[0].items[0].status, r.stages[0].items[0].pr?.number], ['parked', 7]);
  assert.deepEqual(start.map((x) => x.id), ['next']);
});

test('#797 a parked item takes the merge commit, and a closed PR fails it without pausing the roadmap', () => {
  const parked = { at: null, gate: 'Check' };
  const merged = roadmaps.advance(roadmap([item('a', 'parked', { parked })]), { runOf: () => ({ status: 'success', merged: true, mergedCommit: 'abc' }) }).roadmap.stages[0].items[0];
  assert.deepEqual([merged.status, merged.mergedCommit], ['done', 'abc']);
  const closed = roadmaps.advance(roadmap([item('a', 'parked', { parked })]), { runOf: () => ({ ...waiting, prClosed: true }) });
  assert.equal(closed.roadmap.stages[0].items[0].status, 'failed');
  assert.equal(closed.roadmap.state, 'running');
});

test('#797 a paused run next to an item waiting for its merge still pauses the roadmap for Resume', () => {
  const runOf = (id) => (id === 'run-a' ? waiting : { status: 'paused' });
  const { roadmap: r } = roadmaps.advance(roadmap([item('a', 'planned'), item('b', 'planned')]), { runOf });
  assert.deepEqual([r.state, r.pausedStage, r.pausedBy ?? null], ['paused', 's1', null]);
});

test('#797 an item that only waits holds its stage with the roadmap running, and nothing of it is stored', () => {
  const { roadmap: r, start } = roadmaps.advance(roadmap([item('a', 'planned')]), { runOf: () => waiting });
  assert.deepEqual([r.state, start.length, r.stages[0].items[0].status], ['running', 0, 'waiting_merge']);
  const stored = roadmaps.persisted(r).stages[0].items[0];
  assert.deepEqual([stored.status, 'pr' in stored], ['planned', false]);
});

test('#797 a waiting item stays in every date range and is named by mergeWaits', () => {
  const x = item('a', 'waiting_merge', { pr: { number: 7 }, run: { finishedAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(RoadmapModel.inRange(x, 1000, Date.now()), true);
  assert.equal(RoadmapModel.mergeWaits({ stages: [{ items: [x, { ...x, pr: { number: 8 } }, item('b', 'done')] }] }), '#7, #8');
  assert.equal(RoadmapModel.mergeWaits({ stages: [{ items: [item('b', 'done')] }] }), '');
});
