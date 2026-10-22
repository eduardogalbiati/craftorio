// #435 review: the waiting refactor stage stays last when the owner adds a stage after it (the
// Backlog's add stage, a move to a new last stage), and Send to Refactor finds it wherever it is.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanStages } = require('../src/roadmap');
const { dropWaitingSuffix, placeWaiting, WAITING_STAGE_NAME } = require('../src/refactor-cadence');

const item = (id, number, files = []) => ({ id, workflow: 'refactor', number, title: `Issue ${number}`, status: 'planned', files });
const previous = {
  stages: [
    { id: 's1', name: 'One', items: [item('i1', 1)] },
    { id: 'sw', name: WAITING_STAGE_NAME, disabled: true, waiting: true, items: [item('i2', 2)] },
  ],
};

test('a stage the owner adds after the waiting stage goes before it', () => {
  const saved = cleanStages([...previous.stages, { name: '', note: '', items: [item(null, 3)] }], { previous });
  assert.deepEqual(saved.map((s) => s.id === 'sw'), [false, false, true]);
  assert.equal(saved[2].waiting, true);
});

test('a reorder of stored stages is kept as asked', () => {
  const saved = cleanStages([previous.stages[1], previous.stages[0]], { previous });
  assert.deepEqual(saved.map((s) => s.id), ['sw', 's1']);
});

test('placeWaiting finds a waiting stage that is no longer last', () => {
  const roadmap = { stages: [previous.stages[1], { id: 's3', name: 'After', items: [item('i3', 3)] }] };
  assert.deepEqual(placeWaiting({ roadmap, files: [] }), { stage: 0, item: -1 });
});

test('dropWaitingSuffix removes only the waiting suffix', () => {
  assert.equal(dropWaitingSuffix(WAITING_STAGE_NAME), 'Refactor');
  assert.equal(dropWaitingSuffix('Cleanup'), 'Cleanup');
});
