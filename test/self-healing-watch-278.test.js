// #278 Self-healing: the standing watch and acting alone by day (src/domains/oracle/oracle-actions.js, src/domains/oracle/oracle.js).
// Acceptance tests written before the code. The API they pin down (the developer implements it):
//   - settings.oracle.selfHealing, default false (workspace DEFAULT_SETTINGS.oracle.selfHealing === false).
//   - oracle-actions watchState(dir, settings, now = Date.now()) → { on, until, startedAt, by, active,
//     selfHealing }: with settings.oracle.selfHealing true the watch is active with NO end time
//     (until null, selfHealing true), whatever night-watch.json says; with it off (or missing) it is
//     exactly nightWatch(dir, now) plus selfHealing: false (the Night watch keeps its meaning).
//   - nightDecision(card, watchState(...), { allowed }) is unchanged and decides by day the same way.
//   - createOracle({ settings: () => ({ oracle: { selfHealing: true } }), ... }).propose(): with no
//     Night watch (by day), a card whose permission the owner checked runs alone (auto, backup, Undo,
//     one notify() call, oracle.action auto in the night log), exactly as under the Night watch; a card
//     without the permission stays proposed (perform never called) and is logged oracle.blocked
//     (reason permission) for its owner.
// Invariants also guarded here (already green today): NEVER_ALLOWED is unchanged and can never be saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const actions = require('../src/domains/oracle/oracle-actions');
const night = require('../src/domains/night/night-watch');
const oracle = require('../src/domains/oracle/oracle');
const workspace = require('../src/workspace');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-healing-278-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const ON = { oracle: { dailyBudgetUsd: 20, selfHealing: true } };
const OFF = { oracle: { dailyBudgetUsd: 20, selfHealing: false } };
// a daytime clock: 14:00 UTC
const DAY = Date.parse('2026-10-04T14:00:00.000Z');

test('#278 settings: Self-healing is off by default', () => {
  assert.equal(workspace.DEFAULT_SETTINGS.oracle.selfHealing, false);
});

test('#278 watchState: Self-healing on is an active watch with no end time, without any Night watch file', (t) => {
  const { watchState } = actions;
  const w = watchState(tmpDir(t), ON, DAY);
  assert.equal(w.active, true);
  assert.equal(w.until, null);
  assert.equal(w.selfHealing, true);
});

test('#278 watchState: switch off and no Night watch is inactive; a missing setting reads as off', (t) => {
  const { watchState } = actions;
  const dir = tmpDir(t);
  for (const settings of [OFF, {}, { oracle: {} }]) {
    const w = watchState(dir, settings, DAY);
    assert.equal(w.active, false, JSON.stringify(settings));
    assert.equal(w.selfHealing, false, JSON.stringify(settings));
  }
});

test('#278 watchState: switch off keeps the Night watch\'s meaning (its end time, active before it only)', (t) => {
  const { watchState } = actions;
  const dir = tmpDir(t);
  const until = new Date(Date.now() + 2 * 3600e3).toISOString();
  actions.setNightWatch(dir, { on: true, until, by: 'test' });
  const w = watchState(dir, OFF);
  const n = actions.nightWatch(dir);
  assert.equal(w.active, true);
  assert.equal(w.until, n.until);
  assert.equal(w.startedAt, n.startedAt);
  assert.equal(w.selfHealing, false);
  assert.equal(watchState(dir, OFF, Date.parse(until) + 1000).active, false);
});

test('#278 nightDecision under Self-healing by day: a checked permission runs alone; unchecked, content-asked, or past LOOP_CAP do not', (t) => {
  const { watchState } = actions;
  const w = watchState(tmpDir(t), ON, DAY);
  const card = actions.actionCard({ kind: 'dispatch.restart', params: {}, requestedBy: 'oracle' });
  assert.equal(actions.nightDecision(card, w, { allowed: ['dispatch'] }).alone, true);
  assert.equal(actions.nightDecision(card, w, { allowed: ['retry'] }).reason, 'permission');
  assert.equal(actions.nightDecision({ ...card, requestedBy: 'content' }, w, { allowed: ['dispatch'] }).reason, 'content');
  assert.equal(actions.nightDecision(card, w, { allowed: ['dispatch'], actionsOnTarget: night.LOOP_CAP }).reason, 'loop');
});

test('#278 nightDecision under Self-healing: a kind that never runs alone stays with the owner even with every permission checked', (t) => {
  const { watchState } = actions;
  const w = watchState(tmpDir(t), ON, DAY);
  const all = night.PERMISSIONS.map((p) => p.id);
  for (const input of [{ kind: 'run.retry', params: { runId: 'r1' } }, { kind: 'run.stop', params: { runId: 'r1' } }, { kind: 'issue.update', params: { projectId: 'p', number: 1, body: 'x', mode: 'comment' } }]) {
    const d = actions.nightDecision(actions.actionCard({ ...input, requestedBy: 'oracle' }), w, { allowed: all });
    assert.equal(d.alone, false, input.kind);
  }
});

test('#278 invariant: NEVER_ALLOWED is unchanged and none of it can be checked (guard, green today)', (t) => {
  assert.deepEqual(night.NEVER_ALLOWED.map((n) => n.id), ['answer-gate', 'close-issue', 'delete-data', 'paid-calls', 'push', 'resume-paused']); // #368: only the owner resumes a paused run
  const dir = tmpDir(t);
  for (const n of night.NEVER_ALLOWED) assert.throws(() => night.savePermissions(dir, ['retry', n.id]), /never allowed/);
  assert.equal(night.PERMISSIONS.some((p) => night.NEVER_ALLOWED.some((n) => n.id === p.id)), false);
});

// ---- the Oracle by day under Self-healing ------------------------------------------------------

function selfHealingOracle(t, { allowed, settings = ON }) {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'night-permissions.json'), JSON.stringify({ allowed, updatedAt: new Date().toISOString() }));
  const performed = [];
  const notices = [];
  const o = oracle.createOracle({
    dir: () => dir, tools: () => [], bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); }, skillsDirs: () => [], resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('Simulation only: no real model in tests.'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }), settings: () => settings,
    perform: async (a) => { performed.push(a.kind); return { text: 'Restarted the dispatch.', backup: { text: 'A copy of the roadmap file.', undo: { type: 'file' } } }; },
    restore: async () => ({ text: 'Put back.' }),
    notify: (n) => notices.push(n),
  });
  t.after(() => o.release());
  return { o, dir, performed, notices };
}

test('#278 Oracle by day, Self-healing on: an action whose permission is checked runs alone, with backup, Undo and one notification', async (t) => {
  const { o, dir, performed, notices } = selfHealingOracle(t, { allowed: ['dispatch'] });
  const out = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'oracle' }, { mock: true });
  assert.equal(out.auto, true);
  assert.equal(out.status, 'done');
  assert.deepEqual(performed, ['dispatch.restart']);
  assert.equal(notices.length, 1);
  const card = o.history().find((m) => m.action?.id === out.id).action;
  assert.equal(card.result.auto, true);
  assert.equal(card.result.undoable, true);
  const logged = night.readNightLog(dir).filter((e) => e.type === 'oracle.action');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].auto, true);
  assert.equal(logged[0].permission, 'dispatch');
});

test('#278 Oracle by day, Self-healing on: an action without the permission waits for its owner (not performed, logged blocked)', async (t) => {
  const { o, dir, performed, notices } = selfHealingOracle(t, { allowed: ['retry'] });
  const out = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'oracle' }, { mock: true });
  assert.equal(out.auto, false);
  assert.equal(out.status, 'proposed');
  assert.deepEqual(performed, []);
  assert.equal(notices.length, 0);
  const blocked = night.readNightLog(dir).filter((e) => e.type === 'oracle.blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, 'permission');
});

test('#278 Oracle by day, Self-healing off and no Night watch: behaves as today (proposed, nothing logged as blocked)', async (t) => {
  const { o, dir, performed } = selfHealingOracle(t, { allowed: ['dispatch'], settings: OFF });
  const out = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'oracle' }, { mock: true });
  assert.equal(out.auto, false);
  assert.deepEqual(performed, []);
  assert.deepEqual(night.readNightLog(dir).filter((e) => e.type === 'oracle.blocked' || e.type === 'oracle.action'), []);
});
