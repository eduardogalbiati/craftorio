// #87 through the Night watch's minute tick: a workspace that never saved its Night watch permissions
// (no night-permissions.json) does not have Skip, so a roadmap run waiting at a human gate is never moved
// on (parked), whatever settings.oracle.parkAfterMinutes says: nothing parked, no oracle.parked entry, no
// notice. A saved list with Skip still parks it. Setup as test/service/roadmap-park-395.test.js: the
// channel module with a fake ctx and a mocked setInterval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const actions = require('../../domains/oracle/oracle-actions');
const night = require('../../domains/night/night-watch');
const roadmaps = require('../../domains/roadmap/roadmap');
const workspace = require('../../domains/workspace/workspace');

const MINUTE = 60e3;
const item = (id, status, extra = {}) => ({ id, workflow: 'fixture-issue.yaml', inputs: {}, mock: true, number: Number(id.replace(/\D/g, '')) || 1, status, runId: null, runs: [], error: null, ...extra });
const plan = (stages) => ({ state: 'running', simulated: true, error: null, pausedBy: null, scope: null, stages, updatedAt: null });
const flush = () => new Promise((r) => setImmediate(r));

function gateRun(runId, waitedMin) {
  return {
    runId, projectId: 'p1', status: 'running', startedAt: new Date(Date.now() - 600 * MINUTE).toISOString(), display: { steps: { review: 'Developer check' } },
    waiting: 1, gates: [{ step_id: 'review', approval_id: `a-${runId}`, requested_at: new Date(Date.now() - waitedMin * MINUTE).toISOString() }],
  };
}

// `allowed` null: night-permissions.json never written
function watched(t, { allowed, parkAfterMinutes, waitedMin }) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'park-skip-87-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = workspace.setupWorkspace(root, { persist: false });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.mkdirSync(ws.oracle, { recursive: true });
  workspace.writeSettings(ws, { oracle: { wakeScope: 'off', parkAfterMinutes } });
  actions.setNightWatch(ws.oracle, { on: true, until: new Date(Date.now() + 8 * 3600e3).toISOString(), by: 'test' });
  if (allowed) fs.writeFileSync(path.join(ws.oracle, 'night-permissions.json'), JSON.stringify({ allowed, updatedAt: new Date().toISOString() }));
  roadmaps.writeRoadmap(ws.backlog, 'p1', plan([{ id: 's1', name: '', note: '', items: [item('i1', 'planned', { runId: 'run-1', runs: ['run-1'] })] }, { id: 's2', name: '', note: '', items: [item('i9', 'planned')] }]));
  const parked = [];
  const notes = [];
  const ctx = {
    ws,
    events: new EventEmitter(),
    active: new Map(),
    activeRuns: () => [gateRun('run-1', waitedMin)],
    liveRun: () => null,
    parkItem: async (a) => { parked.push(`${a.projectId}/${a.itemId}`); },
    notify: (n) => { notes.push(n); },
  };
  require('../../service/channels/nightwatch')(ctx);
  return {
    async tick() { t.mock.timers.tick(MINUTE); await flush(); await flush(); },
    outcome: () => ({ parked: parked.length, logged: night.readNightLog(ws.oracle).filter((e) => e.type === 'oracle.parked').length, notified: notes.length }),
  };
}

for (const parkAfterMinutes of [1, 15]) {
  test(`#87 never-saved permissions: a gate waiting 6 h with parkAfterMinutes ${parkAfterMinutes} is not moved on, logged or notified`, async (t) => {
    const w = watched(t, { allowed: null, parkAfterMinutes, waitedMin: 360 });
    await w.tick();
    assert.deepEqual(w.outcome(), { parked: 0, logged: 0, notified: 0 });
  });
}

test('#87 a saved list with Skip: the same gate is moved on', async (t) => {
  const w = watched(t, { allowed: ['retry', 'skip'], parkAfterMinutes: 15, waitedMin: 360 });
  await w.tick();
  assert.equal(w.outcome().parked, 1);
});
