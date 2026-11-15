// #568 review round 2: the trigger watcher's start failures (tried 3 times, then dropped), a start that
// must wait (null: never marked seen), the per-event claim between two apps on the same workspace
// (a stale claim is taken over) and the state write that keeps what another app wrote meanwhile.
// Seam: createTriggerWatcher / readTriggerState of packages/engine/domains/triggers/triggers.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/triggers/triggers');

const RULES = [{ on: 'issue_labeled', label: 'ready', workflow: 'feature', inputs: { issues: ['{{ event.issue.number }}'] } }];
const LABELED = { kind: 'issue_labeled', id: 'gh:labeled:9001', url: 'https://github.com/acme/app/issues/42', label: 'ready', issue: { number: 42 } };
const OTHER = { kind: 'issue_labeled', id: 'gh:labeled:9002', url: 'https://github.com/acme/app/issues/43', label: 'ready', issue: { number: 43 } };

function stateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triggers-claims-568-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function quiet(t) {
  t.mock.method(console, 'error', () => {});
}

function watcher({ dir, events = [LABELED], startRun }) {
  return load().createTriggerWatcher({
    project: 'acme-app', rules: RULES, stateDir: dir, enabled: true, intervalMs: 120000,
    now: () => 1763200000000, readEvents: async () => events, startRun,
  });
}

const stateOf = (dir) => load().readTriggerState(dir, 'acme-app');

test('#568 a start that throws is reported in the poll result and on the state, and tried again', async (t) => {
  quiet(t);
  const dir = stateDir(t);
  let tries = 0;
  const w = watcher({ dir, startRun: async () => { tries += 1; throw new Error('workflow file missing'); } });
  const res = await w.pollOnce();
  assert.deepEqual(res.errors, [{ eventId: 'gh:labeled:9001', error: 'workflow file missing' }]);
  assert.deepEqual(res.started, []);
  const s = stateOf(dir);
  assert.equal(s.lastError.message, 'workflow file missing');
  assert.equal(s.lastError.eventId, 'gh:labeled:9001');
  assert.equal(s.lastError.workflow, 'feature');
  assert.equal(s.lastEvent.error, 'workflow file missing');
  assert.equal(s.seen.includes('gh:labeled:9001'), false);
  await w.pollOnce();
  assert.equal(tries, 2);
});

test('#568 a start that keeps throwing is tried 3 times, then the event is dropped as seen', async (t) => {
  quiet(t);
  const dir = stateDir(t);
  let tries = 0;
  const w = watcher({ dir, startRun: async () => { tries += 1; throw new Error('boom'); } });
  for (let i = 0; i < 5; i++) await w.pollOnce();
  assert.equal(tries, 3);
  assert.equal(stateOf(dir).seen.includes('gh:labeled:9001'), true);
});

test('#568 a failure is logged with the event and the attempt', async (t) => {
  const lines = [];
  t.mock.method(console, 'error', (...a) => { lines.push(a.join(' ')); });
  const dir = stateDir(t);
  const w = watcher({ dir, startRun: async () => { throw new Error('boom'); } });
  await w.pollOnce();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /gh:labeled:9001/);
  assert.match(lines[0], /boom/);
});

test('#568 a start that must wait (null) is never marked seen nor reported as an error', async (t) => {
  const dir = stateDir(t);
  let tries = 0;
  const w = watcher({ dir, startRun: async () => { tries += 1; return null; } });
  for (let i = 0; i < 4; i++) {
    const res = await w.pollOnce();
    assert.deepEqual([res.started.length, res.errors.length], [0, 0]);
  }
  assert.equal(tries, 4);
  const s = stateOf(dir);
  assert.equal(s.seen.includes('gh:labeled:9001'), false);
  assert.equal(s.lastError, null);
});

test('#568 two apps polling the same event at once start one run', async (t) => {
  const dir = stateDir(t);
  const starts = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const a = watcher({ dir, startRun: async (args) => { starts.push(['a', args.trigger.id]); await slow; return { runId: 'run-a' }; } });
  const b = watcher({ dir, startRun: async (args) => { starts.push(['b', args.trigger.id]); return { runId: 'run-b' }; } });
  const first = a.pollOnce();
  // a holds the claim while its start is still running
  await new Promise((r) => setImmediate(r));
  const second = await b.pollOnce();
  assert.equal(second.started.length, 0);
  release();
  await first;
  const third = await b.pollOnce();
  assert.equal(third.started.length, 0);
  assert.deepEqual(starts, [['a', 'gh:labeled:9001']]);
  assert.deepEqual(stateOf(dir).runs.map((r) => r.runId), ['run-a']);
});

test('#568 a claim left by an app that died more than 10 minutes ago is taken over', async (t) => {
  const dir = stateDir(t);
  const claims = path.join(dir, 'acme-app.claims');
  fs.mkdirSync(claims, { recursive: true });
  const file = path.join(claims, 'gh_labeled_9001');
  fs.writeFileSync(file, '');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(file, old, old);
  const starts = [];
  const w = watcher({ dir, startRun: async (args) => { starts.push(args.trigger.id); return { runId: 'run-1' }; } });
  const res = await w.pollOnce();
  assert.deepEqual(starts, ['gh:labeled:9001']);
  assert.equal(res.started.length, 1);
});

test('#568 a fresh claim of another app holds the event: no start, tried on a later poll', async (t) => {
  const dir = stateDir(t);
  const claims = path.join(dir, 'acme-app.claims');
  fs.mkdirSync(claims, { recursive: true });
  const file = path.join(claims, 'gh_labeled_9001');
  fs.writeFileSync(file, '');
  const starts = [];
  const w = watcher({ dir, startRun: async (args) => { starts.push(args.trigger.id); return { runId: 'run-1' }; } });
  await w.pollOnce();
  assert.deepEqual(starts, []);
  assert.equal(stateOf(dir).seen.includes('gh:labeled:9001'), false);
  fs.unlinkSync(file);
  await w.pollOnce();
  assert.deepEqual(starts, ['gh:labeled:9001']);
});

test('#568 the state write keeps the seen ids and runs another app wrote meanwhile', async (t) => {
  const dir = stateDir(t);
  const w = watcher({
    dir, events: [LABELED],
    startRun: async () => {
      // another app on the same workspace records its own event while this start runs
      fs.writeFileSync(path.join(dir, 'acme-app.json'), JSON.stringify({
        seen: ['gh:labeled:9002'],
        runs: [{ eventId: 'gh:labeled:9002', runId: 'run-other', workflow: 'feature', url: OTHER.url, at: '2025-11-15T09:00:00.000Z' }],
      }));
      return { runId: 'run-mine' };
    },
  });
  await w.pollOnce();
  const s = stateOf(dir);
  assert.deepEqual(s.seen.slice().sort(), ['gh:labeled:9001', 'gh:labeled:9002']);
  assert.deepEqual(s.runs.map((r) => r.runId), ['run-other', 'run-mine']);
});

test('#568 an event another app started since this poll read the state is not started again', async (t) => {
  const dir = stateDir(t);
  const starts = [];
  const w = watcher({
    dir, events: [OTHER, LABELED],
    startRun: async (args) => {
      starts.push(args.trigger.id);
      // while the first event starts, another app starts the second one
      fs.writeFileSync(path.join(dir, 'acme-app.json'), JSON.stringify({ seen: ['gh:labeled:9001'], runs: [] }));
      return { runId: `run-${starts.length}` };
    },
  });
  await w.pollOnce();
  assert.deepEqual(starts, ['gh:labeled:9002']);
});
