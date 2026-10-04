// The engine's side of the memory guard (#276): src/engine/workflow.js with an injected fake guard,
// on mock runs of test/fixtures/memory-guard-suite.yaml (work -> suite -> end; a failing suite goes
// back to work). Written before the code exists: each new-behaviour test fails now.
//
// The seam these tests pin down (the developer implements against it):
//   new WorkflowRun({ ..., memoryGuard }) — `memoryGuard`: an object with the API of
//   src/engine/memory-guard.js (watch, waitForMemory, incidentsBetween, close; see
//   test/memory-guard-276.test.js). Default: none for a mock run (a simulation starts no sampler:
//   run.memoryGuard is null), the app's real guard for a real run (run.memoryGuard has the API;
//   constructing the run starts nothing). When one is given, the engine uses it in a mock run too:
//   - it calls watch({ rootPid, protectedPids, step, session, onKill, onReport, onLog }) for every
//     agent turn and every suite/e2e execution (rootPid: the turn's process, null in a mock turn),
//     and stop() on the handle when that turn/execution ends; onKill may be called synchronously;
//   - each onKill(event) becomes a run event `process.killed` { pid, command_line, bytes,
//     limit_bytes, step_id, session }; the second stop of the same command line in the same step
//     carries `notify: true` (and only that one), and runNotice (src/notifications.js) turns a
//     `process.killed` event with notify: true into one run notice (null without it);
//   - the agent's next prompt says: The orchestrator stopped `<command line>` at <n> GB for passing
//     the memory limit (GB = bytes / 1024^3, one decimal);
//   - a suite/e2e execution whose child was stopped says so in its output `message` (the command line);
//   - before every suite/e2e execution (reruns included) it awaits
//     waitForMemory({ maxWaitMs: 600000, onWait }); onWait(info) becomes a `log` event naming the
//     free memory and the floor in GB;
//   - after a failing execution it calls incidentsBetween(start, end) with that execution's time
//     window; an incident there reruns the suite in the same visit (after waitForMemory), at most
//     twice: output `environment_reruns` (count), log `<logName>-env.log` (suite-1-env.log for the
//     first rerun of visit 1); only the last result is routed. mockSequences.suite.<step> is then
//     indexed by execution (a visit plus its environment reruns), not by visit.
//   A failure with no incident in its window routes as today (environment_reruns absent or 0).
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const { runNotice } = require('../src/notifications');

const GB = 1024 * 1024 * 1024;
const FIXTURE = path.join(__dirname, 'fixtures', 'memory-guard-suite.yaml');

// A fake guard: records what the engine asks; `kills[step]` = events fired (synchronously) in the
// first watch of that step; `incidents(call)` = what the n-th incidentsBetween call returns;
// `low` = waitForMemory reports a low-memory wait through onWait before resolving.
function fakeGuard({ kills = {}, incidents = () => [], low = false } = {}) {
  const g = {
    watches: [], stopped: 0, waits: [], incidentCalls: [], order: [],
    watch(opts) {
      g.watches.push(opts);
      g.order.push(`watch:${opts.step}`);
      const first = g.watches.filter((w) => w.step === opts.step).length === 1;
      if (first) for (const ev of kills[opts.step] || []) opts.onKill({ step: opts.step, session: opts.session ?? null, ...ev });
      return { stop: () => { g.stopped++; } };
    },
    async waitForMemory(opts) {
      g.waits.push(opts);
      g.order.push('wait');
      if (low) opts.onWait?.({ freeBytes: 1.5 * GB, totalBytes: 32 * GB, floorBytes: 3.2 * GB });
      return { recovered: true, waitedMs: 0 };
    },
    incidentsBetween(start, end) {
      g.incidentCalls.push([start, end]);
      return incidents(g.incidentCalls.length, start, end);
    },
    close() {},
  };
  return g;
}

async function runFixture(t, { memoryGuard, mockSequences } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [], mockSequences, memoryGuard });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  return {
    run,
    events,
    finished: events.find((e) => e.type === 'workflow.finished'),
    transitions: events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`),
    promptsOf: (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt),
    suiteOutputs: () => events.filter((e) => e.type === 'step.finished' && e.step_id === 'suite').map((e) => e.output),
  };
}

// ---------------------------------------------------------------------------
// Which runs get a guard
// ---------------------------------------------------------------------------

test('memory guard (#276): a mock run has no guard (no sampler); a real run gets the app\'s guard without starting anything', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const mock = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [] });
  assert.equal(mock.memoryGuard ?? null, null, 'a simulation starts no sampler');
  const real = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: false, runsDir, skillsDirs: [] });
  assert.ok(real.memoryGuard, 'a real run is guarded');
  for (const fn of ['watch', 'waitForMemory', 'incidentsBetween']) assert.equal(typeof real.memoryGuard[fn], 'function', fn);
});

test('memory guard (#276): an injected guard watches every agent turn and suite execution, and each watch is stopped', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard();
  const { finished } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(guard.watches.map((w) => w.step), ['work', 'suite']);
  assert.equal(guard.stopped, guard.watches.length, 'every watch is stopped when its turn ends');
});

// ---------------------------------------------------------------------------
// A stop is recorded
// ---------------------------------------------------------------------------

const HOG = { pid: 4242, commandLine: 'node scripts/build-index.js --all', bytes: 3 * GB, limitBytes: 2 * GB };

test('memory guard (#276): a stop becomes a process.killed run event, and the agent\'s next prompt says what was stopped', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ kills: { work: [HOG] } });
  const { events, promptsOf } = await runFixture(t, { memoryGuard: guard, mockSequences: { status: ['again', 'done'], suite: { suite: ['pass'] } } });
  const killed = events.filter((e) => e.type === 'process.killed');
  assert.equal(killed.length, 1);
  assert.equal(killed[0].pid, 4242);
  assert.equal(killed[0].command_line, HOG.commandLine);
  assert.equal(killed[0].bytes, 3 * GB);
  assert.equal(killed[0].limit_bytes, 2 * GB);
  assert.equal(killed[0].step_id, 'work');
  assert.ok('session' in killed[0], 'the event names the session');
  const prompts = promptsOf('work');
  assert.equal(prompts.length, 2, 'two turns of work');
  assert.doesNotMatch(prompts[0], /orchestrator stopped/);
  assert.match(prompts[1], /The orchestrator stopped `node scripts\/build-index\.js --all` at 3(\.0)? GB for passing the memory limit/);
});

test('memory guard (#276): the same command stopped again in the same step raises one notification', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ kills: { work: [HOG, { ...HOG, pid: 4243 }, { ...HOG, pid: 4244 }] } });
  const { events } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['pass'] } } });
  const killed = events.filter((e) => e.type === 'process.killed');
  assert.equal(killed.length, 3, 'every stop is an event');
  assert.deepEqual(killed.map((e) => !!e.notify), [false, true, false], 'only the repeat raises a notification, once');
  const notices = killed.map((e) => runNotice(e, { workflow: 'fixture-memory-guard-suite', project: 'demo', mock: false })).filter(Boolean);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'run');
  assert.match(`${notices[0].title}\n${notices[0].body}`, /memory/i);
  assert.match(notices[0].body, /node scripts\/build-index\.js --all/);
});

test('memory guard (#276): a suite whose child was stopped says so in its message', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ kills: { suite: [{ pid: 777, commandLine: 'node --test test/huge.test.js', bytes: 5 * GB, limitBytes: 4 * GB }] } });
  const { suiteOutputs, events } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['pass'] } } });
  const [out] = suiteOutputs();
  assert.ok(out, 'the suite ran');
  assert.match(out.message, /stopped/i);
  assert.match(out.message, /node --test test\/huge\.test\.js/);
  assert.ok(events.some((e) => e.type === 'process.killed' && e.step_id === 'suite'));
});

// ---------------------------------------------------------------------------
// The low-memory hold before a suite
// ---------------------------------------------------------------------------

test('memory guard (#276): a suite waits for memory before it starts (at most 10 min) and logs the numbers', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ low: true });
  const { events, finished } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(guard.waits.length >= 1, 'waitForMemory before the suite');
  assert.equal(guard.waits[0].maxWaitMs, 600000);
  assert.ok(guard.order.indexOf('wait') < guard.order.indexOf('watch:suite'), `waits before the suite starts: ${guard.order.join(' ')}`);
  const i = events.findIndex((e) => e.type === 'log' && /memory/i.test(e.message || '') && /1\.5 GB/.test(e.message) && /3\.2 GB/.test(e.message));
  assert.ok(i >= 0, 'a log names the free memory and the floor');
  const suiteDone = events.findIndex((e) => e.type === 'step.finished' && e.step_id === 'suite');
  assert.ok(i < suiteDone, 'logged before the suite ran');
});

// ---------------------------------------------------------------------------
// A failure while the guard saw an incident: rerun in the same visit
// ---------------------------------------------------------------------------

test('memory guard (#276): a suite failing while the guard recorded a stop reruns in the same visit; the green rerun is routed', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ incidents: (n, start) => (n === 1 ? [{ kind: 'stop', at: start, pid: 1, commandLine: 'node x', bytes: 3 * GB, limitBytes: 2 * GB, step: 'suite' }] : []) });
  const { finished, transitions, suiteOutputs } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['fail', 'pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['work>suite', 'suite>end'], 'the failure was not routed back to work');
  const outs = suiteOutputs();
  assert.equal(outs.length, 1, 'one step visit');
  assert.equal(outs[0].status, 'pass');
  assert.equal(outs[0].environment_reruns, 1);
  assert.match(String(outs[0].log), /suite-1-env\.log$/);
  assert.equal(guard.waits.length, 2, 'waits for memory before the first run and before the rerun');
});

test('memory guard (#276): environment reruns stop after two; the last failure is routed once', { timeout: 60000 }, async (t) => {
  const guard = fakeGuard({ incidents: (n, start) => [{ kind: 'low_memory', start, end: start + 1 }] });
  const { transitions, suiteOutputs } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['fail'] } } });
  const first = suiteOutputs()[0];
  assert.equal(first.status, 'fail');
  assert.equal(first.environment_reruns, 2, 'at most twice');
  assert.equal(transitions[1], 'suite>work', 'the last result is routed like any failure');
});

test('memory guard (#276): a failure with no incident in its window routes as today; the guard is asked about that window', { timeout: 60000 }, async (t) => {
  const t0 = Date.now();
  const guard = fakeGuard();
  const { finished, transitions, suiteOutputs } = await runFixture(t, { memoryGuard: guard, mockSequences: { suite: { suite: ['fail', 'pass'] } } });
  const t1 = Date.now();
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, ['work>suite', 'suite>work', 'work>suite', 'suite>end']);
  assert.ok(!suiteOutputs()[0].environment_reruns, 'no rerun');
  assert.ok(guard.incidentCalls.length >= 1, 'the failing execution was checked against the guard');
  const [start, end] = guard.incidentCalls[0];
  assert.ok(t0 <= start && start <= end && end <= t1, `the window [${start}, ${end}] is the execution's, inside the run`);
});
