// #357 internals: one rule for "the issue is still in the roadmap" (unfinishedNumbers, read by pickNext,
// refactor:addToRoadmap and the tab's roadmapUnfinished) and one for a proposal's files (filesOf).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cadence = require('../../src/domains/refactor/refactor-cadence');

const roadmap = {
  stages: [{ name: 'One', items: [
    { status: 'failed', parked: { at: '2026-10-10T00:00:00Z' }, issues: [{ number: 7 }] },
    { status: 'failed', issues: [{ number: 8 }] },
    { status: 'done', issues: [{ number: 9 }] },
  ] }],
};

test('a failed and parked item is finished: the cadence can pick its proposal again', () => {
  const busy = cadence.unfinishedNumbers(roadmap);
  assert.deepEqual([...busy], [8]);
  const pick = cadence.pickNext([{ id: 'a', rank: 1, issue: 8 }, { id: 'b', rank: 2, issue: 7 }], roadmap);
  assert.equal(pick.id, 'b');
});

test('withIssueStatus serves roadmapUnfinished and targetFiles from the shared rules', () => {
  const stages = new Map([[7, { stage: 1, status: 'failed' }], [8, { stage: 1, status: 'failed' }]]);
  const [parked, failed] = cadence.withIssueStatus(
    [{ id: 'b', issue: 7, files: [{ path: 'src/a.js' }, 'src/b.js'], target: 'src/a.js' }, { id: 'a', issue: 8, files: [{ file: 'src/c.js' }] }],
    stages, [], cadence.unfinishedNumbers(roadmap),
  );
  assert.equal(parked.roadmapUnfinished, false);
  assert.equal(failed.roadmapUnfinished, true);
  assert.deepEqual(parked.targetFiles, ['src/a.js', 'src/b.js']);
  assert.deepEqual(failed.targetFiles, ['src/c.js']);
});
