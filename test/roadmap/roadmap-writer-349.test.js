// #349: src/domains/roadmap/roadmap.js is the only writer of a roadmap's state; pauseRoadmap and finishRoadmap are
// the pure writes other modules ask for (src/domains/roadmap/live-roadmap.js after a refill).
const test = require('node:test');
const assert = require('node:assert/strict');
const roadmaps = require('../../src/domains/roadmap/roadmap');

const freeze = (o) => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
};
const running = () => freeze({
  state: 'running', simulated: true, error: 'old error', pausedBy: 'i1', scope: { stage: 's1' }, live: true, budget: null,
  stages: [{ id: 's1', name: 'Stage 1', note: '', items: [{ id: 'i1', status: 'done', runId: 'run-1', runs: ['run-1'], error: null }] }],
  updatedAt: null,
});

test('pauseRoadmap pauses with the message and nobody to blame, keeping the rest', () => {
  const r = running();
  const out = roadmaps.pauseRoadmap(r, 'The refill failed: no issue left.');
  assert.equal(out.state, 'paused');
  assert.equal(out.pausedBy, null);
  assert.equal(out.error, 'The refill failed: no issue left.');
  assert.deepEqual(out.scope, { stage: 's1' });
  assert.equal(out.live, true);
  assert.deepEqual(out.stages, r.stages);
  assert.equal(r.state, 'running');
});

test('finishRoadmap ends the roadmap: done, error, pause and scope cleared', () => {
  const r = running();
  const out = roadmaps.finishRoadmap(r);
  assert.equal(out.state, 'done');
  assert.equal(out.error, null);
  assert.equal(out.pausedBy, null);
  assert.equal(out.scope, null);
  assert.equal(out.live, true);
  assert.deepEqual(out.stages, r.stages);
  assert.equal(r.state, 'running');
});
