// #391: the Pause menu's hint for "Pause after this stage" says what the engine does: a cut line
// held before the stage in progress makes it pause at once (RoadmapModel.pendingRelease).
const test = require('node:test');
const assert = require('node:assert/strict');
const { pauseChoices, pendingRelease } = require('../roadmap-model');

const stage = (id, status) => ({ id, items: [{ id: `${id}-a`, status }] });
// #555: the cut line is a release entry of its own after the stage
const release = (status) => ({ kind: 'release', id: 'rel-1', name: 'v1', status, items: [] });

test('the after-stage hint names the stage in progress when nothing holds the roadmap', () => {
  const r = { state: 'running', stages: [stage('s1', 'done'), stage('s2', 'running')] };
  assert.match(pauseChoices(r)[0].hint, /stage 2 still start and finish/);
});

test('a cut line before the stage in progress, not shipped: the hint says the roadmap pauses now', () => {
  const r = { state: 'running', stages: [stage('s1', 'done'), release('running'), stage('s2', 'planned')] };
  assert.equal(pendingRelease(r, 2).id, 'rel-1');
  assert.match(pauseChoices(r)[0].hint, /pauses now/);
});

test('a shipped cut line does not hold the roadmap', () => {
  const r = { state: 'running', stages: [stage('s1', 'done'), release('shipped'), stage('s2', 'planned')] };
  assert.equal(pendingRelease(r, 2), null);
  assert.match(pauseChoices(r)[0].hint, /stage 2/);
});
