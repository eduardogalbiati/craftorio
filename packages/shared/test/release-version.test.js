// #436 the next release's version, suggested from what it ships. Acceptance tests written before the
// code, for the new pure module packages/shared/release-version.js (loads in node with require and in the
// renderer with a <script>, as window.ReleaseVersion, like packages/shared/roadmap-model.js).
//
// The API these tests ask for:
// - suggestVersion({ last, issues }) → { version, bump, counts, reason }
//     `last`: the last shipped release's name (a string, or null / undefined when nothing shipped yet);
//     `issues`: the issues the next release ships, [{ number, labels: string[] }].
//     `version`: the suggested name ('' when none can be suggested); a leading "v" of `last` is kept.
//     `bump`: 'major' (an issue labelled breaking), 'minor' (an enhancement), 'patch' (only bugs,
//       documentation or nothing else), 'first' (no shipped release: '1.0.0'), null (no suggestion).
//     `counts`: { breaking, enhancement, bug, documentation }, the issues per label (numbers).
//     `reason`: { key, values }: an i18n key (never an English sentence) and its values.
// - recentReleases(releases, n = 3) → the last n shipped releases of releases:list's `releases`
//     ({ version, date, issues, ... }; the history is all shipped; an entry with a `status` other
//     than 'shipped' is not), newest first by date.
// Labels are matched case-insensitively by name ("breaking" / "breaking change", "enhancement",
// "bug", "documentation"); these tests use GitHub's default label names.
const test = require('node:test');
const assert = require('node:assert/strict');

// loaded inside each test: the module is created by the change
const load = () => require('../release-version');

const issue = (number, ...labels) => ({ number, labels });

// ---- suggestVersion ----------------------------------------------------------------------------------

test('#436 only bugs and documentation suggest a patch: 1.1.2 → 1.1.3', () => {
  const out = load().suggestVersion({ last: '1.1.2', issues: [issue(1, 'bug'), issue(2, 'documentation'), issue(3, 'bug')] });
  assert.equal(out.version, '1.1.3');
  assert.equal(out.bump, 'patch');
});

test('#436 an enhancement suggests a minor: 1.1.2 → 1.2.0', () => {
  const out = load().suggestVersion({ last: '1.1.2', issues: [issue(1, 'bug'), issue(2, 'enhancement')] });
  assert.equal(out.version, '1.2.0');
  assert.equal(out.bump, 'minor');
});

test('#436 a breaking label suggests a major: 1.1.2 → 2.0.0', () => {
  const out = load().suggestVersion({ last: '1.1.2', issues: [issue(1, 'enhancement'), issue(2, 'breaking'), issue(3, 'bug')] });
  assert.equal(out.version, '2.0.0');
  assert.equal(out.bump, 'major');
});

test('#436 a last release named with a leading "v" keeps it: v1.4.0 → v1.5.0', () => {
  const out = load().suggestVersion({ last: 'v1.4.0', issues: [issue(1, 'enhancement')] });
  assert.equal(out.version, 'v1.5.0');
  assert.equal(out.bump, 'minor');
});

test('#436 no shipped release yet suggests 1.0.0 with bump "first"', () => {
  const { suggestVersion } = load();
  for (const last of [null, undefined, '']) {
    const out = suggestVersion({ last, issues: [issue(1, 'bug')] });
    assert.equal(out.version, '1.0.0', `last ${JSON.stringify(last)}`);
    assert.equal(out.bump, 'first', `last ${JSON.stringify(last)}`);
  }
});

test('#436 a last release whose name is not a version ("Spring drop") suggests nothing, with a reason key', () => {
  const out = load().suggestVersion({ last: 'Spring drop', issues: [issue(1, 'enhancement')] });
  assert.equal(out.version, '');
  assert.equal(out.bump, null);
  assert.equal(typeof out.reason?.key, 'string');
  assert.ok(out.reason.key.length > 0, 'a reason key');
  assert.doesNotMatch(out.reason.key, /\s/, `an i18n key, not a sentence: ${out.reason.key}`);
  assert.equal(typeof out.reason.values, 'object');
});

test('#436 the reason of a suggestion is an i18n key with its values, not a sentence', () => {
  const out = load().suggestVersion({ last: '1.1.2', issues: [issue(1, 'enhancement')] });
  assert.equal(typeof out.reason?.key, 'string');
  assert.ok(out.reason.key.length > 0);
  assert.doesNotMatch(out.reason.key, /\s/, `an i18n key, not a sentence: ${out.reason.key}`);
  assert.equal(typeof out.reason.values, 'object');
  assert.notEqual(out.reason.values, null);
});

test('#436 counts: 6 enhancements and 3 bugs', () => {
  const issues = [
    ...[1, 2, 3, 4, 5, 6].map((n) => issue(n, 'enhancement')),
    ...[7, 8, 9].map((n) => issue(n, 'bug')),
  ];
  const out = load().suggestVersion({ last: '1.1.2', issues });
  assert.equal(out.counts.enhancement, 6);
  assert.equal(out.counts.bug, 3);
  assert.equal(out.counts.breaking, 0);
  assert.equal(out.counts.documentation, 0);
  assert.equal(out.version, '1.2.0');
});

test('#436 suggestVersion is deterministic: the same input gives the same answer', () => {
  const { suggestVersion } = load();
  const input = () => ({ last: '1.1.2', issues: [issue(3, 'bug'), issue(1, 'enhancement'), issue(2, 'documentation')] });
  const a = JSON.stringify(suggestVersion(input()));
  const b = JSON.stringify(suggestVersion(input()));
  assert.equal(a, b);
});

// ---- recentReleases ------------------------------------------------------------------------------------

const rel = (version, date, issues = 1, extra = {}) => ({ version, date, issues: Array.from({ length: issues }, (_, k) => ({ number: k + 1, title: '' })), ...extra });

test('#436 recentReleases keeps the shipped releases only, newest first, at most 3', () => {
  const list = [
    rel('1.0.0', '2026-09-01T10:00:00.000Z'),
    rel('1.1.2', '2026-10-13T10:00:00.000Z', 4),
    rel('1.2.0', '2026-10-20T10:00:00.000Z', 2, { status: 'checking' }), // not shipped
    rel('1.1.0', '2026-10-01T10:00:00.000Z'),
    rel('1.1.1', '2026-10-07T10:00:00.000Z'),
  ];
  const out = load().recentReleases(list);
  assert.equal(out.map((x) => x.version).join(','), '1.1.2,1.1.1,1.1.0');
});

test('#436 recentReleases takes n', () => {
  const list = [rel('1.0.0', '2026-09-01T10:00:00.000Z'), rel('1.1.0', '2026-10-01T10:00:00.000Z'), rel('1.1.1', '2026-10-07T10:00:00.000Z')];
  assert.equal(load().recentReleases(list, 2).map((x) => x.version).join(','), '1.1.1,1.1.0');
});

test('#436 recentReleases of an empty or missing list is []', () => {
  const { recentReleases } = load();
  assert.equal(recentReleases([]).length, 0);
  assert.equal(Array.isArray(recentReleases([])), true);
  assert.equal(recentReleases(undefined).length, 0);
  assert.equal(recentReleases([rel('1.2.0', '2026-10-20T10:00:00.000Z', 1, { status: 'held' })]).length, 0, 'none shipped');
});

// ---- two-part names (review) ---------------------------------------------------------------------------

test('#436 a two-part last name stays two-part on a minor or a major: v1.4 → v1.5, v1.4 → v2.0', () => {
  const { suggestVersion } = load();
  assert.equal(suggestVersion({ last: 'v1.4', issues: [issue(1, 'enhancement')] }).version, 'v1.5');
  assert.equal(suggestVersion({ last: 'v1.4', issues: [issue(1, 'breaking')] }).version, 'v2.0');
});

test('#436 a patch of a two-part last name takes the third part: v1.4 → v1.4.1', () => {
  const out = load().suggestVersion({ last: 'v1.4', issues: [issue(1, 'bug')] });
  assert.deepEqual([out.version, out.bump], ['v1.4.1', 'patch']);
});

// ---- releaseIssues: what a cut line ships (review) -----------------------------------------------------

const st = (items, extra = {}) => ({ items: items.map(([number, status = 'planned']) => ({ number, status })), ...extra });
const numbers = (list) => list.map((i) => i.number).sort((a, b) => a - b);

test('#436 releaseIssues with no cut before: the issues done since the last release and the ones planned up to the cut', () => {
  const stages = [st([[10, 'done'], [11]]), st([[12]]), st([[13]])];
  const out = load().releaseIssues(stages, 1, [{ number: 9 }, { number: 10 }]);
  assert.deepEqual(numbers(out), [9, 10, 11, 12], 'stage 3 is past the cut; #10 once');
});

test('#436 releaseIssues leaves out disabled stages and skipped items', () => {
  const stages = [st([[11], [12, 'skipped']]), st([[13]], { disabled: true }), st([[14]])];
  assert.deepEqual(numbers(load().releaseIssues(stages, 2, [])), [11, 14]);
});

test('#436 releaseIssues after a shipped cut: only the stages after it, and what is done since the last release', () => {
  const stages = [st([[11]], { release: { name: '1.1.2', status: 'shipped' } }), st([[12]]), st([[13]])];
  assert.deepEqual(numbers(load().releaseIssues(stages, 2, [{ number: 9 }])), [9, 12, 13]);
});

test('#436 releaseIssues after a cut not shipped yet: that cut holds what is done since the last release', () => {
  const stages = [st([[11]], { release: { name: '1.2.0', status: 'planned' } }), st([[12]]), st([[13]])];
  assert.deepEqual(numbers(load().releaseIssues(stages, 2, [{ number: 9 }])), [12, 13]);
});
