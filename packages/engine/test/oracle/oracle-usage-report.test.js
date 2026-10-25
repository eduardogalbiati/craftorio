// #244 internals: the spend report (scripts/oracle-usage-report.js) and which wake events are
// routine notices (packages/engine/domains/oracle/oracle-wake.js routineNotice).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { report, table } = require('../../../../scripts/oracle-usage-report');
const { routineNotice } = require('../../domains/oracle/oracle-wake');

const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

test('report: per-turn cost per day, turns by kind (a usage line with no answer is a handoff), wakes and actions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), jsonl([
    { ts: '2026-10-02T08:00:00.000Z', sessionId: 's', costUsd: 0.5, tokens: { cache_read: 1000, cache_write: 200, output: 30 } },
    { ts: '2026-10-02T09:00:00.000Z', sessionId: 's', costUsd: 1.2, tokens: {} },
    { ts: '2026-10-02T10:00:00.000Z', sessionId: 's', costUsd: 2.0, tokens: {} },
  ]));
  fs.writeFileSync(path.join(dir, 'messages.jsonl'), jsonl([
    { id: 'u1', ts: '2026-10-02T07:59:00.000Z', role: 'user', text: 'q' },
    { id: 'o1', ts: '2026-10-02T08:00:01.000Z', role: 'oracle', text: 'a', contextTokens: 20000 },
    { id: 'w', ts: '2026-10-02T08:59:00.000Z', role: 'system', kind: 'wake', events: ['x'] },
    { id: 'c', ts: '2026-10-02T08:59:30.000Z', role: 'oracle', kind: 'action', action: { id: 'a1' } },
    { id: 'o2', ts: '2026-10-02T09:00:01.000Z', role: 'oracle', text: 'b', wake: true, contextTokens: 30000 },
    { id: 'r', ts: '2026-10-02T11:00:00.000Z', role: 'system', kind: 'wake-refused', events: ['y'] },
    { id: 'n', ts: '2026-10-02T11:00:00.000Z', role: 'system', kind: 'notice', runId: 'r-1', text: 'Run r-1 finished succeeded' },
  ]));
  const [day] = report(dir);
  assert.equal(day.day, '2026-10-02');
  assert.deepEqual(day.turns, { wake: 1, owner: 1, handoff: 1 });
  assert.ok(Math.abs(day.realUsd - 2.0) < 1e-9);
  assert.ok(Math.abs(day.reportedUsd - 3.7) < 1e-9);
  assert.ok(Math.abs(day.costByKind.wake - 0.7) < 1e-9);
  assert.equal(day.contextStart, 20000);
  assert.equal(day.contextPeak, 30000);
  assert.equal(day.wakesAnswered, 1);
  assert.equal(day.wakesRefused, 1);
  assert.equal(day.notices, 1);
  assert.equal(day.wakeActions, 1);
  assert.match(table([day]), /\*\*\$2\.00\*\*/);
});

test('routineNotice: a run seen in another process is routine; a supervisor decision other than retry/resume needs the model', () => {
  assert.match(routineNotice({ type: 'run.elsewhere', run_id: 'r-e' }, 'interrupted').text, /r-e.*another app process/);
  assert.equal(routineNotice({ type: 'supervisor.decision', run_id: 'r-s', action: 'escalate' }, 'stall'), null);
  assert.equal(routineNotice({ type: 'approval.requested', run_id: 'r-g' }, 'gate'), null);
  assert.equal(routineNotice({ type: 'workflow.finished', run_id: 'r-m', status: 'failed', error: 'merge conflict' }, 'merge'), null);
});
