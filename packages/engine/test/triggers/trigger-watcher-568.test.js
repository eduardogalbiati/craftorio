// #568: the trigger watcher (one per project with triggers). Acceptance tests, written before the code.
//
// Seam (the interface these tests assume), packages/engine/domains/triggers/triggers.js (CommonJS):
//   DEFAULT_INTERVAL_MS === 120000 (2 min)
//   createTriggerWatcher({ project, rules, readEvents, startRun, comment?, stateDir, intervalMs?, enabled, now? })
//       -> { pollOnce(): Promise<PollResult>, nextDelayMs(): number }
//     project:    the project id (the state file's name)
//     rules:      the validated triggers (validateTriggers(...).triggers)
//     readEvents: async ({ since }) -> [event]   (the platform reader, platform-events.js; the boundary)
//                 event: { kind: 'issue_labeled'|'pr_comment'|'ci_failed', id: string, url: string, ... }
//                 A rate limit rejects with an Error whose `code === 'RATE_LIMITED'` (HTTP 403 / 429).
//     startRun:   async ({ project, workflow, inputs, trigger, mock }) -> { runId }   (the same channel the
//                 roadmap starts runs through; injected). inputs: renderTriggerInputs(rule.inputs, event)
//                 (more keys allowed); trigger: { kind, id, url } of the event (the run's meta.json `trigger`);
//                 mock: true when process.env.MULTIAGENT_SIMULATION_ONLY === '1' (never a real run).
//     comment:    optional async ({ event, runId }) -> void: the one report on the issue/PR, called once per
//                 started run, never again for the same event.
//     stateDir:   the folder of the dedup file `<stateDir>/<project>.json` (the service passes
//                 <workspace>/backlog/triggers), JSON { seen: [event id], ... }: written after each start, read
//                 at creation, so a restart or a second instance on the same folder never starts an event twice.
//     intervalMs: default DEFAULT_INTERVAL_MS; 0 = off.
//     enabled:    the owner's switch in Settings. Off by default (falsy = off).
//   pollOnce(): with enabled falsy, intervalMs 0 or no rules: never calls readEvents nor startRun and
//     resolves { polled: false, started: [], backoffMs: null }. Otherwise reads the events and starts one run
//     per (unseen event, first matching rule): resolves { polled: true, started: [{ eventId, runId, workflow }],
//     backoffMs: null }. Never rejects: on a rate limit it starts nothing and resolves
//     { polled: true, started: [], backoffMs: <ms, > intervalMs> }, growing on each consecutive rate limit.
//   nextDelayMs(): the delay before the next poll: intervalMs after a normal poll, the backoff after a rate limit.
//   The watcher never calls a model, never answers a gate, never merges: it only reads events and calls startRun.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/triggers/triggers');

const RULES = [
  { on: 'issue_labeled', label: 'ready', workflow: 'software-development', inputs: { issues: ['{{ event.issue.number }}'] } },
  { on: 'pr_comment', mention: '@orchestrator', workflow: 'fix', inputs: { pr: '{{ event.pr.number }}' } },
  { on: 'ci_failed', branch: 'main', workflow: 'fix', inputs: { task: 'CI failed on {{ event.branch }}' } },
];

const LABELED = { kind: 'issue_labeled', id: 'gh:labeled:9001', url: 'https://github.com/acme/app/issues/42', label: 'ready', issue: { number: 42 } };
const MENTION = { kind: 'pr_comment', id: 'gh:comment:5001', url: 'https://github.com/acme/app/pull/7#issuecomment-5001', body: 'hey @orchestrator, fix the lint', pr: { number: 7 } };
const NO_MENTION = { kind: 'pr_comment', id: 'gh:comment:5002', url: 'https://github.com/acme/app/pull/7#issuecomment-5002', body: 'looks good', pr: { number: 7 } };
const CI_MAIN = { kind: 'ci_failed', id: 'gh:run:3001', url: 'https://github.com/acme/app/actions/runs/3001', branch: 'main' };
const CI_OTHER = { kind: 'ci_failed', id: 'gh:run:3002', url: 'https://github.com/acme/app/actions/runs/3002', branch: 'feature/x' };

function stateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triggers-568-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function simulationOnly(t, value) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  if (value == null) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = value;
  t.after(() => {
    if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before;
  });
}

// a watcher over fixed events, recording its reads, starts and comments
function watcher(t, { events = [], dir, rules = RULES, readEvents, ...opts } = {}) {
  const calls = { reads: 0, starts: [], comments: [] };
  let n = 0;
  const w = load().createTriggerWatcher({
    project: 'acme-app',
    rules,
    stateDir: dir ?? stateDir(t),
    enabled: true,
    intervalMs: 120000,
    now: () => 1763200000000,
    readEvents: readEvents ?? (async () => { calls.reads += 1; return events; }),
    startRun: async (args) => { calls.starts.push(args); n += 1; return { runId: `run-${n}` }; },
    comment: async (args) => { calls.comments.push(args); },
    ...opts,
  });
  return { w, calls };
}

test('#568 the default poll interval is 2 minutes', () => {
  assert.equal(load().DEFAULT_INTERVAL_MS, 120000);
});

test('#568 an issue labelled with the rule\'s label starts one run of its workflow', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED] });
  const res = await w.pollOnce();
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0].workflow, 'software-development');
  assert.equal(calls.starts[0].project, 'acme-app');
  assert.deepEqual([res.started.length, res.started[0].eventId, res.started[0].runId], [1, 'gh:labeled:9001', 'run-1']);
});

test('#568 the started run gets the templated inputs', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED] });
  await w.pollOnce();
  assert.equal(calls.starts[0].inputs.issues[0], 42);
});

test('#568 the started run carries the event as trigger { kind, id, url }', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED] });
  await w.pollOnce();
  const { trigger } = calls.starts[0];
  assert.deepEqual([trigger.kind, trigger.id, trigger.url], ['issue_labeled', 'gh:labeled:9001', 'https://github.com/acme/app/issues/42']);
});

test('#568 a PR comment with the mention starts one run with the PR number', async (t) => {
  const { w, calls } = watcher(t, { events: [MENTION] });
  await w.pollOnce();
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0].workflow, 'fix');
  assert.equal(calls.starts[0].inputs.pr, 7);
  assert.equal(calls.starts[0].trigger.kind, 'pr_comment');
});

test('#568 a PR comment without the mention starts no run', async (t) => {
  const { w, calls } = watcher(t, { events: [NO_MENTION] });
  const res = await w.pollOnce();
  assert.deepEqual([calls.starts.length, res.started.length], [0, 0]);
});

test('#568 CI failed on main starts one run', async (t) => {
  const { w, calls } = watcher(t, { events: [CI_MAIN] });
  await w.pollOnce();
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0].inputs.task, 'CI failed on main');
  assert.equal(calls.starts[0].trigger.url, 'https://github.com/acme/app/actions/runs/3001');
});

test('#568 CI failed on another branch starts no run', async (t) => {
  const { w, calls } = watcher(t, { events: [CI_OTHER] });
  await w.pollOnce();
  assert.equal(calls.starts.length, 0);
});

test('#568 several matching events in one poll start one run each', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED, NO_MENTION, MENTION, CI_OTHER, CI_MAIN] });
  await w.pollOnce();
  assert.deepEqual(calls.starts.map((s) => s.trigger.id), ['gh:labeled:9001', 'gh:comment:5001', 'gh:run:3001']);
});

test('#568 the same event seen again on the next poll starts no second run', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED] });
  await w.pollOnce();
  const res = await w.pollOnce();
  assert.deepEqual([calls.starts.length, res.started.length], [1, 0]);
});

test('#568 after a restart (a new watcher on the same state folder) a seen event starts no run', async (t) => {
  const dir = stateDir(t);
  const first = watcher(t, { events: [LABELED], dir });
  await first.w.pollOnce();
  const second = watcher(t, { events: [LABELED], dir });
  await second.w.pollOnce();
  assert.deepEqual([first.calls.starts.length, second.calls.starts.length], [1, 0]);
});

test('#568 the seen event ids are kept in <stateDir>/<project>.json', async (t) => {
  const dir = stateDir(t);
  const { w } = watcher(t, { events: [LABELED], dir });
  await w.pollOnce();
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'acme-app.json'), 'utf8'));
  assert.equal(state.seen.includes('gh:labeled:9001'), true);
});

test('#568 a started run is reported once on its issue or PR, with the run id', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED] });
  await w.pollOnce();
  await w.pollOnce();
  assert.equal(calls.comments.length, 1);
  assert.deepEqual([calls.comments[0].runId, calls.comments[0].event.id], ['run-1', 'gh:labeled:9001']);
});

test('#568 an event no rule matches is not reported', async (t) => {
  const { w, calls } = watcher(t, { events: [NO_MENTION, CI_OTHER] });
  await w.pollOnce();
  assert.equal(calls.comments.length, 0);
});

test('#568 with the owner\'s switch off the watcher never polls nor starts', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED], enabled: false });
  const res = await w.pollOnce();
  assert.deepEqual([res.polled, calls.reads, calls.starts.length], [false, 0, 0]);
});

test('#568 with no switch given the watcher is off', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED], enabled: undefined });
  await w.pollOnce();
  assert.deepEqual([calls.reads, calls.starts.length], [0, 0]);
});

test('#568 with an interval of 0 the watcher never polls nor starts', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED], intervalMs: 0 });
  const res = await w.pollOnce();
  assert.deepEqual([res.polled, calls.reads, calls.starts.length], [false, 0, 0]);
});

test('#568 a project without triggers never polls', async (t) => {
  const { w, calls } = watcher(t, { events: [LABELED], rules: [] });
  const res = await w.pollOnce();
  assert.deepEqual([res.polled, calls.reads, calls.starts.length], [false, 0, 0]);
});

function rateLimited() {
  return Object.assign(new Error('gh api repos/acme/app/issues/events: HTTP 403: API rate limit exceeded'), { code: 'RATE_LIMITED' });
}

test('#568 a rate limit starts no run and does not reject', async (t) => {
  const { w, calls } = watcher(t, { readEvents: async () => { throw rateLimited(); } });
  const res = await w.pollOnce();
  assert.deepEqual([res.polled, res.started.length, calls.starts.length], [true, 0, 0]);
});

test('#568 a rate limit backs off: the next poll waits longer than the interval', async (t) => {
  const { w } = watcher(t, { readEvents: async () => { throw rateLimited(); } });
  const res = await w.pollOnce();
  assert.equal(res.backoffMs > 120000, true);
  assert.equal(w.nextDelayMs(), res.backoffMs);
});

test('#568 consecutive rate limits back off further', async (t) => {
  const { w } = watcher(t, { readEvents: async () => { throw rateLimited(); } });
  const first = await w.pollOnce();
  const second = await w.pollOnce();
  assert.equal(second.backoffMs > first.backoffMs, true);
});

test('#568 after a rate limit, a normal poll goes back to the interval', async (t) => {
  let limited = true;
  const { w } = watcher(t, { readEvents: async () => { if (limited) throw rateLimited(); return []; } });
  await w.pollOnce();
  limited = false;
  const res = await w.pollOnce();
  assert.deepEqual([res.backoffMs, w.nextDelayMs()], [null, 120000]);
});

test('#568 a normal poll waits the interval before the next one', async (t) => {
  const { w } = watcher(t, { events: [], intervalMs: 300000 });
  await w.pollOnce();
  assert.equal(w.nextDelayMs(), 300000);
});

test('#568 in simulation-only mode the run is started as a mock run', async (t) => {
  simulationOnly(t, '1');
  const { w, calls } = watcher(t, { events: [CI_MAIN] });
  await w.pollOnce();
  assert.equal(calls.starts[0].mock, true);
});
