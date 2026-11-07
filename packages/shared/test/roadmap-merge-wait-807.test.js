// #807 A stage waiting for its merge says so and lets the next stage stack on its branch: the model's rule
// (packages/shared/roadmap-model.js). Acceptance tests, written before the code.
//
// The interface these tests assume (the Roadmap view and the engine ask it, never keep copies):
// - MAX_STACK_DEPTH = 3: a stack holds at most 3 PRs.
// - ACTIONS gains 'stack'; allowedActions(roadmap, stage, item).stack is { allowed, reason } for the item.
// - stackDepth(roadmap, itemId) → how many PRs the stack ending at that item holds: 1 for an item stacked on
//   nothing, +1 for each `stacksOn` (an item's field: the id of the item of the stage before whose branch it
//   starts from).
// - mergeWait(roadmap, stageIndex, { filesOf? }) → null when the stage has no item waiting for its PR's
//   merge (status 'waiting_merge' with a `pr`), or its item runs in Local mode (inputs.mode 'local');
//   else { itemId, pr: { number, url }, moveOn: { allowed, reason }, stack: { allowed, reason }, overlap }:
//   stack refused in Fork + PR mode (inputs.mode 'fork', #738 keeps its wait and rebase) and past
//   MAX_STACK_DEPTH, each with its reason; overlap: the sorted paths the next stage's items expect to change
//   that the waiting stage's items do too (filesOf(item), default item.files || []).
// New exports are read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const model = () => require('../roadmap-model');

const PR = { number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' };
const it = (id, status, extra = {}) => ({ id, status, workflow: 'feature.yaml', inputs: { mode: 'remote' }, runId: `run-${id}`, runs: [], error: null, ...extra });
const waiting = (id, extra = {}) => it(id, 'waiting_merge', { pr: PR, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });
const plan = (stages, extra = {}) => ({ state: 'running', stages, ...extra });
// stage 1 waits for #7, stage 2 not started
const twoStages = (first = waiting('a'), next = it('b', 'planned', { runId: null })) => plan([stage('s1', [first]), stage('s2', [next])]);

// ---- criterion 1: the notice ---------------------------------------------------------------------------

test('#807 mergeWait: a stage whose item waits for its PR gets the notice, naming the item and the PR', () => {
  const w = model().mergeWait(twoStages(), 0);
  assert.deepEqual([w?.itemId, w?.pr?.number, w?.pr?.url], ['a', 7, 'https://github.com/o/r/pull/7']);
});

test('#807 mergeWait: no notice once the merge is seen (the item is done), nor for a stage that does not wait', () => {
  const merged = twoStages(it('a', 'done', { pr: { ...PR, state: 'merged' } }));
  assert.deepEqual([model().mergeWait(merged, 0), model().mergeWait(twoStages(), 1)], [null, null]);
});

// ---- criteria 2 and 3: the choices ---------------------------------------------------------------------

test('#807 mergeWait: Move on and Stack are both offered on a Remote (pull request) stage; stack is an action', () => {
  const w = model().mergeWait(twoStages(), 0);
  assert.deepEqual([w?.moveOn?.allowed, w?.stack?.allowed], [true, true]);
  assert.equal(model().ACTIONS.includes('stack'), true);
  const r = twoStages();
  assert.equal(model().allowedActions(r, r.stages[0], r.stages[0].items[0]).stack?.allowed, true);
});

test('#807 mergeWait: the next stage\'s expected files that the waiting stage changes too are named as the overlap', () => {
  const overlapping = twoStages(waiting('a', { files: ['src/b.js', 'src/a.js'] }), it('b', 'planned', { runId: null, files: ['src/a.js', 'src/c.js', 'src/b.js'] }));
  const apart = twoStages(waiting('a', { files: ['src/a.js'] }), it('b', 'planned', { runId: null, files: ['src/c.js'] }));
  assert.deepEqual(model().mergeWait(overlapping, 0)?.overlap, ['src/a.js', 'src/b.js']);
  assert.deepEqual(model().mergeWait(apart, 0)?.overlap, []);
});

test('#807 mergeWait: filesOf gives the expected files when the items do not carry them', () => {
  const files = { a: ['x.js'], b: ['x.js', 'y.js'] };
  const w = model().mergeWait(twoStages(), 0, { filesOf: (x) => files[x.id] || [] });
  assert.deepEqual(w?.overlap, ['x.js']);
});

// ---- criterion 7: the depth limit ----------------------------------------------------------------------

test('#807 stackDepth counts the PRs of the stack, and a stack of 3 refuses one more, saying why', () => {
  const r = plan([
    stage('s1', [waiting('a')]),
    stage('s2', [waiting('b', { stacksOn: 'a', pr: { ...PR, number: 8 } })]),
    stage('s3', [waiting('c', { stacksOn: 'b', pr: { ...PR, number: 9 } })]),
    stage('s4', [it('d', 'planned', { runId: null })]),
  ]);
  const m = model();
  assert.equal(m.MAX_STACK_DEPTH, 3);
  assert.deepEqual(['a', 'b', 'c'].map((id) => m.stackDepth(r, id)), [1, 2, 3]);
  assert.equal(m.mergeWait(r, 1)?.stack?.allowed, true);
  const w = m.mergeWait(r, 2);
  assert.equal(w?.stack?.allowed, false);
  assert.match(String(w?.stack?.reason), /\b3\b/);
});

// ---- criterion 8: Fork + PR and Local -----------------------------------------------------------------

test('#807 mergeWait in Fork + PR mode: Move on only, Stack refused with its reason', () => {
  const w = model().mergeWait(twoStages(waiting('a', { inputs: { mode: 'fork' } })), 0);
  assert.equal(w?.moveOn?.allowed, true);
  assert.equal(w?.stack?.allowed, false);
  assert.ok(String(w?.stack?.reason || '').length > 0);
});

test('#807 mergeWait in Local mode: no notice', () => {
  assert.equal(model().mergeWait(twoStages(waiting('a', { inputs: { mode: 'local' } })), 0), null);
});

// ---- criterion 9: "Seguir" (Move on past a gate, #395) as today ----------------------------------------

test('#807 an item at a human gate keeps Move on (park) and is not stacked', () => {
  const r = twoStages(it('a', 'running', { waiting: true }));
  const acts = model().allowedActions(r, r.stages[0], r.stages[0].items[0]);
  assert.deepEqual([acts.park.allowed, acts.stack?.allowed], [true, false]);
  assert.equal(model().mergeWait(r, 0), null);
});

// ---- the words, in both languages ----------------------------------------------------------------------

test('#807 the notice\'s words exist in en and pt-BR', () => {
  const keys = ['title', 'move_on', 'stack', 'move_on_hint', 'overlap', 'stack_depth_limit'].map((k) => `backlog_roadmap.merge_wait.${k}`);
  for (const lang of ['en', 'pt-BR']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
    assert.deepEqual(keys.filter((k) => typeof catalog[k] !== 'string' || !catalog[k].trim()), [], lang);
  }
});
