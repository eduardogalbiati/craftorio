// #117 (developer's tests): offeredAnswer, the one rule that keeps a recommendation among the gate's answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { offeredAnswer, gateBrief } = require('../engine/gate-summary');

test('#117 offeredAnswer matches the gate\'s answer in any case and returns its id', () => {
  assert.equal(offeredAnswer('Retry', ['retry', 'stop']), 'retry');
});

test('#117 offeredAnswer is null for an answer the gate does not offer, or none', () => {
  assert.equal(offeredAnswer('approve', ['retry', 'stop']), null);
  assert.equal(offeredAnswer('', ['retry']), null);
});

test('#117 the card drops a supervisor recommendation the gate does not offer', () => {
  const brief = gateBrief({ diagnosis: { recommend: 'approve', recommendation: 'free Git writing' }, answers: [{ id: 'retry' }, { id: 'stop' }] });
  assert.equal(brief.recommendation, null);
});
