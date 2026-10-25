// #489 where "since the last stable" starts (src/domains/releases/releases.js): a stable promoted from an rc cuts at
// that rc, found by its tag or only by its commit; a stable shipped by a cut line, without an rc,
// cuts at its own date.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergesSinceStable, issuesSinceStable, candidatesSinceStable } = require('../../src/domains/releases/releases');

const rc = (tag, commit, date, number) => ({ tag, commit, date, runId: `run-${number}`, issues: [{ number, title: `Issue ${number}`, labels: ['bug'] }] });
const shipped = (fields) => ({ version: 'v1.2.0', tag: 'v1.2.0', issues: [], runs: [], status: 'shipped', ...fields });

test('#489 a stable from a cut line (no rc, its commit no candidate) counts the candidates after its date', () => {
  const history = {
    releases: [shipped({ date: '2026-10-12T12:00:00.000Z', commit: 'f0f0f0f0' })],
    candidates: [rc('v1.2.0-rc.1', 'c1c1c1c1', '2026-10-11T10:00:00.000Z', 11), rc('v1.2.0-rc.2', 'c2c2c2c2', '2026-10-13T10:00:00.000Z', 13)],
  };
  assert.equal(mergesSinceStable(history), 1);
  assert.deepEqual(candidatesSinceStable(history).map((c) => c.tag), ['v1.2.0-rc.2']);
  assert.deepEqual(issuesSinceStable(history).map((i) => i.number), [13]);
});

test('#489 a stable matched to its rc only by the commit cuts at that rc, not at the later release date', () => {
  // promoted on the 14th from rc.1 (merged on the 11th): rc.2, merged on the 12th, is still a candidate
  const history = {
    releases: [shipped({ date: '2026-10-14T09:00:00.000Z', commit: 'c1c1c1c1' })],
    candidates: [rc('v1.2.0-rc.1', 'c1c1c1c1', '2026-10-11T10:00:00.000Z', 11), rc('v1.2.0-rc.2', 'c2c2c2c2', '2026-10-12T10:00:00.000Z', 12)],
  };
  assert.equal(mergesSinceStable(history), 1);
  assert.deepEqual(candidatesSinceStable(history).map((c) => c.tag), ['v1.2.0-rc.2']);
  assert.deepEqual(issuesSinceStable(history).map((i) => i.number), [12]);
});

test('#489 a stable matched to its rc by the rc tag cuts at that rc', () => {
  const history = {
    releases: [shipped({ date: '2026-10-14T09:00:00.000Z', commit: 'ffffffff', rc: 'v1.2.0-rc.1' })],
    candidates: [rc('v1.2.0-rc.1', 'c1c1c1c1', '2026-10-11T10:00:00.000Z', 11), rc('v1.2.0-rc.2', 'c2c2c2c2', '2026-10-12T10:00:00.000Z', 12)],
  };
  assert.deepEqual(candidatesSinceStable(history).map((c) => c.tag), ['v1.2.0-rc.2']);
});
