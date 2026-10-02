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
  // a run's status is derived (withStatus) when read, never stored: markStarted stores a running
  // item as 'planned' with its runId (#112)
  assert.equal(kept.status, 'planned');
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

// ---- origin (#140: a roadmap item remembers the Product Owner answer it was added from) ---------

test('saveStages keeps origin from the raw item, adding no key when it is empty', (t) => {
  const dir = tmp(t);
  const withOrigin = roadmaps.saveStages(dir, 'proj', [
    { items: [{ workflow: 'a.yaml', number: 1, origin: '2026-01-01T00:00:00.000Z' }, { workflow: 'a.yaml', number: 2 }] },
  ]);
  const [withIt, withoutIt] = withOrigin.stages[0].items;
  assert.equal(withIt.origin, '2026-01-01T00:00:00.000Z');
  assert.equal('origin' in withoutIt, false);
});

test('saveStages keeps origin from the previous item with the same id when the UI omits it (a re-save)', (t) => {
  const dir = tmp(t);
  const first = roadmaps.saveStages(dir, 'proj', [
    { items: [{ workflow: 'a.yaml', number: 1, origin: '2026-01-01T00:00:00.000Z' }] },
  ]);
  const item1 = first.stages[0].items[0];
  const resaved = roadmaps.saveStages(dir, 'proj', [
    { id: first.stages[0].id, items: [{ id: item1.id, workflow: 'a.yaml', number: 1 }] },
  ]);
  assert.equal(resaved.stages[0].items[0].origin, '2026-01-01T00:00:00.000Z');
});

test('propose(add) keeps origin on its new items', (t) => {
  const dir = tmp(t);
  const { roadmap } = roadmaps.propose(dir, 'proj', { stages: [{ name: 'Next', items: [{ workflow: 'w.yaml', issues: [1], origin: 'ts-1' }] }] });
  assert.equal(roadmap.stages[0].items[0].origin, 'ts-1');
});

test('issueStages exposes each item\'s origin on its issues, null when the item has none', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { origin: 'ts-1' }), mkItem('i2', 2)] },
  ]));
  const stages = roadmaps.issueStages(roadmaps.readRoadmap(dir, 'proj'));
  assert.equal(stages.get(1).origin, 'ts-1');
  assert.equal(stages.get(2).origin, null);
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

// ---- Run this stage (#141: `scope: { stage: <id> }`) --------------------------------------

test('setState with a stage id scopes the run to that stage; refuses a stage not in the roadmap or with nothing left to plan', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap(
    [{ id: 's1', items: [mkItem('i1', 1)] }, { id: 's2', items: [mkItem('i2', 2, { status: 'done' })] }],
    { state: 'planned' },
  ));
  const after = roadmaps.setState(dir, 'proj', 'running', { stage: 's1' });
  assert.deepEqual(after.scope, { stage: 's1' });
  assert.equal(after.state, 'running');

  assert.throws(() => roadmaps.setState(dir, 'proj', 'running', { stage: 'missing' }), /no longer in the roadmap/);
  assert.throws(() => roadmaps.setState(dir, 'proj', 'running', { stage: 's2' }), /done or skipped/);
});

test('setState: pausing keeps the scope, starting the whole roadmap or stopping clears it', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state: 'running', scope: { stage: 's1' } }));
  const paused = roadmaps.setState(dir, 'proj', 'paused');
  assert.deepEqual(paused.scope, { stage: 's1' });

  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state: 'running', scope: { stage: 's1' } }));
  const stopped = roadmaps.setState(dir, 'proj', 'planned');
  assert.equal(stopped.scope, null);

  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state: 'running', scope: { stage: 's1' } }));
  const restarted = roadmaps.setState(dir, 'proj', 'running');
  assert.equal(restarted.scope, null);
});

test('advance on a scoped roadmap only returns the scoped stage\'s planned items, leaving the others\' status untouched', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2)] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ], { scope: { stage: 's2' } });
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => null });
  assert.deepEqual(start.map((x) => x.id), ['i2']);
  assert.equal(after.stages[0].items[0].status, 'planned');
  assert.equal(after.stages[2].items[0].status, 'planned');
  assert.deepEqual(after.scope, { stage: 's2' });
  assert.equal(after.state, 'running');
});

test('a scoped stage finishing pauses the roadmap as "Stage N done", clears the scope, and leaves the other stages planned', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2, { status: 'running', runId: 'r2' })] },
    { id: 's3', items: [mkItem('i3', 3)] },
  ], { scope: { stage: 's2' } });
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'success', merged: true }) });
  assert.deepEqual(start, []);
  assert.equal(after.state, 'paused');
  assert.equal(after.scope, null);
  assert.equal(after.pausedBy, null);
  assert.match(after.error, /Stage 2 done/);
  assert.equal(after.stages[1].items[0].status, 'done');
  assert.equal(after.stages[0].items[0].status, 'planned');
  assert.equal(after.stages[2].items[0].status, 'planned');
});

test('a scoped stage that is also the roadmap\'s only unfinished stage finishes the whole roadmap instead of just pausing it', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1, { status: 'done' })] },
    { id: 's2', items: [mkItem('i2', 2, { status: 'running', runId: 'r2' })] },
  ], { scope: { stage: 's2' } });
  const { roadmap: after } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'success', merged: true }) });
  assert.equal(after.state, 'done');
  assert.equal(after.scope, null);
});

test('a failure in a scoped stage pauses the roadmap as usual (pausedBy, error), keeping the scope so the owner is still working on that stage', () => {
  const roadmap = mkRoadmap([
    { id: 's1', items: [mkItem('i1', 1)] },
    { id: 's2', items: [mkItem('i2', 2, { status: 'running', runId: 'r2' })] },
  ], { scope: { stage: 's2' } });
  const { roadmap: after } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'failed', error: 'boom' }) });
  assert.equal(after.state, 'paused');
  assert.equal(after.pausedBy, 'i2');
  assert.match(after.error, /#2/);
  assert.deepEqual(after.scope, { stage: 's2' });
});

test('advance pauses a roadmap scoped to a stage no longer in it, clearing the scope so Start runs the whole roadmap', () => {
  const roadmap = mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { scope: { stage: 'gone' } });
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => null });
  assert.deepEqual(start, []);
  assert.equal(after.state, 'paused');
  assert.equal(after.scope, null);
  assert.match(after.error, /no longer in the roadmap/);
});

// ---- statuses derived from the runs, whatever the roadmap state (#112) --------------------

test('a paused roadmap still refreshes its items\' statuses from their runs; it never starts new ones', () => {
  // i1 paused the roadmap (its run failed); i2, in the same stage, is still shown with a stale
  // status from before the run it names was cancelled: advance corrects it (to failed) without
  // unpausing the roadmap or starting anything, so the owner sees the truth while deciding on i1.
  const roadmap = mkRoadmap(
    [{ id: 's1', items: [mkItem('i1', 1, { status: 'failed', runId: 'r1', runs: ['r1'], error: 'boom' }), mkItem('i2', 2, { status: 'running', runId: 'r2' })] }],
    { state: 'paused', pausedBy: 'i1', error: 'Stage 1: #1 failed.' },
  );
  const runs = { r1: { status: 'failed', error: 'boom' }, r2: { status: 'cancelled' } };
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: (id) => runs[id] || null });
  assert.deepEqual(start, []);
  assert.equal(after.state, 'paused', 'still paused: i1\'s run did not become alive again');
  assert.equal(after.pausedBy, 'i1');
  assert.equal(after.stages[0].items[1].status, 'failed', 'i2 reflects its run being cancelled, not left "running"');
  assert.match(after.stages[0].items[1].error, /cancelled/);
});

test('advance unpauses a roadmap once the item that paused it is alive again (resumed, or owned by another live process)', () => {
  const roadmap = mkRoadmap(
    [{ id: 's1', items: [mkItem('i1', 8, { status: 'failed', runId: 'r1', runs: ['r1'], error: 'boom' })] }],
    { state: 'paused', pausedBy: 'i1', error: 'Stage 1: #8 failed.' },
  );
  const { roadmap: after, start } = roadmaps.advance(roadmap, { runOf: () => ({ status: 'running', waiting: true }) });
  assert.equal(after.state, 'running');
  assert.equal(after.pausedBy, null);
  assert.equal(after.error, null);
  assert.equal(after.stages[0].items[0].status, 'running');
  assert.deepEqual(start, [], 'the item itself never starts again: it is already running');
});

test('writeRoadmap/readRoadmap never persists a live status: it is derived when read, not stored', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] }]));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'proj.roadmap.json'), 'utf8'));
  assert.equal(stored.stages[0].items[0].status, 'planned');
  assert.equal(stored.stages[0].items[0].runId, 'r1');
  // a finished status (done/skipped) is the one outcome kept as stored: no run event can rebuild it
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'done', runId: 'r1' })] }]));
  const finished = JSON.parse(fs.readFileSync(path.join(dir, 'proj.roadmap.json'), 'utf8'));
  assert.equal(finished.stages[0].items[0].status, 'done');
});

test('writeRoadmap refuses to write a roadmap that breaks its shape, keeping the file (and its backup) as they were', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }]));
  // a second, valid write: now there is a .bak of the first one too (writeJsonSafe, src/state-file.js)
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 2)] }]));
  const before = fs.readFileSync(path.join(dir, 'proj.roadmap.json'), 'utf8');
  const bakBefore = fs.readFileSync(path.join(dir, 'proj.roadmap.json.bak'), 'utf8');
  assert.throws(() => roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1)] }], { state: 'not-a-state' })), /unknown state/);
  assert.equal(fs.readFileSync(path.join(dir, 'proj.roadmap.json'), 'utf8'), before, 'the previous, valid file is untouched');
  assert.equal(fs.readFileSync(path.join(dir, 'proj.roadmap.json.bak'), 'utf8'), bakBefore, 'the backup is untouched too');
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

test('itemAction refuses an item whose run is alive (alive(runId), #112), naming the run', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] }]));
  assert.throws(() => roadmaps.itemAction(dir, 'proj', 'i1', 'retry', { alive: (id) => id === 'r1' }), /Run r1 is still running\./);
  assert.throws(() => roadmaps.itemAction(dir, 'proj', 'i1', 'skip', { alive: (id) => id === 'r1' }), /in progress/);
  // no `alive` (a stored file written before #112): falls back to the stored status, itself never
  // persisted as 'running' any more, so the item is free to retry/skip
  roadmaps.itemAction(dir, 'proj', 'i1', 'retry');
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

test('propose(replace) throws while an item\'s run is alive (alive(runId), #112)', (t) => {
  const dir = tmp(t);
  roadmaps.writeRoadmap(dir, 'proj', mkRoadmap([{ id: 's1', items: [mkItem('i1', 1, { status: 'running', runId: 'r1' })] }]));
  assert.throws(() => roadmaps.propose(dir, 'proj', { stages: [] }, { replace: true, alive: (id) => id === 'r1' }), /in progress/);
  // no `alive`: the stored status (never 'running' any more, see persisted/withStatus) never blocks it
  roadmaps.propose(dir, 'proj', { stages: [] }, { replace: true });
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
  // status is derived from the run when read (withStatus), never stored as 'running' (#112)
  assert.equal(item.status, 'planned');
  assert.equal(item.runId, 'run-new');
  assert.deepEqual(item.runs, ['run-old', 'run-new']);
});

// ---- one item shape (#163): every item normalizes to an `issues` list ---------------------

test('normalizeItem turns a single-issue item (no issues list) into one with an issues list, keeping its top fields; leaves other items unchanged', () => {
  const singleIssue = { id: 'i1', workflow: 'w.yaml', number: 155, url: 'https://x/155', title: '#155', body: '', knownPullRequests: [] };
  const normalized = roadmaps.normalizeItem(singleIssue);
  assert.deepEqual(normalized.issues.map((i) => i.number), [155]);
  assert.equal(normalized.number, 155); // kept for older readers
  assert.equal(normalized.url, 'https://x/155');

  const alreadyGrouped = { id: 'i2', workflow: 'w.yaml', issues: [{ number: 1, url: 'u', title: 't', body: '', knownPullRequests: [] }] };
  assert.equal(roadmaps.normalizeItem(alreadyGrouped), alreadyGrouped); // untouched: already has an issues list

  const noIssueAtAll = { id: 'i3', workflow: 'w.yaml' }; // neither issues nor number: nothing to normalize
  assert.equal(roadmaps.normalizeItem(noIssueAtAll), noIssueAtAll);
  assert.equal(roadmaps.normalizeItem(null), null);
});

test('readRoadmap normalizes items stored in the single-issue shape from before #163 (a hand-edited or pre-fix file), so the renderer always finds an issues list', (t) => {
  const dir = tmp(t);
  const raw = {
    state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null,
    stages: [
      { id: 's1', name: '', note: '', items: [
        { id: 'i1', workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, number: 155, url: 'https://x/155', title: '#155', body: '', knownPullRequests: [], status: 'planned', runId: null, runs: [], error: null },
        { id: 'i2', workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, number: 156, url: 'https://x/156', title: '#156', body: '', knownPullRequests: [], status: 'planned', runId: null, runs: [], error: null },
      ] },
    ],
  };
  fs.writeFileSync(path.join(dir, 'proj.roadmap.json'), JSON.stringify(raw));
  const roadmap = roadmaps.readRoadmap(dir, 'proj');
  const [item1, item2] = roadmap.stages[0].items;
  assert.deepEqual(item1.issues.map((i) => i.number), [155]);
  assert.deepEqual(item2.issues.map((i) => i.number), [156]);
  assert.equal(item1.number, 155); // the top-level fields stay, for older readers
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
