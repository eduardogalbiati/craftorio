// #241: packages/engine/domains/agents/agent-inbox.js internals the acceptance tests reach only through the service: a request
// that waits for the owner's click (handle's wait/check), the owner's Do it / Dismiss / Undo (act),
// the gate refusal and waitReason. The owner is plain functions recording in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const agentInbox = require('../../domains/agents/agent-inbox');

function owner({ perform = async () => ({ text: 'done' }), restore = async () => ({ text: 'put back' }) } = {}) {
  const history = [];
  const after = [];
  let n = 0;
  const record = (m) => { const stored = { ts: `2026-10-04T16:10:${String(n++).padStart(2, '0')}.000Z`, ...m }; history.push(stored); return stored; };
  return {
    history,
    after,
    opts: { kinds: ['run.retry', 'skill.restore'], role: 'supervisor', record, perform, after: (r) => after.push(r) },
    act: { history: () => history, role: 'supervisor', record, perform, restore, after: (r) => after.push(r) },
  };
}

test('a request that waits is a pending card, checked first, with no result and no perform', async () => {
  let performed = 0;
  const o = owner({ perform: async () => { performed++; return { text: 'x' }; } });
  const out = await agentInbox.handle({ kind: 'run.retry', params: { runId: 'r1' }, reason: 'flaky', from: 'oracle', ref: 'a1' }, { ...o.opts, wait: () => 'costs money' });
  assert.equal(out.ok, true);
  assert.equal(out.pending, true);
  assert.equal(performed, 0);
  assert.equal(o.history.length, 1);
  assert.equal(o.history[0].pending, true);
  assert.equal(o.history[0].status, 'proposed');
  assert.equal(o.history[0].waits, 'costs money');
  assert.equal(o.after[0].pending, true);
});

test('a waiting request whose check fails is refused at once, not left as a card', async () => {
  const o = owner();
  const out = await agentInbox.handle({ kind: 'run.retry', params: { runId: 'nope' }, from: 'oracle', ref: 'a2' }, { ...o.opts, wait: () => 'costs money', check: () => { throw new Error('Unknown run nope'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /Unknown run nope/);
  assert.equal(o.history[0].pending, undefined);
  assert.match(o.history[1].text, /^Failed: Unknown run nope/);
});

test('a kind that answers a human gate is refused whatever the owner\'s kinds, naming the gate', async () => {
  const o = owner();
  const out = await agentInbox.handle({ kind: 'approval.resolve', params: {}, from: 'oracle', ref: 'g1' }, { ...o.opts, kinds: ['approval.resolve'] });
  assert.equal(out.ok, false);
  assert.match(out.error, /human gate/);
});

test('act do runs a pending card once; a second click is refused', async () => {
  const o = owner({ perform: async (kind, params) => ({ text: `retried ${params.runId}` }) });
  await agentInbox.handle({ kind: 'run.retry', params: { runId: 'r1' }, from: 'oracle', ref: 'a3' }, { ...o.opts, wait: () => 'costs money' });
  const out = await agentInbox.act({ ref: 'a3', action: 'do' }, o.act);
  assert.equal(out.ok, true);
  assert.equal(out.text, 'Done: retried r1');
  assert.equal(o.after.at(-1).auto, false);
  await assert.rejects(agentInbox.act({ ref: 'a3', action: 'do' }, o.act), /does not wait/);
});

test('act dismiss drops a pending card without performing it', async () => {
  let performed = 0;
  const o = owner({ perform: async () => { performed++; return {}; } });
  await agentInbox.handle({ kind: 'run.retry', params: { runId: 'r1' }, from: 'oracle', ref: 'a4' }, { ...o.opts, wait: () => 'costs money' });
  const out = await agentInbox.act({ ref: 'a4', action: 'dismiss' }, o.act);
  assert.equal(out.ok, true);
  assert.equal(performed, 0);
  assert.equal(o.history.at(-1).dismissed, true);
  await assert.rejects(agentInbox.act({ ref: 'a4', action: 'do' }, o.act), /does not wait/);
});

test('act undo puts back the backup a done request kept, once', async () => {
  const undone = [];
  const o = owner({ perform: async () => ({ text: 'restored', backup: { undo: { type: 'dir', file: 'copy' } } }), restore: async (u) => { undone.push(u); return { text: 'the edited copy is back' }; } });
  await agentInbox.handle({ kind: 'skill.restore', params: { id: 's' }, from: 'oracle', ref: 'a5' }, o.opts);
  assert.deepEqual(o.history.at(-1).undo, { type: 'dir', file: 'copy' });
  const out = await agentInbox.act({ ref: 'a5', action: 'undo' }, o.act);
  assert.equal(out.text, 'Undone: the edited copy is back');
  assert.deepEqual(undone, [{ type: 'dir', file: 'copy' }]);
  await assert.rejects(agentInbox.act({ ref: 'a5', action: 'undo' }, o.act), /nothing to undo/);
});

test('waitReason: click kinds always wait; under an active watch only allowed permissions run', () => {
  const watch = { active: true };
  assert.match(agentInbox.waitReason('run.retry', {}, { clickKinds: ['run.retry'] }), /click/);
  assert.equal(agentInbox.waitReason('dispatch.restart', {}, {}), null);
  assert.equal(agentInbox.waitReason('dispatch.restart', {}, { watch, allowed: ['dispatch'] }), null);
  assert.match(agentInbox.waitReason('dispatch.restart', {}, { watch, allowed: [] }), /"dispatch"/);
  assert.match(agentInbox.waitReason('run.stop', {}, { watch, allowed: ['dispatch'] }), /never runs it alone/);
  assert.equal(agentInbox.waitReason('roadmap.skip', {}, { watch, allowed: ['skip'] }), null);
});
