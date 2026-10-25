// #489 releases as "rc + stable" (src/releases.js): acceptance tests written before the code.
// Contract for the developer (every new name is reached inside each test):
//   history file <workspace>/releases/<project>.json gains `candidates`: [{ tag: 'vX.Y.Z-rc.N', commit,
//     date, runId, issues: [{ number, title, labels? }], held?: boolean }] (one rc per merge to main);
//     readReleases(dir, projectId) returns it as `candidates` (a list, [] when missing).
//   rcTag({ version, mergesSinceStable })      → 'vX.Y.Z-rc.N' (a leading "v" added when missing)
//   mergesSinceStable(history)                 → the candidates dated after the last stable release
//   issuesSinceStable(history)                 → the issues of those candidates, deduplicated, by number
//   stableVersion({ history, version? })       → { version, bump }: src/shared/release-version.js's
//     suggestion over issuesSinceStable from the last stable (breaking major, enhancement minor, else
//     patch); an explicit `version` (the owner's edit) wins
//   holdCandidate(dir, projectId, tag, held = true)  sets / clears the candidate's `held`
//   promoteRelease({ dir, projectId, commit, version?, tagCommit })  async: the candidate of `commit`
//     is promoted: tagCommit({ tag, commit }) tags that same commit as the stable `vX.Y.Z` (the
//     injected git/gh boundary; the real one tags and pushes the tag), and the stable release is
//     recorded (status 'shipped', tag, commit, rc: the candidate's tag, issues since the last stable,
//     notes from releaseNotes listing them). A commit without an rc is refused (an Error whose
//     message names the missing rc) and nothing is tagged nor recorded.
//   → { tag, version, commit, rc }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../src/releases');

const STABLE = { version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-10T10:00:00.000Z', commit: 'c0c0c0c0', issues: [{ number: 12, title: 'Add a health endpoint' }], runs: ['run-a'], status: 'shipped' };
const rc = (tag, commit, date, runId, number, title, labels) => ({ tag, commit, date, runId, issues: [{ number, title, labels }] });
const CANDIDATES = [
  rc('v1.2.0-rc.1', 'c0c0c0c0', '2026-10-09T10:00:00.000Z', 'run-a', 12, 'Add a health endpoint', ['enhancement']),
  rc('v1.3.0-rc.1', 'c1c1c1c1', '2026-10-12T10:00:00.000Z', 'run-b', 15, 'Refund a failed payment', ['bug']),
  rc('v1.3.0-rc.2', 'c2c2c2c2', '2026-10-13T10:00:00.000Z', 'run-c', 16, 'Export runs as CSV', ['enhancement']),
];
const HISTORY = { releases: [STABLE], candidates: CANDIDATES, next: { notes: '' } };

function workspace(t, history = HISTORY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-489-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'p1.json'), JSON.stringify(history, null, 2));
  return dir;
}
const recorder = () => {
  const calls = [];
  const fn = async ({ tag, commit }) => { calls.push({ tag, commit }); };
  return { calls, fn };
};

test('#489 rcTag: the rc number is the merges since the last stable', () => {
  const { rcTag } = load();
  assert.equal(rcTag({ version: '1.3.0', mergesSinceStable: 3 }), 'v1.3.0-rc.3');
  assert.equal(rcTag({ version: 'v2.0.0', mergesSinceStable: 1 }), 'v2.0.0-rc.1');
});

test('#489 mergesSinceStable counts the candidates after the last stable (all of them before the first one)', () => {
  const { mergesSinceStable } = load();
  assert.equal(mergesSinceStable(HISTORY), 2);
  assert.equal(mergesSinceStable({ releases: [], candidates: CANDIDATES }), 3);
  assert.equal(mergesSinceStable({ releases: [STABLE], candidates: [CANDIDATES[0]] }), 0);
});

test('#489 issuesSinceStable lists only the issues merged since the last stable', () => {
  const { issuesSinceStable } = load();
  assert.deepEqual(issuesSinceStable(HISTORY).map((i) => i.number), [15, 16]);
});

test('#489 stableVersion: an enhancement since the last stable is a minor', () => {
  const { stableVersion } = load();
  const out = stableVersion({ history: HISTORY });
  assert.equal(out.version, 'v1.3.0');
  assert.equal(out.bump, 'minor');
});

test('#489 stableVersion: breaking is a major, only bugs a patch', () => {
  const { stableVersion } = load();
  const breaking = { ...HISTORY, candidates: [...CANDIDATES, rc('v1.3.0-rc.3', 'c3c3c3c3', '2026-10-14T10:00:00.000Z', 'run-d', 17, 'Drop the old API', ['breaking'])] };
  assert.equal(stableVersion({ history: breaking }).version, 'v2.0.0');
  const bugs = { ...HISTORY, candidates: CANDIDATES.slice(0, 2) };
  assert.equal(stableVersion({ history: bugs }).version, 'v1.2.1');
});

test('#489 stableVersion: the owner\'s version wins (editable)', () => {
  const { stableVersion } = load();
  assert.equal(stableVersion({ history: HISTORY, version: 'v1.5.0' }).version, 'v1.5.0');
});

test('#489 readReleases keeps the candidates of the history file', (t) => {
  const dir = workspace(t);
  const h = load().readReleases(dir, 'p1');
  assert.deepEqual((h.candidates || []).map((c) => c.tag), ['v1.2.0-rc.1', 'v1.3.0-rc.1', 'v1.3.0-rc.2']);
  assert.equal(h.releases.length, 1);
});

test('#489 holdCandidate puts a candidate on hold and takes it off', (t) => {
  const dir = workspace(t);
  const { holdCandidate, readReleases } = load();
  holdCandidate(dir, 'p1', 'v1.3.0-rc.2', true);
  const held = (tag) => !!(readReleases(dir, 'p1').candidates || []).find((c) => c.tag === tag)?.held;
  assert.equal(held('v1.3.0-rc.2'), true);
  assert.equal(held('v1.3.0-rc.1'), false);
  holdCandidate(dir, 'p1', 'v1.3.0-rc.2', false);
  assert.equal(held('v1.3.0-rc.2'), false);
});

test('#489 promoteRelease refuses a commit without an rc, says why, tags and records nothing', async (t) => {
  const dir = workspace(t);
  const { promoteRelease, readReleases } = load();
  const tagger = recorder();
  await assert.rejects(
    promoteRelease({ dir, projectId: 'p1', commit: 'ffffffff', tagCommit: tagger.fn }),
    (e) => e instanceof Error && /\brc\b|release candidate/i.test(e.message),
  );
  assert.equal(tagger.calls.length, 0);
  assert.equal(readReleases(dir, 'p1').releases.length, 1);
});

test('#489 promoteRelease tags the rc\'s own commit as the stable version and records it', async (t) => {
  const dir = workspace(t);
  const { promoteRelease, readReleases } = load();
  const tagger = recorder();
  const out = await promoteRelease({ dir, projectId: 'p1', commit: 'c2c2c2c2', tagCommit: tagger.fn });
  assert.deepEqual(tagger.calls, [{ tag: 'v1.3.0', commit: 'c2c2c2c2' }]);
  assert.equal(out.tag, 'v1.3.0');
  assert.equal(out.rc, 'v1.3.0-rc.2');
  const last = readReleases(dir, 'p1').releases.find((r) => r.tag === 'v1.3.0');
  assert.ok(last, 'the stable release is recorded');
  assert.equal(last.commit, 'c2c2c2c2');
  assert.equal(last.status, 'shipped');
  assert.equal(last.rc, 'v1.3.0-rc.2');
});

test('#489 the promoted release lists the issues since the last stable, not the older ones', async (t) => {
  const dir = workspace(t);
  const { promoteRelease, readReleases } = load();
  await promoteRelease({ dir, projectId: 'p1', commit: 'c2c2c2c2', tagCommit: recorder().fn });
  const last = readReleases(dir, 'p1').releases.find((r) => r.tag === 'v1.3.0');
  assert.deepEqual((last.issues || []).map((i) => i.number), [15, 16]);
  const notes = String(last.notes || '');
  assert.equal(notes.includes('#15'), true);
  assert.equal(notes.includes('#16'), true);
  assert.equal(notes.includes('#12'), false);
});

test('#489 promoteRelease takes the owner\'s edited version', async (t) => {
  const dir = workspace(t);
  const tagger = recorder();
  const out = await load().promoteRelease({ dir, projectId: 'p1', commit: 'c2c2c2c2', version: 'v1.4.0', tagCommit: tagger.fn });
  assert.deepEqual(tagger.calls, [{ tag: 'v1.4.0', commit: 'c2c2c2c2' }]);
  assert.equal(out.version, 'v1.4.0');
});
