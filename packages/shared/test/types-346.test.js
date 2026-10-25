// #346: packages/shared/types.js's one value, RUN_EVENT_TYPES, lists exactly the `type`s of the RunEvent
// union its typedefs declare (the checker only proves each listed one is a member).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'types.js');

test('#346 RUN_EVENT_TYPES is the sorted list of every RunEvent type the typedefs declare', () => {
  const { RUN_EVENT_TYPES } = require(file);
  const text = fs.readFileSync(file, 'utf8');
  const declared = [...text.matchAll(/@typedef \{EventEnvelope & \{ type: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(declared.length > 40, 'the typedefs declare the event types');
  assert.deepEqual(RUN_EVENT_TYPES, [...declared].sort());
  assert.equal(new Set(RUN_EVENT_TYPES).size, RUN_EVENT_TYPES.length);
});
