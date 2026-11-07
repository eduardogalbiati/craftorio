// #809 the PR monitor step (fragments/pr-pipeline.yaml `pr_monitor`, packages/engine/engine/run/transitions.js):
// a waiting step with no agent that ends the run on the PR's merge (success) or close (failed). Acceptance tests,
// written before the code, on the engine's methods with a fake run (as wait-parent-738.test.js and
// stack-parent-807.test.js): the PR is read through the fake `probe`, the run's machine-adapter seam.
//
// The interface these tests assume (the developer implements it as named):
// - methods.pollPrMonitor(step, st) → Promise<string | null>: ONE read of the PR (this.probe({ target: <PR URL>, ... }),
//   whose answer has run-pr.js fetchPrMonitor's shape). null = the PR is still open, keep waiting (the step's runner
//   waits prMonitorIntervalMs and reads again); merged → the step ends (its transition: 'end', success);
//   closed without merge → 'end' with this.endStatus { status: 'failed', message naming "closed without merging" }.
//   No agent turn (sendToAgent), no gate (requestApproval), no action (runAction) ever.
// - this.prMonitor: the step's id while the run waits in the monitor (the service leaves such a run out of the
//   concurrent run limit and shows its roadmap item waiting for merge), null once it ended.
// - Each read emits `pr.monitor` { step_id, url, state, checked_at (ISO, of the last read that succeeded), ci, review,
//   conflicts, comments, result, fork (true in Fork + PR: the PR is upstream's, it waits for the maintainers),
//   error (only after a read that failed: the last state and checked_at are kept) }.
// - st holds nothing the monitor needs across a restart: a fresh st ({}) on a resumed run picks up a merge that
//   happened meanwhile.
// - transitions.js exports prMonitorIntervalMs(sinceChangeMs): about a minute, slower once nothing changed for a day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const transitions = () => require('../../engine/run/transitions');
const FRAGMENT = path.join(__dirname, '..', '..', '..', '..', 'fragments', 'pr-pipeline.yaml');
const monitorStep = () => ({ ...(yaml.load(fs.readFileSync(FRAGMENT, 'utf8')).steps?.pr_monitor || {}), id: 'pr_monitor' });

const GH = { url: 'https://github.com/acme/widgets/pull/9', number: 9 };
const GL = { url: 'https://gitlab.com/acme/widgets/-/merge_requests/9', number: 9 };
const PLATFORMS = [['GitHub', GH], ['GitLab', GL]];
const OPEN = { state: 'open', detail: 'open', ci: { status: 'running', failed: [] }, review: { status: 'required', by: [] }, conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: false, blockers: ['CI running'] } };

// reads: the probe's answers in order (an Error is a read that failed)
function fakeRun({ pr = GH, reads = [], inputs = {} } = {}) {
  const step = monitorStep();
  const seen = { probes: [], events: [], agents: 0, gates: 0, actions: [] };
  const output = { pr_url: pr.url, pr_number: pr.number, conflict: false, ci_status: 'success' };
  const run = {
    ...transitions().methods,
    runId: 'run-809',
    wf: { steps: [step] },
    ctx: { inputs: { mode: 'remote', base_branch: 'main', ...inputs }, steps: { ci: { output }, pr_open: { output } }, vars: {}, worktree_dir: '' },
    inputs: {},
    probeStats: {},
    abort: new AbortController(),
    machine: { transitionFault: () => {} },
    emitEvent: (type, data) => seen.events.push({ type, ...data }),
    probe: async (args) => {
      seen.probes.push(args.target);
      const r = reads.length ? reads.shift() : OPEN;
      if (r instanceof Error) throw r;
      return r;
    },
    sendToAgent: async () => { seen.agents++; return { text: '' }; },
    requestApproval: async () => { seen.gates++; return { answer: 'stop' }; },
    runAction: async (cmd) => { seen.actions.push(cmd); },
    loopWait: async (s) => s.id,
    notePreexistingFailures: () => {},
    recordEvidence: () => {},
    saveScenarios: () => {},
    logDecisions: () => {},
  };
  return { run, step, seen };
}
const poll = (run, step, st) => run.pollPrMonitor(step, st);
const monitorEvents = (seen) => seen.events.filter((e) => e.type === 'pr.monitor');
const ended = (run, next) => [next, run.endStatus?.status ?? 'success'];

for (const [name, pr] of PLATFORMS) {
  test(`#809 ${name}: a merged PR ends the run as success, without an agent turn, and the monitor is left`, async () => {
    const { run, step, seen } = fakeRun({ pr, reads: [{ state: 'merged', detail: 'merged' }] });
    const next = await poll(run, step, {});
    assert.deepEqual([...ended(run, next), seen.probes[0], seen.agents, seen.gates, run.prMonitor ?? null], ['end', 'success', pr.url, 0, 0, null]);
  });

  test(`#809 ${name}: a PR closed without merge ends the run as failed, saying it was closed without merging`, async () => {
    const { run, step, seen } = fakeRun({ pr, reads: [{ state: 'closed', detail: 'closed' }] });
    const next = await poll(run, step, {});
    const said = `${run.endStatus?.message || ''} ${JSON.stringify(seen.events)}`;
    assert.deepEqual([...ended(run, next), /closed without merg/i.test(said), seen.agents, seen.gates], ['end', 'failed', true, 0, 0]);
  });
}

test('#809 an open PR (ready, failing, conflicting, draft) keeps the run waiting in the monitor, with no agent, gate or action', async () => {
  const states = ['ready', 'failing', 'conflict', 'draft', 'open', 'pending'].map((state) => ({ ...OPEN, state, detail: state }));
  const { run, step, seen } = fakeRun({ reads: states.slice() });
  const st = {};
  const nexts = [];
  for (let i = 0; i < states.length; i++) nexts.push(await poll(run, step, st));
  assert.deepEqual([nexts.every((n) => n === null), run.endStatus ?? null, seen.agents, seen.gates, seen.actions.length, run.prMonitor], [true, null, 0, 0, 0, 'pr_monitor']);
});

test('#809 each read puts the PR card in the run: its URL, state, read time and the five lines', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN] });
  await poll(run, step, {});
  const ev = monitorEvents(seen).at(-1) || {};
  assert.deepEqual(
    [ev.step_id, ev.url, ev.state, typeof ev.checked_at, ev.ci?.status, ev.review?.status, ev.conflicts?.status, ev.comments?.unanswered, ev.result?.ready],
    ['pr_monitor', GH.url, 'open', 'string', 'running', 'required', 'none', 0, false],
  );
});

test('#809 a failed read keeps waiting and keeps the last state, with the time it was read and the error', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN, new Error('gh: HTTP 502')] });
  const st = {};
  await poll(run, step, st);
  const first = monitorEvents(seen).at(-1) || {};
  const next = await poll(run, step, st);
  const last = monitorEvents(seen).at(-1) || {};
  assert.deepEqual(
    [next, run.endStatus ?? null, last.state, last.checked_at, /502/.test(String(last.error || '')), run.prMonitor],
    [null, null, 'open', first.checked_at, true, 'pr_monitor'],
  );
  assert.equal(typeof first.checked_at, 'string');
});

test('#809 failed reads never end the run, however many in a row, and call no agent', async () => {
  const { run, step, seen } = fakeRun({ reads: Array.from({ length: 8 }, () => new Error('glab: connection refused')) });
  const st = {};
  const nexts = [];
  for (let i = 0; i < 8; i++) nexts.push(await poll(run, step, st));
  assert.deepEqual([nexts.every((n) => n === null), run.endStatus ?? null, seen.agents, seen.gates], [true, null, 0, 0]);
});

test('#809 GitHub and GitLab: after a restart (a fresh run, no state kept) the monitor picks up a merge that happened meanwhile', async () => {
  const results = [];
  for (const [, pr] of PLATFORMS) {
    const before = fakeRun({ pr, reads: [OPEN] });
    await poll(before.run, before.step, {});
    const after = fakeRun({ pr, reads: [{ state: 'merged', detail: 'merged' }] });
    results.push(ended(after.run, await poll(after.run, after.step, {})));
  }
  assert.deepEqual(results, [['end', 'success'], ['end', 'success']]);
});

test('#809 Fork + PR: the monitor reads the upstream PR and its card says it waits for the maintainers', async () => {
  const upstream = { url: 'https://github.com/upstream-org/widgets/pull/31', number: 31 };
  const { run, step, seen } = fakeRun({ pr: upstream, reads: [OPEN], inputs: { mode: 'fork' } });
  const next = await poll(run, step, {});
  const ev = monitorEvents(seen).at(-1) || {};
  assert.deepEqual([next, seen.probes[0], ev.url, ev.fork], [null, upstream.url, upstream.url, true]);
});

test('#809 stopping the monitor leaves the PR as it is: no action, merge or close is issued', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN] });
  run.abort.abort();
  const r = await poll(run, step, {}).then((n) => `next:${n}`, (e) => `error:${e.message}`);
  const touched = seen.actions.filter((c) => /\b(close|merge)\b/.test(c)).length;
  assert.deepEqual([r === 'next:end', seen.actions.length, touched, run.endStatus?.status === 'success'], [false, 0, 0, false], r);
  assert.equal(typeof run.pollPrMonitor, 'function');
});

test('#809 Stop while the monitor waits between reads ends the wait as cancelled and leaves the PR as it is', async () => {
  const { run, step, seen } = fakeRun({ reads: [OPEN, OPEN] });
  Object.assign(run, { machine: { ...run.machine, simulated: false }, orchestrator: {}, setStatus: () => {}, sayPrMonitorWorktreeKept: run.sayPrMonitorWorktreeKept || (() => {}) });
  // Stop (WorkflowRun.stop aborts the run) once the first read is done and the monitor sleeps
  const probe = run.probe;
  run.probe = async (args) => { const r = await probe(args); setTimeout(() => run.abort.abort(), 20); return r; };
  const r = await run.runPrMonitor(step, {}, Date.now()).then((n) => `next:${n}`, (e) => `error:${e.message}`);
  const touched = seen.actions.filter((c) => /\b(close|merge)\b/.test(String(c))).length;
  assert.deepEqual([r, seen.probes.length, seen.actions.length, touched, seen.agents, seen.gates], ['error:Cancelled', 1, 0, 0, 0, 0]);
});

test('#809 polling: about once a minute while the PR changes, slower once nothing changed for a day', () => {
  const { prMonitorIntervalMs } = transitions();
  const at = (h) => prMonitorIntervalMs(h * 3600e3);
  const minute = (ms) => ms >= 30e3 && ms <= 90e3;
  assert.deepEqual([minute(at(0)), minute(at(23)), at(25) > 60e3, at(25) > at(0)], [true, true, true, true], `${at(0)} ${at(23)} ${at(25)}`);
});
