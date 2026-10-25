// #278 Self-healing, internal details the acceptance tests do not pin down (developer's tests):
// the detectors' event copies, a CLI that reports no cost, the report's days, the standing watch's
// record and loop window, and the owners' inbox rule by day. Pure functions and files in a temp
// folder: no service, no model call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const actions = require('../domains/oracle/oracle-actions');
const agentInbox = require('../domains/agents/agent-inbox');
const night = require('../domains/night/night-watch');
const notifier = require('../domains/workspace/notifications');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-healing-internals-278-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const TOKENS = { input: 100, output: 2000, cache_read: 50000 };
const received = (cost) => ({ ts: '2026-10-04T10:01:00.000Z', type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'implement', usage: TOKENS, cost_usd: cost });

test('#278 cost-gap: a CLI that reports no cost (cost_usd null) is not a finding; a simulated run never is', () => {
  const kinds = (events) => night.detectSelfHealing([{ runId: 'r1', events }]).map((f) => f.kind);
  assert.deepEqual(kinds([received(null)]), []);
  assert.deepEqual(kinds([received(undefined)]), []);
  assert.deepEqual(kinds([received(0)]), ['cost-gap']);
  assert.deepEqual(kinds([{ ts: '2026-10-04T10:00:00.000Z', type: 'workflow.started', mock: true }, received(0)]), []);
});

test('#278 selfHealingEvent: keeps only what the detectors read, and the copies give the same findings', () => {
  const events = [
    { ts: '2026-10-04T10:00:00.000Z', type: 'workflow.started', run_id: 'r1', project_id: 'p1', issues: [{ number: 7 }], mock: false, task: 'x'.repeat(5000) },
    { ts: '2026-10-04T10:00:10.000Z', type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'implement', prompt: 'y'.repeat(5000) },
    ...[1, 2, 3].flatMap((i) => [
      { ts: `2026-10-04T10:0${i}:00.000Z`, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'tool_call', id: `t${i}`, name: 'Bash', input: { command: 'npm run lint' } } },
      { ts: `2026-10-04T10:0${i}:30.000Z`, type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'tool_result', id: `t${i}`, output: 'z'.repeat(5000), is_error: true } },
    ]),
    { ts: '2026-10-04T10:05:00.000Z', type: 'session.stream', session_id: 's1', turn: 1, item: { kind: 'text', text: 'thinking' } },
    { ...received(0), ts: '2026-10-04T10:06:00.000Z' },
  ];
  const read = events.map((e) => night.selfHealingEvent(e));
  assert.equal(read[0].trigger, false);
  assert.equal(read[0].event.task, undefined);
  assert.equal(read[1].event.prompt, undefined);
  assert.equal(read.at(-2), null, 'an event no detector reads is dropped');
  assert.equal(read.at(-1).trigger, true);
  assert.ok(read[3].event.item.output.length <= 300, 'a tool output is clipped');
  const full = night.detectSelfHealing([{ runId: 'r1', events }]);
  const slim = night.detectSelfHealing([{ runId: 'r1', events: read.filter(Boolean).map((r) => r.event) }]);
  assert.deepEqual(slim.map((f) => `${f.kind} ${f.projectId} ${f.since}`), full.map((f) => `${f.kind} ${f.projectId} ${f.since}`));
  assert.deepEqual(full.map((f) => f.kind), ['cost-gap', 'repeat']);
});

test('#278 selfHealingDays: one window per UTC day of the standing watch; the nights ignore its entries', () => {
  const log = [
    { ts: '2026-10-02T20:00:00.000Z', type: 'oracle.watch', on: true, until: null, startedAt: '2026-10-02T20:00:00.000Z', by: 'Self-healing', selfHealing: true },
    { ts: '2026-10-04T09:30:00.000Z', type: 'oracle.watch', on: false, until: null, startedAt: '2026-10-02T20:00:00.000Z', by: 'Self-healing', selfHealing: true },
  ];
  const days = night.selfHealingDays(log, Date.parse('2026-10-05T12:00:00.000Z'));
  assert.deepEqual(days.map((d) => d.day), ['2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(days[0].startedAt, '2026-10-02T20:00:00.000Z');
  assert.equal(days[0].until, '2026-10-03T00:00:00.000Z');
  assert.equal(days[0].endedAt, null);
  assert.equal(days[1].startedAt, '2026-10-03T00:00:00.000Z');
  assert.equal(days[2].endedAt, '2026-10-04T09:30:00.000Z');
  assert.deepEqual(night.nightsOf(log), []);
  // still on: the day in progress has no end yet, and nightMetrics reads it as ongoing
  const now = Date.parse('2026-10-03T06:00:00.000Z');
  const open = night.selfHealingDays(log.slice(0, 1), now);
  assert.deepEqual(open.map((d) => [d.day, d.endedAt]), [['2026-10-02', null], ['2026-10-03', null]]);
  const m = night.nightMetrics({ night: open[1], log, now });
  assert.equal(m.window.ongoing, true);
  assert.equal(m.window.to, '2026-10-03T06:00:00.000Z');
});

test('#278 selfHealingMetrics: an action blocked in an owner\'s inbox waits for the owner, counted once with its escalation', () => {
  const day = '2026-10-04';
  const log = [
    { ts: `${day}T10:00:00.000Z`, type: 'oracle.blocked', actionId: 'a1', reason: 'permission' },
    { ts: `${day}T10:00:00.000Z`, type: 'oracle.escalated', actionId: 'a1', reason: 'permission' },
    { ts: `${day}T11:00:00.000Z`, type: 'oracle.blocked', actionId: 'inbox-1', reason: 'permission', owner: 'product-owner' },
    { ts: `${day}T12:00:00.000Z`, type: 'oracle.action', actionId: 'a2', auto: true, ok: false },
  ];
  const m = night.selfHealingMetrics({ log, usage: [], day });
  assert.equal(m.waiting, 2);
  assert.equal(m.repaired, 0);
  assert.match(night.selfHealingSummary(m), /0 detected, 0 repaired alone, 2 waiting for you, US\$ 0\.00 \(0 tokens\)/);
});

test('#278 markSelfHealing: records the standing watch once, and its end once', (t) => {
  const dir = tmpDir(t);
  const now = Date.parse('2026-10-04T08:00:00.000Z');
  const on = actions.markSelfHealing(dir, true, now);
  assert.deepEqual(on, { changed: true, since: '2026-10-04T08:00:00.000Z' });
  assert.equal(actions.markSelfHealing(dir, true, now + 5000).changed, false);
  assert.equal(actions.watchState(dir, { oracle: { selfHealing: true } }).startedAt, '2026-10-04T08:00:00.000Z');
  assert.deepEqual(actions.markSelfHealing(dir, false), { changed: true, since: '2026-10-04T08:00:00.000Z' });
  assert.equal(actions.markSelfHealing(dir, false).changed, false);
});

test('#278 watchSince: a night counts from its start; Self-healing from the start of the UTC day, or its own start if later', () => {
  const now = Date.parse('2026-10-04T14:00:00.000Z');
  assert.equal(actions.watchSince({ active: true, selfHealing: false, startedAt: '2026-10-03T22:00:00.000Z' }, now), '2026-10-03T22:00:00.000Z');
  assert.equal(actions.watchSince({ active: true, selfHealing: true, startedAt: '2026-10-01T09:00:00.000Z' }, now), '2026-10-04T00:00:00.000Z');
  assert.equal(actions.watchSince({ active: true, selfHealing: true, startedAt: '2026-10-04T09:00:00.000Z' }, now), '2026-10-04T09:00:00.000Z');
  assert.equal(actions.watchSince({ active: true, selfHealing: true, startedAt: null }, now), '2026-10-04T00:00:00.000Z');
});

test('#278 waitReason by day under Self-healing: a checked permission runs alone, an unchecked one waits, a kind without permission keeps the daytime rule', () => {
  const watch = { active: true, selfHealing: true };
  const opts = (allowed) => ({ clickKinds: ['queue.assign'], confirmKinds: ['issue.file', 'issue.close'], watch, allowed });
  assert.equal(agentInbox.waitReason('issue.file', {}, opts(['file-issue'])), null);
  assert.match(agentInbox.waitReason('issue.file', {}, opts([])), /Self-healing does not allow it \(permission "file-issue"\)/);
  assert.match(agentInbox.waitReason('issue.close', {}, opts(['file-issue'])), /publishes or is hard to reverse/);
  assert.equal(agentInbox.waitReason('roadmap.note', {}, opts([])), null);
  assert.match(agentInbox.waitReason('queue.assign', {}, opts(['file-issue'])), /starts a run/);
  // the Night watch keeps its wording and its rule
  assert.match(agentInbox.waitReason('issue.close', {}, { ...opts([]), watch: { active: true, selfHealing: false } }), /The Night watch never runs it alone/);
});

test('#278 findingsWaitingNotice: one notice for the notification center, opening the Night watch', () => {
  const n = notifier.findingsWaitingNotice({ text: 'Paused by budget: it resumes tomorrow.' });
  assert.equal(n.kind, 'oracle');
  assert.match(n.title, /findings are waiting/);
  assert.match(n.body, /Paused by budget/);
  assert.deepEqual(n.target, { view: 'nightwatch' });
});
