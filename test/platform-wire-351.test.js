// #351: nothing changes on the wire when the GitHub / GitLab branches move into the platform adapters.
// test/fixtures/platform-wire-351.json was recorded before the change: for every operation and
// platform (test/platform-wire-351-cases.js), the exact CLI calls built with the injected exec and the
// objects the parsers return on recorded CLI outputs. The same snapshot must hold after.
// Seams: the public functions of src/domains/backlog/backlog.js, src/domains/backlog/epics.js, src/domains/oracle/oracle-platform.js, src/domains/run/run-pr.js,
// src/engine/probes.js and packages/shared/backlog-archive.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES } = require('./platform-wire-351-cases');
const RECORDED = require('./fixtures/platform-wire-351.json');

test('every recorded operation still has its case, and every case its recording', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(RECORDED).sort());
});

test('each platform has every operation recorded (issues, labels, requests, epics, the Oracle)', () => {
  for (const op of ['list issues', 'view an issue', 'create an issue', 'close an issue', 'archive an issue', 'restore an issue', 'read labels', 'oracle labels', 'search issues', 'cli target']) {
    for (const p of ['github', 'gitlab']) assert.ok(Object.keys(RECORDED).some((k) => k.startsWith(`${p}: ${op}`)), `${p}: ${op}`);
  }
});

for (const [name, run] of Object.entries(CASES)) {
  test(`wire snapshot: ${name}`, async () => {
    const got = await run();
    assert.deepEqual(got, RECORDED[name]);
  });
}
