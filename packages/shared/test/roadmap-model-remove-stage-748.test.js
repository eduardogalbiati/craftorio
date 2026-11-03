// #748: the reason a roadmap stage cannot be removed ("Remove from roadmap" in the stage's ⋮ menu).
// Acceptance tests written before the code.
//
// Assumed API (packages/shared/roadmap-model.js, the same shape as the other stage actions):
// - allowedActions(roadmap, stage).removeStage → { allowed: boolean, reason: string }, its reason in
//   the interface language (the catalog's `roadmap.*` keys) and '' when allowed;
// - refused while an item of the stage waits at a human gate (RoadmapModel.atGate: running and
//   waiting, or a failed run interrupted at its gate) or runs (status 'running', not waiting);
//   allowed for a stage whose items are planned, done, skipped or failed (not at a gate);
// - ACTIONS lists 'removeStage'.
// The module is loaded inside each test (the new action does not exist yet).
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../i18n');

const load = () => require('../roadmap-model');
const item = (id, status, extra = {}) => ({ id, status, workflow: 'feature.yaml', inputs: {}, runId: status === 'planned' ? null : `run-${id}`, runs: [], error: null, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });
const removeOf = (r, s) => {
  const out = load().allowedActions(r, s).removeStage;
  return { allowed: out?.allowed, reason: out?.reason };
};

test('#748 removeStage: refused while an item of the stage runs, with a reason in the interface language', (t) => {
  t.after(() => I18n.setLanguage('en'));
  const s = stage('st1', [item('a', 'running'), item('b', 'planned')]);
  const r = { state: 'running', stages: [s] };
  const en = removeOf(r, s);
  assert.equal(en.allowed, false);
  assert.equal(typeof en.reason, 'string');
  assert.ok(en.reason.length > 0, 'a refused action says why');
  assert.doesNotMatch(en.reason, /^roadmap\./, 'the catalog has its key (not the raw key)');
  I18n.setLanguage('pt-BR');
  const pt = removeOf(r, s);
  assert.equal(pt.allowed, false);
  assert.notEqual(pt.reason, en.reason, 'translated in pt-BR');
});

test('#748 removeStage: refused while an item of the stage waits at a gate, the reason naming the gate', (t) => {
  t.after(() => I18n.setLanguage('en'));
  I18n.setLanguage('en');
  const s = stage('st1', [item('a', 'running', { waiting: true, gate: 'review' }), item('b', 'done')]);
  const r = { state: 'running', stages: [s] };
  const out = removeOf(r, s);
  assert.equal(out.allowed, false);
  assert.match(out.reason, /gate/i);
});

test('#748 removeStage: refused for a run interrupted at its gate (failed, its run at the gate)', () => {
  const s = stage('st1', [item('a', 'failed', { run: { atGate: true } })]);
  const r = { state: 'paused', stages: [s] };
  const out = removeOf(r, s);
  assert.equal(out.allowed, false);
  assert.ok(out.reason.length > 0);
});

test('#748 removeStage: allowed with an empty reason for an idle or finished stage, a disabled one too', () => {
  const idle = stage('st1', [item('a', 'planned'), item('b', 'done'), item('c', 'skipped')]);
  const off = stage('st2', [item('d', 'planned')], { disabled: true });
  const empty = stage('st3', []);
  const r = { state: 'planned', stages: [idle, off, empty] };
  assert.deepEqual(removeOf(r, idle), { allowed: true, reason: '' });
  assert.deepEqual(removeOf(r, off), { allowed: true, reason: '' });
  assert.deepEqual(removeOf(r, empty), { allowed: true, reason: '' });
});

test('#748 removeStage: allowed while another stage runs (only its own items count)', () => {
  const busy = stage('st1', [item('a', 'running')]);
  const later = stage('st2', [item('b', 'planned')]);
  const r = { state: 'running', stages: [busy, later] };
  assert.deepEqual(removeOf(r, later), { allowed: true, reason: '' });
});

test('#748 ACTIONS lists removeStage', () => {
  assert.equal(load().ACTIONS.includes('removeStage'), true);
});
