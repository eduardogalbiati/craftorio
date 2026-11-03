// #697: RoadmapModel.waitsFor names the running stage an open stage put before it waits for, and the
// screen's highlight agrees with it (the running stage is Current, the waiting one is the Next).
const test = require('node:test');
const assert = require('node:assert/strict');
const { highlight, waitsFor } = require('../roadmap-model');

const it = (id, status, extra = {}) => ({ id, status, ...extra });
const stage = (id, items, extra = {}) => ({ id, items, ...extra });
const plan = (stages, extra = {}) => ({ state: 'running', stages, ...extra });

test('#697 waitsFor names the running stage when an open stage sits before it', () => {
  const r = plan([stage('s-new', [it('a', 'planned')]), stage('s1', [it('b', 'running')]), stage('s2', [it('c', 'planned')])]);
  assert.equal(waitsFor(r), 1);
});

test('#697 waitsFor is -1 when the first open stage is the running one, or nothing runs', () => {
  const runningFirst = plan([stage('s1', [it('a', 'done')]), stage('s2', [it('b', 'running')]), stage('s3', [it('c', 'planned')])]);
  const idle = plan([stage('s1', [it('a', 'planned')]), stage('s2', [it('b', 'planned')])]);
  assert.deepEqual([waitsFor(runningFirst), waitsFor(idle), waitsFor(plan([]))], [-1, -1, -1]);
});

test('#697 a later run waiting at a human gate or a disabled running stage holds nothing', () => {
  const atGate = plan([stage('s-new', [it('a', 'planned')]), stage('s1', [it('b', 'running', { waiting: true })])]);
  const disabled = plan([stage('s-new', [it('a', 'planned')]), stage('s1', [it('b', 'running')], { disabled: true })]);
  assert.deepEqual([waitsFor(atGate), waitsFor(disabled)], [-1, -1]);
});

test('#697 the highlight agrees: the running stage is current, the waiting stage is the next one', () => {
  const r = plan([stage('s0', [it('z', 'done')]), stage('s-new', [it('a', 'planned')]), stage('s1', [it('b', 'running')])]);
  const h = highlight(r);
  assert.deepEqual([waitsFor(r), h.current, h.next], [2, 2, 1]);
});
