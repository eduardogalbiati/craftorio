// #810 a merge or close from the app on a run waiting in the PR monitor (run/transitions.js prActedFromApp,
// runPrMonitor, pollPrMonitor): the methods with a fake run, as pr-monitor-809.test.js (the PR is read through
// the fake `probe`). Covers what the review named: one asked during a read (no wait to abort yet) still skips
// the next wait, and the close's message from the platform stays on the next reads until a close or a merge lands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const transitions = () => require('../../engine/run/transitions');
const FRAGMENT = path.join(__dirname, '..', '..', '..', '..', 'fragments', 'pr-pipeline.yaml');
const monitorStep = () => ({ ...(yaml.load(fs.readFileSync(FRAGMENT, 'utf8')).steps?.pr_monitor || {}), id: 'pr_monitor' });

const PR = { url: 'https://github.com/acme/widgets/pull/9', number: 9 };
const OPEN = { state: 'open', detail: 'open', ci: { status: 'running', failed: [] }, review: { status: 'required', by: [] }, conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: false, blockers: ['CI running'] } };
const CI_OK = { ...OPEN, ci: { status: 'success', failed: [] }, result: { ready: false, blockers: ['approvals missing'] } };
const CI_FAILED = { ...OPEN, ci: { status: 'failed', failed: ['unit'] }, result: { ready: false, blockers: ['CI failed'] } };

// reads: the probe's answers in order; onRead(run, n): called during the n-th read (1-based)
function fakeRun({ reads = [], onRead = () => {} } = {}) {
  const step = monitorStep();
  const seen = { probes: 0, events: [] };
  const output = { pr_url: PR.url, pr_number: PR.number, conflict: false, ci_status: 'success' };
  const run = {
    ...transitions().methods,
    runId: 'run-810',
    wf: { steps: [step] },
    ctx: { inputs: { mode: 'remote', base_branch: 'main' }, steps: { ci: { output }, pr_open: { output } }, vars: {}, worktree_dir: '' },
    inputs: {},
    probeStats: {},
    abort: new AbortController(),
    machine: { transitionFault: () => {}, simulated: false },
    orchestrator: {},
    setStatus: () => {},
    emitEvent: (type, data) => seen.events.push({ type, ...data }),
    probe: async () => {
      seen.probes++;
      onRead(run, seen.probes);
      return reads.length ? reads.shift() : OPEN;
    },
    sendToAgent: async () => ({ text: '' }),
    requestApproval: async () => ({ answer: 'stop' }),
    runAction: async () => {},
    loopWait: async (s) => s.id,
    notePreexistingFailures: () => {},
    recordEvidence: () => {},
    saveScenarios: () => {},
    logDecisions: () => {},
  };
  return { run, step, seen };
}
const monitorEvents = (seen) => seen.events.filter((e) => e.type === 'pr.monitor');

test('#810 a merge from the app asked during a read (no wait yet) skips the next wait: the monitor reads again at once and ends', async () => {
  const { run, step, seen } = fakeRun({
    reads: [OPEN, { state: 'merged', detail: 'merged' }],
    onRead: (r, n) => { if (n === 1) r.prActedFromApp({ action: 'merge', merged: true, commit: 'abc1234', by: 'owner' }); },
  });
  // a real run waits about a minute between reads: without the skip, the guard stops it after 3s
  const guard = setTimeout(() => run.abort.abort(), 3000);
  const t0 = Date.now();
  const r = await run.runPrMonitor(step, {}, t0).then((n) => `next:${n}`, (e) => `error:${e.message}`);
  clearTimeout(guard);
  assert.deepEqual([r, seen.probes, Date.now() - t0 < 2500, !!run.prMonitorWakeAsked], ['next:end', 2, true, false]);
});

test('#810 a close from the app asked during a read that failed on the platform still skips the next wait', async () => {
  const { run, step, seen } = fakeRun({
    reads: [OPEN, CI_OK, { state: 'merged', detail: 'merged' }],
    onRead: (r, n) => { if (n === 1) r.prActedFromApp({ action: 'close', closed: false, error: 'boom' }); },
  });
  const probe = run.probe;
  // stop after the second read: it came right away (the wait skipped), the third would come only after a full wait
  run.probe = async (a) => { const x = await probe(a); if (seen.probes === 2) setTimeout(() => run.abort.abort(), 20); return x; };
  const guard = setTimeout(() => run.abort.abort(), 3000);
  const t0 = Date.now();
  const r = await run.runPrMonitor(step, {}, t0).then((n) => `next:${n}`, (e) => `error:${e.message}`);
  clearTimeout(guard);
  assert.deepEqual([r, seen.probes, Date.now() - t0 < 2500], ['error:Cancelled', 2, true]);
});

test('#810 a close that failed on the platform: its message is on the card at once and on the next read', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN, CI_OK, CI_FAILED] });
  await run.pollPrMonitor(step, {});
  run.prActedFromApp({ action: 'close', closed: false, error: 'GraphQL: Resource not accessible by integration' });
  const atOnce = monitorEvents(seen).at(-1)?.close_error ?? null;
  await run.pollPrMonitor(step, {});
  const nextRead = monitorEvents(seen).at(-1);
  assert.deepEqual([atOnce, nextRead.close_error ?? null, nextRead.ci?.status], ['GraphQL: Resource not accessible by integration', 'GraphQL: Resource not accessible by integration', 'success']);
});

test('#810 a close that failed: its message goes away once a close from the app lands', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN, CI_OK, { state: 'closed', detail: 'closed' }] });
  await run.pollPrMonitor(step, {});
  run.prActedFromApp({ action: 'close', closed: false, error: 'boom' });
  await run.pollPrMonitor(step, {});
  run.prActedFromApp({ action: 'close', closed: true, by: 'owner' });
  const next = await run.pollPrMonitor(step, {});
  const last = monitorEvents(seen).at(-1);
  assert.deepEqual([next, run.endStatus?.status, last.state, 'close_error' in last], ['end', 'failed', 'closed', false]);
});

test('#810 a close that failed: its message goes away once a merge from the app lands', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN, CI_OK, { state: 'merged', detail: 'merged' }] });
  await run.pollPrMonitor(step, {});
  run.prActedFromApp({ action: 'close', closed: false, error: 'boom' });
  await run.pollPrMonitor(step, {});
  run.prActedFromApp({ action: 'merge', merged: true, commit: 'abc1234' });
  const next = await run.pollPrMonitor(step, {});
  const last = monitorEvents(seen).at(-1);
  assert.deepEqual([next, run.endStatus?.status ?? 'success', last.state, 'close_error' in last], ['end', 'success', 'merged', false]);
});
