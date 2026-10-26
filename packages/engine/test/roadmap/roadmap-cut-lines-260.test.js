// Releases (#260, #555): a cut line on the Roadmap between two stages ("Release here", with a name
// or version) is a release entry of its own in the roadmap's ordered list (#555; it used to be a
// `release: { name }` field on the stage before the line, which a read migrates). advance() stops at
// it and asks for its run; once the release shipped the next stage starts as usual. Roadmaps
// without cut lines behave as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-cut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A roadmap item as advance() expects it (copied from test/roadmap.test.js).
const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const mkRoadmap = (stages, over = {}) => ({ state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null, stages, ...over });
const merged = { r1: { status: 'success', merged: true }, r2: { status: 'success', merged: true } };
const runOf = (id) => merged[id] || null;

// ---- advance() --------------------------------------------------------------------------------

test('without cut lines stage 2 starts after stage 1 as before (#260 regression)', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual(result.start.map((x) => x.id), ['i2']);
  assert.equal(result.release, undefined);
});

// ---- #555: a release is its own item of the roadmap ------------------------------------------------------
// Acceptance tests written before the code. Shape assumed (the one the issue proposes): a release is
// an entry of the roadmap's ordered list `stages`, between stages: { kind: 'release', id, name,
// status?, runId?, shippedAt? } (no `items`). A stage entry has no `kind`. cleanStages / saveStages
// keep it in its place (a new one gets an id; a given id is kept); what its run did (status, runId,
// shippedAt) comes from the stored entry, never from the edit. advance() stops at it once every
// enabled stage before it is finished and asks for its run: `release: { id, name }`. takeRelease /
// setRelease / holdRelease take the release entry's id (no longer a stage's). On read, a stage's old
// `release` field becomes a release entry right after that stage, with its status, run and shipped date.
// The #260 tests that stored the cut line as `stage.release` were replaced by these.

const rel = (id, name, over = {}) => ({ kind: 'release', id, name, ...over });
const isRelease = (s) => s?.kind === 'release';
const order = (stages) => stages.map((s) => (isRelease(s) ? `release:${s.name}` : s.id));
const saved = (id, n) => ({ id, items: [{ workflow: 'a.yaml', number: n }] });

test('#555 cleanStages keeps a release entry between two stages, its name trimmed and an id given', () => {
  const out = roadmaps.cleanStages([saved('s1', 1), { kind: 'release', name: '  v1.4  ' }, saved('s2', 2)]);
  assert.deepEqual([order(out), typeof out[1].id, out[1].id.length > 0], [['s1', 'release:v1.4', 's2'], 'string', true]);
});

test('#555 saving and reading the roadmap keeps the release entry in its place', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  assert.deepEqual(order(roadmaps.readRoadmap(dir, 'proj').stages), ['s1', 'release:v1.4', 's2']);
});

test('#555 emptying the stage before a release (the stage goes) leaves the release in the roadmap', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.saveStages(dir, 'proj', [{ id: 's1', items: [] }, rel('rel-1', 'v1.4'), saved('s2', 2)]);
  assert.deepEqual(order(roadmaps.readRoadmap(dir, 'proj').stages), ['release:v1.4', 's2']);
});

test('#555 disabling the stage before a release leaves the release in place', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.saveStages(dir, 'proj', [{ ...saved('s1', 1), disabled: true }, rel('rel-1', 'v1.4'), saved('s2', 2)]);
  assert.deepEqual(order(roadmaps.readRoadmap(dir, 'proj').stages), ['s1', 'release:v1.4', 's2']);
});

test('#555 migration: a stage\'s old cut line is read as a release entry right after it, with its status, run and shipped date', (t) => {
  const dir = tmp(t);
  const old = {
    state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: '2026-10-01T00:00:00.000Z',
    stages: [
      { id: 's1', name: '', note: '', release: { name: 'v1.3', status: 'shipped', runId: 'rel-run-1', shippedAt: '2026-10-01T00:00:00.000Z' }, items: [mkItem('i1', 1, { status: 'done', runId: 'r1', runs: ['r1'] })] },
      { id: 's2', name: '', note: '', items: [mkItem('i2', 2)] },
    ],
  };
  fs.writeFileSync(path.join(dir, 'proj.roadmap.json'), JSON.stringify(old));
  const { stages } = roadmaps.readRoadmap(dir, 'proj');
  const entry = stages[1] || {};
  assert.deepEqual(
    [order(stages), stages[0].release, entry.status, entry.runId, entry.shippedAt],
    [['s1', 'release:v1.3', 's2'], undefined, 'shipped', 'rel-run-1', '2026-10-01T00:00:00.000Z'],
  );
});

test('#555 advance stops at a release entry once the stages before it are finished and asks for its run', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    rel('rel-1', 'v1.4'),
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual([result.start.length, result.release?.id, result.release?.name], [0, 'rel-1', 'v1.4']);
});

test('#555 advance asks for no release while a stage before it still runs', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'live' })] },
    rel('rel-1', 'v1.4'),
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf: (id) => (id === 'live' ? { status: 'running' } : runOf(id)) });
  assert.deepEqual([result.start.length, result.release], [0, undefined]);
});

test('#555 advance starts the stage after a shipped release entry', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] },
    rel('rel-1', 'v1.4', { status: 'shipped' }),
    { id: 's2', items: [mkItem('i2', 2)] },
  ]);
  const result = roadmaps.advance(roadmap, { runOf });
  assert.deepEqual([result.start.map((x) => x.id), result.release], [['i2'], undefined]);
});

test('#555 takeRelease on a release entry\'s id: the entry is running on that run', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.takeRelease(dir, 'proj', 'rel-1', 'release-run-1');
  const entry = roadmaps.readRoadmap(dir, 'proj').stages.find(isRelease) || {};
  assert.deepEqual([entry.status, entry.runId], ['running', 'release-run-1']);
});

test('#555 a held release entry pauses a running roadmap', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.setState(dir, 'proj', 'running', { simulated: false });
  roadmaps.holdRelease(dir, 'proj', 'rel-1', 'held', 'The release is on hold');
  const r = roadmaps.readRoadmap(dir, 'proj');
  assert.deepEqual([r.state, (r.stages.find(isRelease) || {}).status], ['paused', 'held']);
});

test('#555 a running release cannot be renamed: a save that renames it leaves its name', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.takeRelease(dir, 'proj', 'rel-1', 'release-run-1');
  const stages = roadmaps.readRoadmap(dir, 'proj').stages.map((s) => (isRelease(s) ? { ...s, name: 'v9.9' } : s));
  try { roadmaps.saveStages(dir, 'proj', stages); } catch { /* refusing the edit is fine too */ }
  assert.equal((roadmaps.readRoadmap(dir, 'proj').stages.find(isRelease) || {}).name, 'v1.4');
});

test('#555 a shipped release cannot be moved: a save that moves it leaves it in its place', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, 'proj', [saved('s1', 1), rel('rel-1', 'v1.4'), saved('s2', 2)]);
  roadmaps.setRelease(dir, 'proj', 'rel-1', { status: 'shipped', shippedAt: '2026-10-20T00:00:00.000Z' });
  const [s1, entry, s2] = roadmaps.readRoadmap(dir, 'proj').stages;
  try { roadmaps.saveStages(dir, 'proj', [s1, s2, entry]); } catch { /* refusing the edit is fine too */ }
  assert.deepEqual(order(roadmaps.readRoadmap(dir, 'proj').stages), ['s1', 'release:v1.4', 's2']);
});

// roadmap-merge.js (#287): an edit based on an older read adds, renames and keeps release entries
const mStage = (id, n) => ({ id, name: '', note: '', items: [{ id: `it${n}`, workflow: 'w.yaml', number: n, inputs: {}, mock: false, issues: [{ number: n }] }] });

test('#555 mergeEdit applies a release added by an older read, in its place', () => {
  const { mergeEdit } = require('../../domains/roadmap/roadmap-merge');
  const read = [mStage('s1', 1), mStage('s2', 2)];
  const out = mergeEdit(read, [mStage('s1', 1), rel('rel-new', 'v1.5'), mStage('s2', 2)], [mStage('s1', 1), mStage('s2', 2)]);
  assert.deepEqual([out.ok, order(out.stages || [])], [true, ['s1', 'release:v1.5', 's2']]);
});

test('#555 mergeEdit applies a release renamed by an older read and keeps it in its place', () => {
  const { mergeEdit } = require('../../domains/roadmap/roadmap-merge');
  const read = [mStage('s1', 1), rel('rel-1', 'v1.4'), mStage('s2', 2)];
  const out = mergeEdit(read, [mStage('s1', 1), rel('rel-1', 'v2.0'), mStage('s2', 2)], read);
  assert.deepEqual([out.ok, order(out.stages || [])], [true, ['s1', 'release:v2.0', 's2']]);
});

test('#555 mergeEdit: a stage moved by an older read leaves the release entry in its place', () => {
  const { mergeEdit } = require('../../domains/roadmap/roadmap-merge');
  const read = [mStage('s1', 1), rel('rel-1', 'v1.4'), mStage('s2', 2), mStage('s3', 3)];
  const out = mergeEdit(read, [mStage('s1', 1), rel('rel-1', 'v1.4'), mStage('s3', 3), mStage('s2', 2)], read);
  assert.deepEqual([out.ok, order(out.stages || [])], [true, ['s1', 'release:v1.4', 's3', 's2']]);
});

test('#555 undo (#281) of "Removed release v1.4" puts the release entry back in its place', () => {
  const { recordEdit, undoEdit } = require('../../domains/roadmap/roadmap-undo');
  const before = [mStage('s1', 1), rel('rel-1', 'v1.4'), mStage('s2', 2)];
  const after = [mStage('s1', 1), mStage('s2', 2)];
  const out = undoEdit(after, recordEdit(before, after, 'Removed release v1.4'));
  assert.deepEqual([out.ok, order(out.stages || [])], [true, ['s1', 'release:v1.4', 's2']]);
});
