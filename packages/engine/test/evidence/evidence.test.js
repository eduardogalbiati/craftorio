// packages/engine/domains/evidence/evidence.js (#146): the run's evidence folder (<run_dir>/evidence/<step>/round-<n>/) built into
// one manifest.json, and the legacy screenshots/ + screenshots.json set read as one final set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../domains/evidence/evidence');

function tmpRunDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Writes a file under <runDir>/<rel> and sets its mtime, creating parent folders as needed.
function putFile(runDir, rel, mtimeMs) {
  const file = path.join(runDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `PNG ${rel}`);
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

// ---- parseShotName --------------------------------------------------------------------------

test('parseShotName: <issue>-<screen>-<state>.<side>.png splits issue, screen, state and side', () => {
  assert.deepEqual(evidence.parseShotName('144-roadmap-stage-header.original.png'), {
    key: '144-roadmap-stage-header', side: 'original', issue: '144', screen: 'roadmap-stage', state: 'header', named: true,
  });
  assert.deepEqual(evidence.parseShotName('144-roadmap-stage-confirm.modified.png'), {
    key: '144-roadmap-stage-confirm', side: 'modified', issue: '144', screen: 'roadmap-stage', state: 'confirm', named: true,
  });
});

test('parseShotName: no issue number, no side suffix defaults to modified (named: false), single part is its own screen', () => {
  assert.deepEqual(evidence.parseShotName('backlog.png'), { key: 'backlog', side: 'modified', issue: null, screen: 'backlog', state: 'default', named: false });
  assert.deepEqual(evidence.parseShotName('dev-po-applied.png'), { key: 'dev-po-applied', side: 'modified', issue: null, screen: 'dev-po', state: 'applied', named: false });
});

test('parseShotName: not an image file returns null', () => {
  assert.equal(evidence.parseShotName('notes.txt'), null);
  assert.equal(evidence.parseShotName('report.json'), null);
});

// ---- roundOf ----------------------------------------------------------------------------------

test('roundOf: <run_dir>/evidence/<step>/round-<n> gives { step, round }; anything else is null', (t) => {
  const run = tmpRunDir(t);
  assert.deepEqual(evidence.roundOf(run, path.join(run, 'evidence', 'developer', 'round-2')), { step: 'developer', round: 2 });
  assert.equal(evidence.roundOf(run, path.join(run, 'evidence', 'developer')), null, 'missing the round-N segment');
  assert.equal(evidence.roundOf(run, path.join(run, 'other', 'round-1')), null, 'outside evidence/');
  assert.equal(evidence.roundOf(run, path.join(run, 'evidence', 'developer', 'round-x')), null, 'round-N must be a number');
});

// ---- buildManifest ------------------------------------------------------------------------------

test('buildManifest: a pair in one round is final, paired both ways, and gets the commit of its side', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-panel-default.original.png', BASE_TIME);
  putFile(run, 'evidence/evidence/round-1/146-panel-default.modified.png', BASE_TIME + 10);

  const m = evidence.buildManifest(run, { base: 'main', branch: 'feat/146', commit: 'abc1234', baseCommit: 'def5678' });

  assert.equal(m.images.length, 2);
  assert.equal(m.final.step, 'evidence');
  assert.equal(m.final.round, 1);
  assert.deepEqual(m.rounds, [{ step: 'evidence', round: 1, captured_at: m.rounds[0].captured_at, final: true }]);
  const original = m.images.find((x) => x.side === 'original');
  const modified = m.images.find((x) => x.side === 'modified');
  assert.ok(original.final && modified.final);
  assert.equal(original.pair, modified.path);
  assert.equal(modified.pair, original.path);
  assert.equal(original.commit, 'def5678');
  assert.equal(modified.commit, 'abc1234');
  assert.equal(original.issue, '146');
  assert.equal(original.screen, 'panel');
  assert.equal(original.state, 'default');
});

test('buildManifest: two rounds of the same step — the later round is the final set, the earlier is history', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-x-default.original.png', BASE_TIME);
  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME + 10);
  putFile(run, 'evidence/evidence/round-2/146-x-default.original.png', BASE_TIME + 20);

  const m = evidence.buildManifest(run);

  assert.deepEqual(m.final, { step: 'evidence', round: 2 });
  const round1 = m.images.filter((x) => x.round === 1);
  const round2 = m.images.filter((x) => x.round === 2);
  assert.equal(round1.length, 2);
  assert.equal(round2.length, 1);
  assert.ok(round1.every((x) => x.final === false), 'round 1 is history once round 2 captured');
  assert.ok(round2.every((x) => x.final === true));
  // round 2 only recaptured the original: its pair is round 1's modified (carried forward)
  assert.equal(round2[0].side, 'original');
  assert.equal(round2[0].pair, round1.find((x) => x.side === 'modified').path);
});

test('buildManifest: the final set is the round that captured last across different steps, by capture time not step name', (t) => {
  const run = tmpRunDir(t);
  // "evidence" sorts after "developer" alphabetically, but developer's round captured later
  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME);
  putFile(run, 'evidence/developer/round-1/146-x-default.modified.png', BASE_TIME + 1000);

  const m = evidence.buildManifest(run);

  assert.deepEqual(m.final, { step: 'developer', round: 1 });
  assert.equal(m.images.find((x) => x.step === 'developer').final, true);
  assert.equal(m.images.find((x) => x.step === 'evidence').final, false);
});

test('buildManifest: a screen only the change adds has no original; one the change removes has no modified', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-added-default.modified.png', BASE_TIME);
  putFile(run, 'evidence/evidence/round-1/146-removed-default.original.png', BASE_TIME + 10);

  const m = evidence.buildManifest(run);

  assert.equal(m.images.find((x) => x.key === '146-added-default').pair, null);
  assert.equal(m.images.find((x) => x.key === '146-removed-default').pair, null);
});

test('buildManifest: a previous manifest\'s caption and commit are kept for an unchanged image, and overridden by captions', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME);
  const rel = 'evidence/evidence/round-1/146-x-default.modified.png';

  const m1 = evidence.buildManifest(run, { captions: { [rel]: { caption: 'First try', commit: 'c1' } } });
  const m2 = evidence.buildManifest(run, { previous: m1 });
  assert.equal(m2.images[0].caption, 'First try');
  assert.equal(m2.images[0].commit, 'c1');

  const m3 = evidence.buildManifest(run, { previous: m1, captions: { [rel]: { caption: 'Updated caption' } } });
  assert.equal(m3.images[0].caption, 'Updated caption');
});

// ---- writeManifest ------------------------------------------------------------------------------

test('writeManifest: null without an evidence folder; otherwise writes manifest.json and is idempotent', (t) => {
  const run = tmpRunDir(t);
  assert.equal(evidence.writeManifest(run), null);

  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME);
  const m1 = evidence.writeManifest(run);
  assert.ok(fs.existsSync(evidence.manifestPath(run)));
  assert.equal(JSON.parse(fs.readFileSync(evidence.manifestPath(run), 'utf8')).images.length, 1);

  const m2 = evidence.writeManifest(run);
  assert.deepEqual(m1, m2);
});

test('writeManifest: nothing captured yet and no previous manifest writes no file', (t) => {
  const run = tmpRunDir(t);
  fs.mkdirSync(evidence.evidenceRoot(run), { recursive: true });
  const m = evidence.writeManifest(run);
  assert.equal(m.images.length, 0);
  assert.equal(fs.existsSync(evidence.manifestPath(run)), false);
});

// ---- legacyManifest ------------------------------------------------------------------------------

test('legacyManifest: a flat screenshots/ + screenshots.json run reads as one final set, before/after paired as original/modified', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'screenshots/after.png', BASE_TIME);
  putFile(run, 'screenshots/before.png', BASE_TIME);
  putFile(run, 'screenshots/stray.png', BASE_TIME); // not listed in screenshots.json (the real #146 bug)
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), JSON.stringify([
    { path: 'after.png', before: 'before.png', caption: 'Login page' },
  ]));

  const m = evidence.legacyManifest(run);

  assert.equal(m.legacy, true);
  assert.deepEqual(m.final, { step: 'screenshots', round: 1 });
  assert.ok(m.images.every((x) => x.final === true));
  const after = m.images.find((x) => x.path === 'screenshots/after.png');
  const before = m.images.find((x) => x.path === 'screenshots/before.png');
  const stray = m.images.find((x) => x.path === 'screenshots/stray.png');
  assert.equal(after.side, 'modified');
  assert.equal(after.pair, 'screenshots/before.png');
  assert.equal(after.caption, 'Login page');
  assert.equal(before.side, 'original');
  assert.equal(before.pair, 'screenshots/after.png');
  assert.equal(before.caption, 'Login page');
  assert.equal(stray.side, 'modified');
  assert.equal(stray.pair, null);
});

test('legacyManifest: null without a screenshots/ folder or with no image files in it', (t) => {
  const run = tmpRunDir(t);
  assert.equal(evidence.legacyManifest(run), null);
  fs.mkdirSync(path.join(run, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), '[]');
  assert.equal(evidence.legacyManifest(run), null);
});

// ---- readEvidence -------------------------------------------------------------------------------

test('readEvidence: the evidence folder\'s manifest when it has images, else the legacy set, else null', (t) => {
  const run = tmpRunDir(t);
  assert.equal(evidence.readEvidence(run), null);

  putFile(run, 'screenshots/a.png', BASE_TIME);
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), JSON.stringify([{ path: 'a.png', caption: 'A' }]));
  assert.equal(evidence.readEvidence(run).legacy, true);

  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME);
  const m = evidence.readEvidence(run);
  assert.equal(m.legacy, undefined);
  assert.equal(m.images.length, 1);
});

// ---- orphanImages -------------------------------------------------------------------------------

test('orphanImages: an image outside the step/round-N structure, or a leftover flat screenshots/ file next to the evidence folder, is an orphan', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME);
  putFile(run, 'evidence/stray.png', BASE_TIME); // not inside any <step>/round-N
  putFile(run, 'screenshots/dev-po-applied.png', BASE_TIME); // the real #146 case: not in screenshots.json either
  evidence.writeManifest(run);

  const orphans = evidence.orphanImages(run);

  assert.deepEqual(orphans.sort(), ['evidence/stray.png', 'screenshots/dev-po-applied.png']);
});

test('orphanImages: nothing is orphaned once every captured image is in the manifest', (t) => {
  const run = tmpRunDir(t);
  putFile(run, 'evidence/evidence/round-1/146-x-default.original.png', BASE_TIME);
  putFile(run, 'evidence/evidence/round-1/146-x-default.modified.png', BASE_TIME + 10);
  evidence.writeManifest(run);
  assert.deepEqual(evidence.orphanImages(run), []);
});
