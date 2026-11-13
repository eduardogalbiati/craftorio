// #749 roadmaps.endedStages: the stages a dispatch step ended, the base check's trigger in the
// service (areas/roadmap.js checkEndedStages → ctx.afterStageEnded). Developer's internal tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { endedStages } = require('../../domains/roadmap/roadmap');

const item = (id, status, extra = {}) => ({ id, workflow: 'feature.yaml', status, ...extra });
const roadmap = (...stages) => ({ stages: stages.map(([id, items, extra]) => ({ id, items, ...(extra || {}) })) });

test('#749 a stage whose last running item finished in this step ended; the next stage did not', () => {
  const before = roadmap(['s1', [item('a', 'done'), item('b', 'running')]], ['s2', [item('c', 'planned')]]);
  const after = roadmap(['s1', [item('a', 'done'), item('b', 'done')]], ['s2', [item('c', 'running')]]);
  assert.deepEqual(endedStages(before, after), ['s1']);
});

test('#749 a stage that was already finished, or still has an item at work, did not end in this step', () => {
  const before = roadmap(['s1', [item('a', 'done')]], ['s2', [item('b', 'running'), item('c', 'running')]]);
  const after = roadmap(['s1', [item('a', 'done')]], ['s2', [item('b', 'done'), item('c', 'running')]]);
  assert.deepEqual(endedStages(before, after), []);
});

test('#749 an item finished without merging (skipped, parked) ends its stage too; a failed one does not', () => {
  const before = roadmap(['s1', [item('a', 'running'), item('b', 'running')]]);
  assert.deepEqual(endedStages(before, roadmap(['s1', [item('a', 'done'), item('b', 'skipped')]])), ['s1']);
  assert.deepEqual(endedStages(before, roadmap(['s1', [item('a', 'done'), item('b', 'failed')]])), []);
});

test('#749 a disabled stage, or one with only items the filter drops (mock), starts no check', () => {
  const before = roadmap(['s1', [item('a', 'running')], { disabled: true }], ['s2', [item('m', 'running', { mock: true })]]);
  const after = roadmap(['s1', [item('a', 'done')], { disabled: true }], ['s2', [item('m', 'done', { mock: true })]]);
  assert.deepEqual(endedStages(before, after, (x) => !x.mock), []);
});
