// Internals of #188 / #228 the acceptance tests do not reach: the per-calibration split
// (repo-performance byCalibration), the app's heartbeat log (src/domains/session/app-sessions.js) and the index's
// run_figures cache (src/domains/workspace/store.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { byCalibration } = require('../src/domains/project/repo-performance');
const { beat, GAP_MS, readAppSessions } = require('../src/domains/session/app-sessions');

test('byCalibration: a run takes the calibration of the latest plan before it that planned one of its issues', () => {
  const answers = [
    { ts: '2026-10-01T00:00:00Z', projectId: 'p', calibration: 2, groups: [{ issues: [1, 2], stage: 1 }, { issues: [3], stage: 1 }] },
    { ts: '2026-10-02T00:00:00Z', projectId: 'p', calibration: 4, groups: [{ issues: [1], stage: 1 }, { issues: [5], stage: 2 }] },
  ];
  const runs = [
    { runId: 'a', projectId: 'p', startedAt: '2026-10-01T01:00:00Z', issues: [{ number: 1 }], costUsd: 4, conflict: true, reviewRounds: 2 },
    { runId: 'b', projectId: 'p', startedAt: '2026-10-01T02:00:00Z', issues: [3], costUsd: 2, conflict: false, reviewRounds: 1 },
    { runId: 'c', projectId: 'p', startedAt: '2026-10-02T01:00:00Z', issues: [1, 5], costUsd: 6, conflict: false, reviewRounds: 1 },
    { runId: 'unplanned', projectId: 'p', startedAt: '2026-10-02T01:00:00Z', issues: [99], costUsd: 100 },
  ];
  const out = Object.fromEntries(byCalibration({ runs, answers }).map((c) => [c.calibration, c]));
  assert.equal(out[2].runs, 2);
  assert.equal(out[2].resolveMergeShare, 0.5);
  assert.equal(out[2].reviewRounds, 1.5);
  assert.equal(out[2].costPerIssue, 3);
  assert.equal(out[2].runsPerStage, 2); // two groups in one stage
  assert.equal(out[4].runs, 1);
  assert.equal(out[4].costPerIssue, 3);
  assert.equal(out[4].runsPerStage, 1); // two groups over two stages
});

test('app-sessions: beats within the gap extend the session; a later beat starts a new one (the machine slept)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-sessions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  beat(dir, t0);
  beat(dir, t0 + 60e3);
  beat(dir, t0 + 60e3 + GAP_MS + 1);
  const s = readAppSessions(dir);
  assert.equal(s.length, 2);
  assert.equal(s[0].end, new Date(t0 + 60e3).toISOString());
  assert.equal(s[1].start, new Date(t0 + 60e3 + GAP_MS + 1).toISOString());
});

test('store: run_figures keeps a run\'s figures for one signature and drops them with the run', (t) => {
  const { openStore } = require('../src/domains/workspace/store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figures-store-'));
  const ws = { root, runs: path.join(root, 'runs'), backlog: path.join(root, 'backlog') };
  const store = openStore(ws);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.putRunFigures('r1', 'sig-1', { costUsd: 3 });
  assert.deepEqual(store.runFigures('r1', 'sig-1'), { costUsd: 3 });
  assert.equal(store.runFigures('r1', 'sig-2'), null);
  store.deleteRuns(['r1']);
  assert.equal(store.runFigures('r1', 'sig-1'), null);
});
