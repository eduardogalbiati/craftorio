// Backlog roadmap (src/roadmap.js): ordered stages of runs per project, persisted next to the
// queue. advance() is the pure sequencing step; the rest (saveStages, propose, dropIssues,
// itemAction, adoptResumed) read and write the roadmap file directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../src/roadmap');
const { itemIssues } = require('../src/backlog');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const issue = (number, title, url) => ({ number, title, url, body: '', pullRequests: [] });

// A roadmap item as advance() expects it: the shape cleanItem/saveStages produce.
const mkItem = (id, number, over = {}) => ({
  id, workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false,
  number, url: `https://x/${number}`, title: `#${number}`, body: '', knownPullRequests: [],
  status: 'planned', runId: null, runs: [], error: null, ...over,
});
const mkRoadmap = (stages, over = {}) => ({ state: 'running', simulated: false, error: null, pausedBy: null, updatedAt: null, stages, ...over });

// ---- saveStages / cleanStages -------------------------------------------------------------

test('saveStages assigns ids, fills titles/urls from the synced issues, and drops empty stages', (t) => {
  const dir = tmp(t);
  const synced = [issue(1, 'Fix crash', 'https://github.com/o/r/issues/1'), issue(2, 'Add feature', 'https://github.com/o/r/issues/2')];
  const roadmap = roadmaps.saveStages(dir, 'proj', [
    { name: 'Stage one', items: [{ workflow: 'software-development.yaml', issues: [1] }, { workflow: 'software-development.yaml', number: 2 }] },
    { items: [] },
  ], { issues: synced });

  assert.equal(roadmap.stages.length, 1); // the empty stage is dropped
  const [s1] = roadmap.stages;
  assert.equal(s1.name, 'Stage one');
  assert.ok(s1.id);
  const [item1, item2] = s1.items;
  assert.ok(item1.id && item2.id && item1.id !== item2.id);
  assert.equal(item1.title, 'Fix crash');
  assert.equal(item1.url, 'https://github.com/o/r/issues/1');
  assert.equal(item2.title, 'Add feature');
  assert.deepEqual([item1.status, item2.status], ['planned', 'planned']);
});

test('saveStages keeps status/runId/runs by item id when the UI re-saves', (t) => {
  const dir = tmp(t);
  const synced = [issue(1, 'Fix crash', 'https://github.com/o/r/issues/1'), issue(2, 'Add feature', 'https://github.com/o/r/issues/2')];
  const first = roadmaps.saveStages(dir, 'proj', [
    { items: [{ workflow: 'a.yaml', number: 1 }, { workflow: 'a.yaml', number: 2 }] },
  ], { issues: synced });
  const [item1, item2] = first.stages[0].items;
  roadmaps.markStarted(dir, 'proj', item1.id, { runId: 'run-1' });

  const resaved = roadmaps.saveStages(dir, 'proj', [
    { id: first.stages[0].id, name: 'Stage one', note: 'do this first', items: [{ id: item1.id, workflow: 'a.yaml', number: 1 }, { id: item2.id, workflow: 'a.yaml', number: 2 }] },
  ], { issues: synced });

  const kept = resaved.stages[0].items.find((x) => x.id === item1.id);
  assert.equal(kept.status, 'running');
  assert.equal(kept.runId, 'run-1');
  assert.deepEqual(kept.runs, ['run-1']);
  assert.equal(resaved.stages[0].note, 'do this first');
});

test('saveStages keeps reason and modeReason (also from mode_reason), adding no keys when both are empty', (t) => {
  const dir = tmp(t);
  const withReasons = roadmaps.saveStages(dir, 'proj', [
    { items: [
      { workflow: 'a.yaml', number: 1, reason: 'Groups the UI fixes together', mode_reason: 'Validated: the owner can try it in the app' },
      { workflow: 'a.yaml', number: 2 },
    ] },
  ]);
  const [withReason, withoutReason] = withReasons.stages[0].items;
  assert.equal(withReason.reason, 'Groups the UI fixes together');
  assert.equal(withReason.modeReason, 'Validated: the owner can try it in the app');
  assert.equal('reason' in withoutReason, false);
  assert.equal('modeReason' in withoutReason, false);
});

test('saveStages keeps reason/modeReason from the previous item with the same id when the UI omits them', (t) => {
  const dir = tmp(t);
  const first = roadmaps.saveStages(dir, 'proj', [
    { items: [{ workflow: 'a.yaml', number: 1, reason: 'Groups the UI fixes together', modeReason: 'Validated' }] },
  ]);
  const item1 = first.stages[0].items[0];

  const resaved = roadmaps.saveStages(dir, 'proj', [
    { id: first.stages[0].id, items: [{ id: item1.id, workflow: 'a.yaml', number: 1 }] },
  ]);
  const kept = resaved.stages[0].items[0];
  assert.equal(kept.reason, 'Groups the UI fixes together');
  assert.equal(kept.modeReason, 'Validated');
});

test('saveStages throws when an issue is in two unfinished roadmap items', (t) => {
  const dir = tmp(t);
  assert.throws(() => roadmaps.saveStages(dir, 'proj', [
    { items: [{ workflow: 'a.yaml', number: 1 }] },
    { items: [{ workflow: 'b.yaml', number: 1 }] },
  ]), /is in two roadmap items/);
});

// ---- advance (pure sequencing) ------------------------------------------------------------

test('advance on a running roadmap returns only the first stage\'s planned items', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1), mkItem('i2', 2)] },
    { id: 's2', items: [mkItem('i3', 3)] },
  ]);
  const { start } = roadmaps.advance(roadmap, { runOf: () => null });
  assert.deepEqual(start.map((x) => x.id), ['i1', 'i2']);
});

test('a stage-1 item still running (or waiting at a gate) keeps stage 2 from starting', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' }), mkItem('i2', 2, { status: 'done' })] },
    { id: 's2', items: [mkItem('i3', 3)] },
  ]);
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: (id) => (id === 'r1' ? { status: 'running', waiting: true } : null) });
  assert.deepEqual(start, []);
  assert.equal(after.state, 'running');
  assert.equal(after.stages[0].items[0].status, 'running');
});

test('every stage-1 item success and merged makes advance return stage 2\'s items', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' }), mkItem('i2', 2, { status: 'running', runId: 'r2' })] },
    { id: 's2', items: [mkItem('i3', 3)] },
  ]);
  const runs = { r1: { status: 'success', merged: true }, r2: { status: 'success', merged: true } };
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: (id) => runs[id] || null });
  assert.deepEqual([after.stages[0].items[0].status, after.stages[0].items[1].status], ['done', 'done']);
  assert.deepEqual(start.map((x) => x.id), ['i3']);
});

test('success without a merge marks the item failed instead of done', () => {
  const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 7, { status: 'running', runId: 'r1' })] }]);
  const { roadmap: after } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'success', merged: false }) });
  const item = after.stages[0].items[0];
  assert.equal(item.status, 'failed');
  assert.match(item.error, /finished without merging/);
  assert.equal(after.state, 'paused');
  assert.equal(after.pausedBy, 'i1');
});

test('failed, cancelled or interrupted runs pause the roadmap, naming the issues', () => {
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 9, { status: 'running', runId: 'r1' })] }]);
    const { roadmap: after } = roadmaps.advance(roadmap, { runOf: () => ({ status, error: status === 'failed' ? 'boom' : null }) });
    assert.equal(after.state, 'paused', status);
    assert.equal(after.pausedBy, 'i1', status);
    assert.match(after.error, /#9/, status);
    assert.equal(after.stages[0].items[0].status, 'failed', status);
  }
});

test('the last stage finishing makes the roadmap state done', () => {
  const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 4, { status: 'running', runId: 'r1' })] }]);
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'success', merged: true }) });
  assert.equal(after.state, 'done');
  assert.equal(after.error, null);
  assert.deepEqual(start, []);
});

test('an item whose issues are all closed becomes skipped', () => {
  const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 5), mkItem('i2', 6)] }]);
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => null, closed: (n) => n === 5 });
  const skipped = after.stages[0].items.find((x) => x.id === 'i1');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.error, 'Every issue is closed.');
  assert.deepEqual(start.map((x) => x.id), ['i2']);
});

test('canStart returning false keeps the item planned instead of starting it', () => {
  const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }]);
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => null, canStart: () => false });
  assert.deepEqual(start, []);
  assert.equal(after.stages[0].items[0].status, 'planned');
});

test('advance does nothing to a roadmap that is planned or paused', () => {
  for (const state of ['planned', 'paused']) {
    const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state });
    const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => null });
    assert.deepEqual(start, []);
    assert.equal(after.state, state);
  }
});

// ---- itemAction ----------------------------------------------------------------------------

test('itemAction retry or skip on the item that paused the roadmap resumes it', (t) => {
  const dir = tmp(t);
  const base = mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'failed', runId: 'r1', runs: ['r1'], error: 'boom' })] }],
    { state: 'paused', pausedBy: 'i1', error: 'Stage 1: #1 failed.' });

  roadmaps.writeRoadmap(dir, 'proj', base);
  const afterRetry = roadmaps.itemAction(dir, 'proj', 'i1', 'retry');
  assert.equal(afterRetry.state, 'running');
  assert.equal(afterRetry.pausedBy, null);
  assert.equal(afterRetry.error, null);
  assert.equal(afterRetry.stages[0].items[0].status, 'planned');
  assert.equal(afterRetry.stages[0].items[0].runId, null);

  roadmaps.writeRoadmap(dir, 'proj', base);
  const afterSkip = roadmaps.itemAction(dir, 'proj', 'i1', 'skip');
  assert.equal(afterSkip.state, 'running');
  assert.equal(afterSkip.stages[0].items[0].status, 'skipped');
  assert.equal(afterSkip.stages[0].items[0].error, 'Skipped by the owner.');
});

test('itemAction refuses an item whose run is in progress', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] }]));
  assert.throws(() => roadmaps.itemAction(dir, 'proj', 'i1', 'retry'), /in progress/);
});

// ---- propose (the Product Owner's roadmap, #105) -------------------------------------------

test('propose(add) appends planned stages, drops issues already planned, and pauses a running roadmap', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state: 'running' }));
  const { roadmap, dropped } = roadmaps.propose(dir, 'proj', { stages: [{ name: 'Next', items: [{ workflow: 'w.yaml', issues: [1, 2] }] }] });
  assert.deepEqual(dropped, [1]);
  assert.equal(roadmap.state, 'paused');
  assert.match(roadmap.error, /press Start to continue/);
  assert.equal(roadmap.stages.length, 2);
  assert.deepEqual(itemIssues(roadmap.stages[1].items[0]).map((i) => i.number), [2]);
});

test('propose(replace) throws while an item is running', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] }]));
  assert.throws(() => roadmaps.propose(dir, 'proj', { stages: [] }, { replace: true }), /in progress/);
});

// ---- dropIssues / adoptResumed ---------------------------------------------------------------

test('dropIssues removes issues from planned or failed items only', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{
    id: 's1',
    items: [mkItem('i1', 1, { status: 'planned' }), mkItem('i2', 2, { status: 'failed' }), mkItem('i3', 3, { status: 'done' })],
  }]));
  const after = roadmaps.dropIssues(dir, 'proj', [1, 2, 3]);
  assert.deepEqual(after.stages[0].items.map((x) => x.id), ['i3']); // planned/failed emptied and removed, done kept
});

test('adoptResumed moves the item to the new run and resumes a roadmap it paused', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap(
    [{ id: 's1', items: [mkItem('i1', 1, { status: 'failed', runId: 'run-old', runs: ['run-old'], error: 'boom' })] }],
    { state: 'paused', pausedBy: 'i1', error: 'boom' },
  ));
  const after = roadmaps.adoptResumed(dir, 'proj', 'run-old', 'run-new');
  assert.equal(after.state, 'running');
  assert.equal(after.pausedBy, null);
  assert.equal(after.error, null);
  const item = after.stages[0].items[0];
  assert.equal(item.status, 'running');
  assert.equal(item.runId, 'run-new');
  assert.deepEqual(item.runs, ['run-old', 'run-new']);
});

// ---- mergedPullRequest ------------------------------------------------------------------------

test('mergedPullRequest is true only for a successful, unskipped gh/glab merge action', (t) => {
  const dir = tmp(t);
  const merged = path.join(dir, 'run-merged');
  fs.mkdirSync(merged, { recursive: true });
  fs.writeFileSync(path.join(merged, 'events.jsonl'), [
    JSON.stringify({ type: 'action.executed', command: 'gh pr merge 5 --squash', exit_code: 0 }),
    JSON.stringify({ type: 'action.executed', command: 'gh pr merge 6 --squash', exit_code: 0, skipped: true }),
    JSON.stringify({ type: 'action.executed', command: 'gh pr merge 7 --squash', exit_code: 1 }),
    JSON.stringify({ type: 'action.executed', command: 'git status', exit_code: 0 }),
  ].join('\n'));
  assert.equal(roadmaps.mergedPullRequest(merged), true);

  const notMerged = path.join(dir, 'run-not-merged');
  fs.mkdirSync(notMerged, { recursive: true });
  fs.writeFileSync(path.join(notMerged, 'events.jsonl'), [
    JSON.stringify({ type: 'action.executed', command: 'gh pr merge 6 --squash', exit_code: 0, skipped: true }),
    JSON.stringify({ type: 'action.executed', command: 'gh pr merge 7 --squash', exit_code: 1 }),
    JSON.stringify({ type: 'action.executed', command: 'glab mr merge 8', exit_code: 1 }),
    JSON.stringify({ type: 'action.executed', command: 'git status', exit_code: 0 }),
  ].join('\n'));
  assert.equal(roadmaps.mergedPullRequest(notMerged), false);
});
