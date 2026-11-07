// #807 (review round 2): Stack is refused on the last stage (no stage to start), and the service's
// effectiveMode (the project's runDefaults resolved) wins over the item's inputs. packages/shared/roadmap-model.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../roadmap-model');

const PR = { number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' };
const it = (id, status, extra = {}) => ({ id, status, workflow: 'feature.yaml', inputs: { mode: 'remote' }, runId: `run-${id}`, runs: [], error: null, ...extra });
const stage = (id, items) => ({ id, name: '', note: '', items });

test('#807 stack: refused on the last stage, with its own reason', () => {
  const r = { state: 'running', stages: [stage('s1', [it('a', 'waiting_merge', { pr: PR })])] };
  const w = model.mergeWait(r, 0);
  assert.equal(w.stack.allowed, false);
  assert.match(w.stack.reason, /last stage/);
});

test('#807 stack: an effectiveMode of fork refuses it although the inputs say remote', () => {
  const r = { state: 'running', stages: [stage('s1', [it('a', 'waiting_merge', { pr: PR, effectiveMode: 'fork' })]), stage('s2', [it('b', 'planned', { runId: null })])] };
  const w = model.mergeWait(r, 0);
  assert.equal(w.stack.allowed, false);
  assert.match(w.stack.reason, /Fork/);
});
