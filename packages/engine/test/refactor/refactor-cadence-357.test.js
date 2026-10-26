// #357: the Refactor cadence (packages/engine/domains/refactor/refactor-cadence.js): which runs count towards "a refactor every X
// runs" (real finished runs of the project), how many runs until the next one, the cadence's limits,
// which proposal is picked next and the roadmap stage it is placed in. Tests first: the module is
// loaded inside each test so each fails on its own until it exists.
// Roadmap items are as packages/engine/domains/roadmap/roadmap.js stores them: the first issue's `number` plus an `issues` list.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/refactor/refactor-cadence');

const project = { id: 'proj-a' };
const run = (runId, extra = {}) => ({ runId, status: 'success', mock: false, projectId: 'proj-a', finishedAt: '2026-10-01T10:00:00.000Z', ...extra });
const item = (id, number, status, files = []) => ({ id, number, issues: [{ number }], status, files });
const roadmapOf = (...stages) => ({ stages: stages.map((items, i) => ({ id: `stage-${i + 1}`, name: `Stage ${i + 1}`, items })) });

// ---------- countedRuns ----------

test('#357 countedRuns counts the real finished runs of the project', () => {
  const { countedRuns } = load();
  assert.equal(countedRuns([run('r1'), run('r2'), run('r3', { status: 'failed' })], project), 3);
});

test('#357 countedRuns never counts a mock run', () => {
  const { countedRuns } = load();
  assert.equal(countedRuns([run('r1'), run('m1', { mock: true })], project), 1);
});

test('#357 countedRuns never counts a running or interrupted run', () => {
  const { countedRuns } = load();
  const runs = [run('r1'), run('r2', { status: 'running', finishedAt: null }), run('r3', { status: 'interrupted' })];
  assert.equal(countedRuns(runs, project), 1);
});

test('#357 countedRuns never counts a run of another project', () => {
  const { countedRuns } = load();
  assert.equal(countedRuns([run('r1'), run('o1', { projectId: 'proj-b' })], project), 1);
});

test('#357 countedRuns with since counts only the runs finished after it', () => {
  const { countedRuns } = load();
  const runs = [
    run('old', { finishedAt: '2026-09-01T10:00:00.000Z' }),
    run('new1', { finishedAt: '2026-10-02T10:00:00.000Z' }),
    run('new2', { finishedAt: '2026-10-03T10:00:00.000Z' }),
  ];
  assert.equal(countedRuns(runs, project, '2026-09-15T00:00:00.000Z'), 2);
});

// ---------- runsUntilNext ----------

test('#357 runsUntilNext: every 10 with 6 counted runs leaves 4', () => {
  const { runsUntilNext } = load();
  const runs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => run(id));
  assert.equal(runsUntilNext({ runs, project, every: 10, since: null }), 4);
});

test('#357 runsUntilNext is 0 when the refactor is due (never negative)', () => {
  const { runsUntilNext } = load();
  const runs = ['a', 'b', 'c', 'd'].map((id) => run(id));
  assert.equal(runsUntilNext({ runs, project, every: 3, since: null }), 0);
});

// ---------- cleanCadence ----------

test('#357 DEFAULT_CADENCE is off, every 10 runs; the limits are 3 and 50', () => {
  const { DEFAULT_CADENCE, CADENCE_MIN, CADENCE_MAX } = load();
  assert.deepEqual(DEFAULT_CADENCE, { on: false, every: 10 });
  assert.equal(CADENCE_MIN, 3);
  assert.equal(CADENCE_MAX, 50);
});

test('#357 cleanCadence accepts every 3 and every 50', () => {
  const { cleanCadence } = load();
  assert.deepEqual(cleanCadence({ on: true, every: 3 }), { on: true, every: 3 });
  assert.deepEqual(cleanCadence({ on: false, every: 50 }), { on: false, every: 50 });
});

test('#357 cleanCadence refuses every 2, 51 and 3.5', () => {
  const { cleanCadence } = load();
  assert.throws(() => cleanCadence({ on: true, every: 2 }));
  assert.throws(() => cleanCadence({ on: true, every: 51 }));
  assert.throws(() => cleanCadence({ on: true, every: 3.5 }));
});

test('#357 cleanCadence gives on as a boolean', () => {
  const { cleanCadence } = load();
  assert.equal(cleanCadence({ on: 1, every: 10 }).on, true);
});

// ---------- pickNext ----------

const proposal = (id, rank, issue, extra = {}) => ({ id, rank, issue, status: 'proposed', files: [], ...extra });

test('#357 pickNext picks the top ranked proposal that has an issue', () => {
  const { pickNext } = load();
  const proposals = [proposal('p2', 2, 12), proposal('p1', 1, null), proposal('p3', 3, 13)];
  assert.equal(pickNext(proposals, roadmapOf()).id, 'p2');
});

test('#357 pickNext skips a dismissed proposal', () => {
  const { pickNext } = load();
  const proposals = [proposal('p1', 1, 11, { status: 'dismissed' }), proposal('p2', 2, 12)];
  assert.equal(pickNext(proposals, roadmapOf()).id, 'p2');
});

test('#357 pickNext skips a proposal whose issue is a planned or running roadmap item', () => {
  const { pickNext } = load();
  const proposals = [proposal('p1', 1, 11), proposal('p2', 2, 12), proposal('p3', 3, 13)];
  const roadmap = roadmapOf([item('i1', 11, 'planned'), item('i2', 12, 'running')]);
  assert.equal(pickNext(proposals, roadmap).id, 'p3');
});

test('#357 pickNext accepts a proposal whose roadmap item is done', () => {
  const { pickNext } = load();
  const proposals = [proposal('p1', 1, 11), proposal('p2', 2, 12)];
  const roadmap = roadmapOf([item('i1', 11, 'done')]);
  assert.equal(pickNext(proposals, roadmap).id, 'p1');
});

test('#357 pickNext is null when no proposal is ranked', () => {
  const { pickNext } = load();
  assert.equal(pickNext([proposal('p1', undefined, 11)], roadmapOf()), null);
});

test('#357 pickNext is null when no ranked proposal has an issue', () => {
  const { pickNext } = load();
  assert.equal(pickNext([proposal('p1', 1, null), proposal('p2', 2, undefined)], roadmapOf()), null);
});

test('#357 pickNext is null with no proposal', () => {
  const { pickNext } = load();
  assert.equal(pickNext([], roadmapOf()), null);
});

// ---------- placeRefactor ----------

test('#357 placeRefactor picks the earliest stage sharing no file', () => {
  const { placeRefactor } = load();
  const roadmap = roadmapOf(
    [item('i1', 1, 'planned', ['src/a.js'])],
    [item('i2', 2, 'planned', ['src/b.js'])],
    [item('i3', 3, 'planned', ['src/c.js'])],
  );
  assert.deepEqual(placeRefactor({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 1 });
});

test('#357 placeRefactor adds a new stage at the end when every stage shares a file', () => {
  const { placeRefactor } = load();
  const roadmap = roadmapOf(
    [item('i1', 1, 'planned', ['src/a.js'])],
    [item('i2', 2, 'planned', ['src/a.js', 'src/b.js'])],
  );
  assert.deepEqual(placeRefactor({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 2 });
});

test('#357 placeRefactor never places it before a stage holding a conflicting item', () => {
  const { placeRefactor } = load();
  const roadmap = roadmapOf(
    [item('i1', 1, 'planned', ['src/x.js'])],
    [item('i2', 2, 'planned', ['src/y.js'])],
    [item('i3', 3, 'planned', ['src/a.js'])],
    [item('i4', 4, 'planned', ['src/z.js'])],
  );
  assert.deepEqual(placeRefactor({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 3 });
});

test('#357 placeRefactor on an empty roadmap is a new first stage', () => {
  const { placeRefactor } = load();
  assert.deepEqual(placeRefactor({ roadmap: roadmapOf(), files: ['src/a.js'], conflictMap: null }), { stage: 0 });
});

// #555: a release is an entry of roadmap.stages between stages (no items of its own); a refactor never goes into it
const withRelease = (roadmap, at) => ({ stages: [...roadmap.stages.slice(0, at), { kind: 'release', id: 'rel-1', name: 'v1.4', items: [] }, ...roadmap.stages.slice(at)] });

test('#555 placeRefactor skips a release entry right after the conflicting stage and takes the stage after it', () => {
  const { placeRefactor } = load();
  const roadmap = withRelease(roadmapOf([item('i1', 1, 'planned', ['src/a.js'])], [item('i2', 2, 'planned', ['src/z.js'])]), 1);
  assert.deepEqual(placeRefactor({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 2 });
});

test('#555 placeRefactor with a release entry last after the conflicting stage places it in a new stage', () => {
  const { placeRefactor } = load();
  const roadmap = withRelease(roadmapOf([item('i1', 1, 'planned', ['src/a.js'])]), 1);
  assert.deepEqual(placeRefactor({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 2 });
});

test('#555 placeRunNow skips a release entry after the current stage', () => {
  const { placeRunNow } = load();
  const roadmap = withRelease(roadmapOf([item('i1', 1, 'running', ['src/a.js'])], [item('i2', 2, 'planned', ['src/z.js'])]), 1);
  assert.deepEqual(placeRunNow({ roadmap, files: ['src/a.js'], conflictMap: null }), { stage: 2 });
});
