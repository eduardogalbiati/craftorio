// packages/engine/domains/backlog/backlog-refresh.js (#161): the Backlog Refresh banner's due logic, "Dismiss for today" and
// which issues a finished refresh run updated, for its "refreshed" badge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  dismiss, isRefreshRun, localDay, readDismissed, refreshedIssues, refreshRuns, refreshState, WORKFLOW,
} = require('../../domains/backlog/backlog-refresh');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('WORKFLOW / isRefreshRun: only matches the backlog-refresh.yaml file, by basename', () => {
  assert.equal(WORKFLOW, 'backlog-refresh.yaml');
  assert.equal(isRefreshRun({ file: 'backlog-refresh.yaml' }), true);
  assert.equal(isRefreshRun({ file: 'C:\\x\\workflows\\backlog-refresh.yaml' }), true);
  assert.equal(isRefreshRun({ file: 'other.yaml' }), false);
  assert.equal(isRefreshRun({}), false);
  assert.equal(isRefreshRun(null), false);
});

test('#763 isRefreshRun: a run recorded with a Windows or a POSIX path is recognised on any platform', () => {
  assert.equal(isRefreshRun({ file: 'C:\\Users\\me\\workflows\\backlog-refresh.yaml' }), true);
  assert.equal(isRefreshRun({ file: 'C:/Users/me/workflows/backlog-refresh.yaml' }), true);
  assert.equal(isRefreshRun({ file: '/home/me/workflows/backlog-refresh.yaml' }), true);
  assert.equal(isRefreshRun({ file: 'C:\\x\\workflows\\other.yaml' }), false);
  assert.equal(isRefreshRun({ file: 'C:\\x\\backlog-refresh.yaml\\other.yaml' }), false, 'by basename only');
});

test('refreshRuns: picks the most recent success as "last" and a running/pending run as "running", ignoring other workflows', () => {
  const runs = [
    { file: 'other.yaml', status: 'success', runId: 'x', startedAt: '2026-01-01T00:00:00Z' },
    { file: 'backlog-refresh.yaml', status: 'running', runId: 'live', startedAt: '2026-01-03T00:00:00Z' },
    { file: 'backlog-refresh.yaml', status: 'success', runId: 'y', startedAt: '2026-01-02T00:00:00Z' },
  ];
  const { last, running } = refreshRuns(runs);
  assert.equal(last.runId, 'y');
  assert.equal(running.runId, 'live');
});

test('refreshRuns: a failed run is never "last" (success only)', () => {
  const runs = [{ file: 'backlog-refresh.yaml', status: 'failed', runId: 'f1', startedAt: '2026-01-01T00:00:00Z' }];
  const { last } = refreshRuns(runs);
  assert.equal(last, null);
});

test('refreshState: due when no refresh run ever happened and the interval is on', () => {
  const state = refreshState({ runs: [], intervalHours: 24 });
  assert.equal(state.due, true);
  assert.equal(state.lastRun, null);
  assert.equal(state.merges, null);
  assert.equal(state.hoursAgo, null);
  assert.equal(state.interval, 24);
});

test('refreshState: due when the last run is stale and the base got merges since', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 25 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt, finishedAt: new Date(now - 24 * 3600e3).toISOString(), mock: false }];
  const state = refreshState({ runs, intervalHours: 24, merges: 14, now });
  assert.equal(state.due, true);
  assert.equal(state.hoursAgo, 25);
  assert.equal(state.merges, 14);
  assert.equal(state.since, startedAt);
  assert.deepEqual(state.lastRun, { runId: 'r1', startedAt, mock: false });
});

test('refreshState: not due when the last run is within the interval (not stale)', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 10 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt }];
  const state = refreshState({ runs, intervalHours: 24, merges: 14, now });
  assert.equal(state.due, false);
  assert.equal(state.hoursAgo, 10);
});

test('refreshState: not due when stale but there were no merges since (merges: 0)', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 48 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt }];
  const state = refreshState({ runs, intervalHours: 24, merges: 0, now });
  assert.equal(state.due, false);
  assert.equal(state.merges, 0);
});

test('refreshState: not due when stale but the merge count is unknown (null)', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 48 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt }];
  const state = refreshState({ runs, intervalHours: 24, merges: null, now });
  assert.equal(state.due, false);
  assert.equal(state.merges, null);
});

test('refreshState: not due once dismissed for today, although stale with merges', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 48 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt }];
  const today = localDay(now);
  const state = refreshState({ runs, intervalHours: 24, merges: 5, dismissedOn: today, now });
  assert.equal(state.due, false);
  assert.equal(state.dismissed, true);
});

test('refreshState: a running refresh blocks "due", however stale the last one was', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const runs = [{ file: 'backlog-refresh.yaml', status: 'running', runId: 'live1', startedAt: new Date(now - 100 * 3600e3).toISOString() }];
  const state = refreshState({ runs, intervalHours: 24, merges: 5, now });
  assert.equal(state.due, false);
  assert.deepEqual(state.running, { runId: 'live1', workflow: null });
});

test('refreshState: interval 0 (off) is never due, even stale with merges', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = new Date(now - 100 * 3600e3).toISOString();
  const runs = [{ file: 'backlog-refresh.yaml', status: 'success', runId: 'r1', startedAt }];
  const state = refreshState({ runs, intervalHours: 0, merges: 5, now });
  assert.equal(state.due, false);
  assert.equal(state.interval, 0);
});

test('refreshState: a negative or missing intervalHours normalizes to 0 (off)', () => {
  assert.equal(refreshState({ runs: [], intervalHours: -5 }).interval, 0);
  assert.equal(refreshState({ runs: [], intervalHours: undefined }).interval, 0);
});

test('refreshedIssues: returns the numbers a run updated, within a day of it finishing', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'applied-safe.json'), JSON.stringify({
    results: [{ number: 1, result: 'updated' }, { number: 2, result: 'skipped' }, { number: 3, result: 'updated' }],
  }));
  const finishedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  assert.deepEqual(refreshedIssues(dir, finishedAt).sort(), [1, 3]);
});

test('refreshedIssues: returns [] once more than a day has passed since the run finished', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'applied-safe.json'), JSON.stringify({ results: [{ number: 1, result: 'updated' }] }));
  const finishedAt = new Date(Date.now() - 25 * 3600e3).toISOString();
  assert.deepEqual(refreshedIssues(dir, finishedAt), []);
});

test('refreshedIssues: returns [] with no run directory, no finishedAt, or no applied-safe.json', (t) => {
  const dir = tmpDir(t);
  assert.deepEqual(refreshedIssues(null, new Date().toISOString()), []);
  assert.deepEqual(refreshedIssues(dir, 'not a date'), []);
  assert.deepEqual(refreshedIssues(dir, new Date().toISOString()), []); // no applied-safe.json written
});

test('dismiss / readDismissed: round-trips the dismissed day for a project', (t) => {
  const dir = tmpDir(t);
  assert.equal(readDismissed(dir, 'proj1'), null);
  const now = Date.parse('2026-10-02T15:00:00');
  dismiss(dir, 'proj1', now);
  assert.equal(readDismissed(dir, 'proj1'), localDay(now));
  assert.equal(readDismissed(dir, 'proj2'), null); // another project is untouched
});

test('localDay: formats a timestamp as its local YYYY-MM-DD day', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 10, 0, 0).getTime()), '2026-01-05');
  assert.equal(localDay(new Date(2026, 10, 30, 23, 59, 0).getTime()), '2026-11-30');
});
