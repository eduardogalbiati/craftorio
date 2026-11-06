// #804: RoadmapModel.nextAfterSkip mirrors the engine's advance: what the paths the acceptance tests
// do not reach would start (a release, a live refill, a stage put before the running one, a folded roadmap).
const test = require('node:test');
const assert = require('node:assert/strict');
const { foldReleases, nextAfterSkip } = require('../roadmap-model');

const item = (id, status = 'planned') => ({ id, status, issues: [{ number: Number(id.slice(1)), title: id }] });
const stage = (id, items, over = {}) => ({ id, name: '', items, ...over });
const paused = (stages, over = {}) => ({ state: 'paused', pausedBy: 'i1', stages, ...over });
const ids = (next) => next.items.map((x) => x.id);

test('#804 the next stage: its name, its number among the stages and its planned items', () => {
  const next = nextAfterSkip(paused([stage('s1', [item('i1', 'failed')]), stage('s2', [item('i2'), item('i3', 'done')], { name: 'Hardening' })]), 'i1');
  assert.deepEqual([next.stage, next.number, ids(next)], ['Hardening', 2, ['i2']]);
});

test('#804 a roadmap not paused, or paused by another item, starts nothing new', () => {
  const stages = [stage('s1', [item('i1', 'failed'), item('i2')])];
  assert.equal(nextAfterSkip(paused(stages, { state: 'running' }), 'i1'), null);
  assert.equal(nextAfterSkip(paused(stages, { pausedBy: 'i9' }), 'i1'), null);
  assert.equal(nextAfterSkip(paused(stages, { pausedBy: null }), null), null);
  assert.equal(nextAfterSkip(null, 'i1'), null);
});

test('#804 another failure left in the stage pauses the roadmap again: nothing starts', () => {
  assert.equal(nextAfterSkip(paused([stage('s1', [item('i1', 'failed'), item('i2', 'failed'), item('i3')])]), 'i1'), null);
});

test('#804 a cut line reached starts the release, before the stage after it', () => {
  const release = { kind: 'release', id: 'r1', name: 'v1.4', items: [] };
  const stages = [stage('s1', [item('i1', 'failed')]), release, stage('s2', [item('i2')])];
  assert.deepEqual(nextAfterSkip(paused(stages), 'i1'), { release: 'v1.4' });
  assert.equal(nextAfterSkip(paused([stages[0], { ...release, status: 'shipped' }, stages[2]]), 'i1').number, 2);
});

test('#804 the screen\'s folded roadmap reads the same: a stage\'s cut line and a leading one', () => {
  const release = { kind: 'release', id: 'r1', name: 'v1.4', items: [] };
  const stages = [stage('s1', [item('i1', 'failed')]), release, stage('s2', [item('i2')])];
  assert.deepEqual(nextAfterSkip(foldReleases(paused(stages)), 'i1'), { release: 'v1.4' });
  assert.deepEqual(nextAfterSkip(foldReleases(paused([release, stages[0], stages[2]])), 'i1'), { release: 'v1.4' });
});

test('#804 a live roadmap with nothing left asks for its refill; a plain one starts nothing', () => {
  const stages = [stage('s1', [item('i1', 'failed')])];
  assert.deepEqual(nextAfterSkip(paused(stages, { live: true }), 'i1'), { refill: true });
  assert.equal(nextAfterSkip(paused(stages), 'i1'), null);
});

test('#804 a stage put before the running one waits: only the running stage moves on', () => {
  const stages = [stage('s0', [item('i5')]), stage('s1', [item('i1', 'failed'), item('i2', 'running'), item('i3')])];
  assert.deepEqual(ids(nextAfterSkip(paused(stages), 'i1')), ['i3']);
});

test('#804 a stage run on its own: its items only, no cut line, and nothing when it is disabled or gone', () => {
  const release = { kind: 'release', id: 'r1', name: 'v1.4', items: [] };
  const s1 = stage('s1', [item('i1', 'failed'), item('i2')]);
  assert.deepEqual(ids(nextAfterSkip(paused([release, s1], { scope: { stage: 's1' } }), 'i1')), ['i2']);
  assert.equal(nextAfterSkip(paused([{ ...s1, disabled: true }], { scope: { stage: 's1' } }), 'i1'), null);
  assert.equal(nextAfterSkip(paused([s1], { scope: { stage: 'gone' } }), 'i1'), null);
});

test('#804 it never changes the roadmap it reads', () => {
  const r = paused([stage('s1', [item('i1', 'failed'), item('i2')])]);
  const before = JSON.stringify(r);
  nextAfterSkip(r, 'i1');
  assert.equal(JSON.stringify(r), before);
});
