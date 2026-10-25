// Keep awake (#162): the rule that decides there is work to stay awake for (workToDo), the switch's
// status line (keepAwakeLabel) and the blocker's owner (createKeepAwake), all pure of Electron (a
// fake powerSaveBlocker stands in for the real one, held by apps/desktop/host/main.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { BLOCKER_TYPE, createKeepAwake, keepAwakeLabel, workToDo } = require('../../host/keep-awake');

// ---- workToDo -----------------------------------------------------------------------------------

test('workToDo: no runs, roadmaps or queue is not active', () => {
  assert.deepEqual(workToDo(), { active: false, runs: 0, running: 0, waiting: 0, roadmaps: [], queued: 0 });
  assert.deepEqual(workToDo({}), { active: false, runs: 0, running: 0, waiting: 0, roadmaps: [], queued: 0 });
});

test('workToDo: one running run is active', () => {
  const w = workToDo({ runs: [{ waiting: false }] });
  assert.equal(w.active, true);
  assert.equal(w.runs, 1);
  assert.equal(w.running, 1);
  assert.equal(w.waiting, 0);
});

test('workToDo: runs only waiting at a gate are not active on their own', () => {
  const w = workToDo({ runs: [{ waiting: true }, { waiting: true }] });
  assert.equal(w.active, false);
  assert.equal(w.runs, 0, 'a waiting run with nothing to continue to does not keep the computer awake');
  assert.equal(w.waiting, 2);
});

test('workToDo: a waiting run plus a running roadmap is active, and counts the waiting run', () => {
  const w = workToDo({ runs: [{ waiting: false }, { waiting: true }], roadmaps: [{ state: 'running', stage: 2, of: 4 }] });
  assert.equal(w.active, true);
  assert.equal(w.runs, 2, 'running + waiting, since the roadmap continues after the gate');
  assert.equal(w.running, 1);
  assert.equal(w.waiting, 1);
});

test('workToDo: a waiting run plus a non-empty queue is active, and counts the waiting run', () => {
  const w = workToDo({ runs: [{ waiting: true }], queued: 3 });
  assert.equal(w.active, true);
  assert.equal(w.runs, 1);
});

test('workToDo: roadmaps not in state "running" are ignored', () => {
  const w = workToDo({ runs: [{ waiting: true }], roadmaps: [{ state: 'planned' }, { state: 'paused' }, { state: 'done' }] });
  assert.equal(w.active, false);
  assert.deepEqual(w.roadmaps, []);
  assert.equal(w.runs, 0);
});

test('workToDo: queued is floored, and a negative or non-numeric value becomes 0', () => {
  assert.equal(workToDo({ queued: 2.9 }).queued, 2);
  assert.equal(workToDo({ queued: -5 }).queued, 0);
  assert.equal(workToDo({ queued: NaN }).queued, 0);
  assert.equal(workToDo({ queued: 'nope' }).queued, 0);
  assert.equal(workToDo({ queued: '4' }).queued, 4);
});

// ---- keepAwakeLabel -------------------------------------------------------------------------------

test('keepAwakeLabel: the switch is off', () => {
  assert.equal(keepAwakeLabel({ enabled: false }), 'Off');
  assert.equal(keepAwakeLabel({ enabled: false, holding: true, work: { active: true, runs: 2 } }), 'Off');
});

test('keepAwakeLabel: on with no work is waiting for work', () => {
  assert.equal(keepAwakeLabel({ enabled: true, work: { active: false } }), 'On: waiting for work');
  assert.equal(keepAwakeLabel({ enabled: true }), 'On: waiting for work');
});

test('keepAwakeLabel: holding, with runs and a roadmap stage, reports them as Active', () => {
  const work = { active: true, runs: 2, roadmaps: [{ stage: 3, of: 6 }] };
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work }), 'Active: 2 runs, roadmap stage 3/6');
});

test('keepAwakeLabel: on but not holding yet (the blocker has not started) uses the On: prefix', () => {
  const work = { active: true, runs: 2, roadmaps: [{ stage: 3, of: 6 }] };
  assert.equal(keepAwakeLabel({ enabled: true, holding: false, work }), 'On: 2 runs, roadmap stage 3/6');
});

test('keepAwakeLabel: a roadmap with no stage (stage or of is 0) just says "roadmap"', () => {
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work: { active: true, runs: 0, roadmaps: [{ stage: 0, of: 6 }] } }), 'Active: roadmap');
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work: { active: true, runs: 0, roadmaps: [{ stage: 3, of: 0 }] } }), 'Active: roadmap');
});

test('keepAwakeLabel: two or more roadmaps are counted instead of naming a stage', () => {
  const work = { active: true, runs: 0, roadmaps: [{ stage: 1, of: 2 }, { stage: 3, of: 4 }] };
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work }), 'Active: 2 roadmaps');
});

test('keepAwakeLabel: queued items are reported, and a single run is singular', () => {
  assert.equal(keepAwakeLabel({ enabled: true, holding: true, work: { active: true, runs: 1, queued: 5 } }), 'Active: 1 run, 5 queued');
});

// ---- createKeepAwake ------------------------------------------------------------------------------

function fakeBlocker() {
  const started = new Set();
  const starts = [];
  const stops = [];
  let nextId = 1;
  return {
    starts,
    stops,
    start(type) { starts.push(type); const id = nextId++; started.add(id); return id; },
    stop(id) { stops.push(id); started.delete(id); },
    isStarted(id) { return started.has(id); },
  };
}

test('createKeepAwake: holds the blocker with prevent-app-suspension while there is work, and does not start it twice', () => {
  const blocker = fakeBlocker();
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => ({ runs: [{ waiting: false }] }) });
  const s1 = ka.update();
  assert.equal(blocker.starts.length, 1);
  assert.equal(blocker.starts[0], BLOCKER_TYPE);
  assert.equal(s1.holding, true);
  assert.equal(s1.enabled, true);
  const s2 = ka.update();
  assert.equal(blocker.starts.length, 1, 'already holding: not started again');
  assert.equal(s2.holding, true);
});

test('createKeepAwake: releases the blocker once the work is gone, or the switch turns off', () => {
  const blocker = fakeBlocker();
  let work = { runs: [{ waiting: false }] };
  let enabled = true;
  const ka = createKeepAwake({ blocker, enabled: () => enabled, readWork: () => work });
  ka.update();
  assert.equal(ka.state().holding, true);

  work = {};
  let s = ka.update();
  assert.equal(s.holding, false);
  assert.equal(blocker.stops.length, 1);

  work = { runs: [{ waiting: false }] };
  ka.update();
  assert.equal(ka.state().holding, true);
  enabled = false;
  s = ka.update();
  assert.equal(s.holding, false);
  assert.equal(s.enabled, false);
});

test('createKeepAwake: stop() releases the blocker directly', () => {
  const blocker = fakeBlocker();
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => ({ runs: [{ waiting: false }] }) });
  ka.update();
  assert.equal(ka.state().holding, true);
  ka.stop();
  assert.equal(ka.state().holding, false);
  assert.equal(blocker.stops.length, 1);
});

test('createKeepAwake: a failed start sets an error but leaves the switch on, and a later update retries it', () => {
  let fail = true;
  const blocker = {
    starts: [],
    start(type) { blocker.starts.push(type); if (fail) throw new Error('denied'); return 1; },
    stop() {},
    isStarted(id) { return id === 1; },
  };
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => ({ runs: [{ waiting: false }] }) });
  let s = ka.update();
  assert.equal(s.holding, false);
  assert.equal(s.enabled, true);
  assert.match(s.error, /Could not keep the computer awake: denied/);

  fail = false;
  s = ka.update();
  assert.equal(s.holding, true);
  assert.equal(s.error, null);
  assert.equal(blocker.starts.length, 2, 'retried on the next update');
});

test('createKeepAwake: a start the system does not accept sets an error instead of crashing', () => {
  const blocker = { start: () => 99, stop() {}, isStarted: () => false };
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => ({ runs: [{ waiting: false }] }) });
  const s = ka.update();
  assert.equal(s.holding, false);
  assert.match(s.error, /did not accept/);
});

test('createKeepAwake: onChange fires only when the state actually changes', () => {
  const blocker = fakeBlocker();
  const changes = [];
  let work = { runs: [{ waiting: false }] };
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => work, onChange: (s) => changes.push(s) });
  ka.update();
  ka.update();
  assert.equal(changes.length, 1, 'the second update changed nothing');
  work = { runs: [{ waiting: false }, { waiting: false }] };
  ka.update();
  assert.equal(changes.length, 2);
});

test('createKeepAwake: readWork throwing keeps the previous work instead of clearing it', () => {
  const blocker = fakeBlocker();
  let work = { runs: [{ waiting: false }] };
  const ka = createKeepAwake({ blocker, enabled: () => true, readWork: () => { if (work === 'throw') throw new Error('disk error'); return work; } });
  let s = ka.update();
  assert.equal(s.work.runs, 1);
  work = 'throw';
  s = ka.update();
  assert.equal(s.work.runs, 1, 'kept the previous work');
  assert.equal(s.holding, true);
});

test('createKeepAwake: enabled() throwing is treated as off, releasing the blocker', () => {
  const blocker = fakeBlocker();
  let fail = false;
  const ka = createKeepAwake({ blocker, enabled: () => { if (fail) throw new Error('no settings'); return true; }, readWork: () => ({ runs: [{ waiting: false }] }) });
  ka.update();
  assert.equal(ka.state().holding, true);
  fail = true;
  const s = ka.update();
  assert.equal(s.enabled, false);
  assert.equal(s.holding, false);
});
