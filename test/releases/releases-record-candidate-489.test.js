// #489 recordCandidate (src/domains/releases/releases.js): a push of the base is one release candidate, numbered
// after the merges since the last stable; the same commit is recorded once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const releases = require('../../src/domains/releases/releases');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-record-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('#489 recordCandidate numbers the rcs since the last stable and keeps a commit once', (t) => {
  const dir = tmp(t);
  releases.recordRelease(dir, 'p', { version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-01T00:00:00.000Z' });
  const a = releases.recordCandidate(dir, 'p', { commit: 'aaa', version: '1.3.0', runId: 'r1', issues: [{ number: 5, labels: ['bug'] }], date: '2026-10-02T00:00:00.000Z' });
  const b = releases.recordCandidate(dir, 'p', { commit: 'bbb', version: '1.3.0', date: '2026-10-03T00:00:00.000Z' });
  assert.equal(a.tag, 'v1.3.0-rc.1');
  assert.equal(b.tag, 'v1.3.0-rc.2');
  assert.equal(releases.recordCandidate(dir, 'p', { commit: 'aaa', version: '1.3.0' }).tag, 'v1.3.0-rc.1');
  const h = releases.readReleases(dir, 'p');
  assert.deepEqual(h.candidates.map((c) => c.tag), ['v1.3.0-rc.1', 'v1.3.0-rc.2']);
  assert.equal(h.releases.length, 1, 'the stable release is kept');
  assert.throws(() => releases.recordCandidate(dir, 'p', { commit: 'ccc', version: ' ' }), /commit and a version/);
});

test('#489 promoting an older rc keeps the later ones as candidates (the cut is the rc, not the promotion time)', async (t) => {
  const dir = tmp(t);
  const day = (d) => `2026-10-0${d}T00:00:00.000Z`;
  releases.recordCandidate(dir, 'p', { commit: 'aaa', version: '1.3.0', issues: [{ number: 1, labels: ['bug'] }], date: day(1) });
  releases.recordCandidate(dir, 'p', { commit: 'bbb', version: '1.3.0', issues: [{ number: 2, labels: ['bug'] }], date: day(2) });
  releases.recordCandidate(dir, 'p', { commit: 'ccc', version: '1.3.0', issues: [{ number: 3, labels: ['enhancement'] }], date: day(3) });
  await releases.promoteRelease({ dir, projectId: 'p', commit: 'bbb', version: '1.3.0', tagCommit: async () => {}, date: day(5) });
  const h = releases.readReleases(dir, 'p');
  assert.deepEqual(releases.candidatesSinceStable(h).map((c) => c.tag), ['v1.3.0-rc.3']);
  assert.equal(releases.mergesSinceStable(h), 1);
  assert.deepEqual(releases.issuesSinceStable(h).map((i) => i.number), [3]);
  assert.equal(releases.recordCandidate(dir, 'p', { commit: 'ddd', version: '1.4.0', date: day(6) }).tag, 'v1.4.0-rc.2');
});

test('#489 a history without candidates reads as before (no candidates key)', (t) => {
  const dir = tmp(t);
  releases.recordRelease(dir, 'p', { version: 'v1', tag: 'v1', date: '2026-01-01T00:00:00Z' });
  assert.equal('candidates' in releases.readReleases(dir, 'p'), false);
});
