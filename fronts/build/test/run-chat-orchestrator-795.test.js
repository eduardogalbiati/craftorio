// #795: the run's Chat shows the deterministic orchestrator working. A step with no agent (suite, e2e,
// red_check, rule_check, merge, ...) gets ONE orchestrator message in the chat, updated in place from
// its events: what it runs (command, round, timeout, log), its state while it runs or waits, and its
// outcome once it finishes. Its `log` events are folded into that message, not one line each.
//
// Contract assumed by these tests (shared with the E2E writer):
// - discriminator: the item's `kind` (the field RunChatModel already uses: 'turn', 'group', 'system'...)
//   is 'orchestrator'.
// - `step`: the step id ('suite', 'e2e', 'red_check'...).
// - `state`: 'running' | 'waiting' | 'passed' | 'failed'.
// - `round`: the step's round (the step.started visit / the output's round). ONE message per step
//   visit: an environment rerun after the memory guard (suite_env_rerun) stays on the same visit, so
//   it updates the same message (waiting, then running again), it does not add one.
// - `log`: the step's current log path, relative to the run ('logs/e2e-1.log').
// - `startedAt` / `finishedAt`: the step.started / step.finished timestamps (finishedAt unset while it runs).
// - `timeoutMin` (or the timeout in the message's text, e.g. "60 min").
// - `counts: { passed, failed }`, `failures` (the first failing tests), `waitingReason` (why it waits).
// Wording is free: texts are checked with .includes / regex over every string the message holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RunChatModel } = require('../views/runchat/run-chat-model.js');

const STATES = ['running', 'waiting', 'passed', 'failed'];
const T = (min, sec = 0) => new Date(Date.UTC(2026, 10, 13, 10, min, sec)).toISOString();
const ms = (v) => new Date(v).getTime();

function chatOf(events) {
  const model = new RunChatModel();
  for (const ev of events) model.apply(ev);
  return model;
}
const orch = (model, step) => model.items.filter((it) => it.kind === 'orchestrator' && (step === undefined || it.step === step));
// every string the message holds (its own fields, one level of nested objects / arrays), for loose text checks
function textOf(v, depth = 0) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v !== 'object' || depth > 3) return '';
  return Object.values(v).map((x) => textOf(x, depth + 1)).join(' \n ');
}
const systemTexts = (model) => model.items.filter((it) => it.kind === 'system').map((it) => it.text);
// the primitive view of an orchestrator message, to compare a live run with its replay
const project = (m) => ({
  step: m.step, state: m.state, round: m.round, log: m.log, startedAt: m.startedAt, finishedAt: m.finishedAt ?? null,
  passed: m.counts?.passed ?? null, failed: m.counts?.failed ?? null, failures: (m.failures || []).length,
  waiting: !!m.waitingReason, text: textOf({ ...m, id: undefined }),
});

// Recorded event sequences, as the engine emits them (machine-steps.js, suite-step.js, workflow.js).
const START = [{ seq: 1, type: 'workflow.started', run_id: 'r1', workflow: 'feature', inputs: { task: 'Fix #795' }, ts: T(0) }];

const PASSING_SUITE = [
  { seq: 10, type: 'step.transition', from: 'develop', to: 'suite', ts: T(1) },
  { seq: 11, type: 'step.started', step_id: 'suite', visit: 1, iteration: 1, step_type: 'suite', agent: null, ts: T(1) },
  { seq: 12, type: 'step.log', step_id: 'suite', path: 'logs/suite-1.log', command: 'npm test', ts: T(1, 1) },
  // suite-step.js logs the command line without a step id
  { seq: 13, type: 'log', level: 'info', message: 'suite: npm test (round 1, timeout 30 min, log logs/suite-1.log)', ts: T(1, 2) },
  { seq: 14, type: 'log', level: 'info', kind: 'suite', step_id: 'suite', status: 'pass', failures: 0, message: 'suite: The suite passed in round 1 (`npm test`).', ts: T(5) },
  {
    seq: 15, type: 'step.finished', step_id: 'suite', visit: 1, iteration: 1, duration_ms: 240000, ts: T(5),
    output: { kind: 'suite', status: 'pass', round: 1, scope: 'full', command: 'npm test', log: 'logs/suite-1.log', exit_code: 0, duration_ms: 238000, timeout_ms: 1800000, passed: 412, failed: 0, failures: [], preexisting: [] },
  },
  { seq: 16, type: 'step.transition', from: 'suite', to: 'review', ts: T(5, 1) },
];

const E2E_FAILURES = Array.from({ length: 30 }, (_, i) => ({ test: `runchat scenario ${i + 1} shows the orchestrator`, file: 'e2e/runchat.spec.js', error: 'expected visible' }));
const FAILING_E2E = [
  { seq: 20, type: 'step.started', step_id: 'e2e', visit: 1, iteration: 1, step_type: 'suite', agent: null, ts: T(10) },
  { seq: 21, type: 'step.log', step_id: 'e2e', path: 'logs/e2e-1.log', command: 'npm run test:e2e', ts: T(10, 1) },
  { seq: 22, type: 'log', level: 'info', message: 'suite: npm run test:e2e (round 1, timeout 60 min, log logs/e2e-1.log)', ts: T(10, 2) },
  { seq: 23, type: 'log', level: 'warn', kind: 'suite', step_id: 'e2e', status: 'fail', failures: 30, message: 'e2e: The suite failed in round 1 (`npm run test:e2e`): 30 failing tests. Log: logs/e2e-1.log', ts: T(35) },
  {
    seq: 24, type: 'step.finished', step_id: 'e2e', visit: 1, iteration: 1, duration_ms: 1500000, ts: T(35),
    output: { kind: 'suite', status: 'fail', round: 1, scope: 'full', command: 'npm run test:e2e', log: 'logs/e2e-1.log', exit_code: 1, duration_ms: 1498000, timeout_ms: 3600000, passed: 118, failed: 30, failures: E2E_FAILURES, preexisting: [] },
  },
  { seq: 25, type: 'step.transition', from: 'e2e', to: 'develop', when: 'e2e failed', ts: T(35, 1) },
];

// the memory guard stopped a process during round 1: the round runs again (same visit) once memory recovers
const E2E_MEMORY_RERUN = [
  { seq: 30, type: 'step.started', step_id: 'e2e', visit: 1, iteration: 1, step_type: 'suite', agent: null, ts: T(10) },
  { seq: 31, type: 'step.log', step_id: 'e2e', path: 'logs/e2e-1.log', command: 'npm run test:e2e', ts: T(10, 1) },
  { seq: 32, type: 'log', level: 'info', message: 'suite: npm run test:e2e (round 1, timeout 60 min, log logs/e2e-1.log)', ts: T(10, 2) },
  { seq: 33, type: 'process.killed', step_id: 'e2e', pid: 4242, command_line: 'chromium --headless', message: 'The memory guard stopped chromium --headless (5.1 GB)', ts: T(12) },
  { seq: 34, type: 'log', level: 'warn', kind: 'suite', step_id: 'e2e', status: 'fail', failures: 3, message: 'e2e: The suite failed in round 1 (`npm run test:e2e`): 3 failing tests. Log: logs/e2e-1.log', ts: T(13) },
  { seq: 35, type: 'log', level: 'warn', kind: 'suite_env_rerun', step_id: 'e2e', message: 'e2e: the round failed while the memory guard stopped a process: an environment failure, not the change\'s; it runs again once memory recovers (rerun 1 of at most 2).', ts: T(13, 1) },
  { seq: 36, type: 'log', level: 'warn', kind: 'memory_hold', step_id: 'e2e', message: 'e2e waits for memory before it starts: 1.2 GB free, under the memory guard\'s floor of 2.0 GB (at most 30 min).', ts: T(13, 2) },
  { seq: 37, type: 'step.log', step_id: 'e2e', path: 'logs/e2e-1-env.log', command: 'npm run test:e2e', ts: T(13, 2) },
  { seq: 38, type: 'memory.hold', step_id: 'e2e', waited_ms: 90000, recovered: true, free_bytes: 3e9, floor_bytes: 2e9, ts: T(14, 32) },
  { seq: 39, type: 'log', level: 'info', message: 'suite: npm run test:e2e (round 1, timeout 60 min, log logs/e2e-1-env.log)', ts: T(14, 33) },
  { seq: 40, type: 'log', level: 'info', kind: 'suite', step_id: 'e2e', status: 'pass', failures: 0, message: 'e2e: The suite passed in round 1 (`npm run test:e2e`).', ts: T(30) },
  {
    seq: 41, type: 'step.finished', step_id: 'e2e', visit: 1, iteration: 1, duration_ms: 1200000, ts: T(30),
    output: { kind: 'suite', status: 'pass', round: 1, command: 'npm run test:e2e', log: 'logs/e2e-1-env.log', exit_code: 0, duration_ms: 940000, timeout_ms: 3600000, passed: 148, failed: 0, failures: [], environment_reruns: 1 },
  },
];

const SUITE_SLOT_WAIT = [
  { seq: 50, type: 'step.started', step_id: 'suite', visit: 2, iteration: 1, step_type: 'suite', agent: null, ts: T(40) },
  { seq: 51, type: 'step.log', step_id: 'suite', path: 'logs/suite-2.log', command: 'npm test', ts: T(40, 1) },
  { seq: 52, type: 'log', level: 'info', kind: 'suite_slot', step_id: 'suite', message: 'suite: waiting for the suite slot (run 20261113-140000-abcd1234, pid 9876)', ts: T(40, 2) },
  { seq: 53, type: 'log', level: 'info', message: 'suite: npm test (round 2, timeout 30 min, log logs/suite-2.log)', ts: T(44) },
];

const atSeq = (events, seq) => events.filter((ev) => ev.seq <= seq);

test('#795 a passing suite: one orchestrator message names the command, round, timeout and log; running, then passed with its time', () => {
  const live = chatOf([...START, ...atSeq(PASSING_SUITE, 13)]);
  const running = orch(live, 'suite');
  assert.equal(running.length, 1, 'one orchestrator message for the suite step');
  const [msg] = running;
  assert.equal(msg.state, 'running');
  assert.equal(msg.round, 1);
  assert.equal(msg.log, 'logs/suite-1.log');
  assert.equal(ms(msg.startedAt), ms(T(1)), 'its start time, so the renderer can show the elapsed time');
  assert.ok(!msg.finishedAt, 'no end time while it runs');
  assert.ok(msg.timeoutMin === 30 || /30 min/.test(textOf(msg)), 'the timeout (30 min)');
  assert.ok(textOf(msg).includes('npm test'), 'the command it runs');

  const done = chatOf([...START, ...PASSING_SUITE]);
  const all = orch(done, 'suite');
  assert.equal(all.length, 1, 'the same message becomes the outcome, no second one');
  assert.equal(all[0].state, 'passed');
  assert.equal(all[0].round, 1);
  assert.equal(ms(all[0].finishedAt), ms(T(5)), 'its end time: the duration is computable');
  assert.equal(all[0].counts?.passed, 412);
});

test('#795 a failing e2e suite: the message ends failed with the failing count, the first failures and the round', () => {
  const model = chatOf([...START, ...FAILING_E2E]);
  const msgs = orch(model, 'e2e');
  assert.equal(msgs.length, 1);
  const [msg] = msgs;
  assert.equal(msg.state, 'failed');
  assert.equal(msg.round, 1);
  assert.equal(msg.counts?.failed, 30);
  assert.ok(Array.isArray(msg.failures) && msg.failures.length >= 1, 'the first failures are listed');
  assert.ok(msg.failures.length < 30, 'only the first failures, not all 30');
  assert.ok(textOf(msg.failures[0]).includes('runchat scenario 1 shows the orchestrator'), 'the first failing test first');
  assert.ok(textOf(msg).includes('npm run test:e2e'));
  assert.equal(msg.log, 'logs/e2e-1.log');
  // the transition is still its own system line, once; the result is not repeated as a system line
  assert.equal(systemTexts(model).filter((x) => /e2e → develop/.test(x)).length, 1);
  assert.equal(systemTexts(model).filter((x) => /30 failing tests/.test(x)).length, 0, 'the failing result is on the message, not also a system line');
});

test('#795 log events are folded into the step\'s message: no new chat item per log line, counts updated as a log line gives them', () => {
  const model = chatOf([...START, ...atSeq(FAILING_E2E, 20)]);
  const [msg] = orch(model, 'e2e');
  assert.ok(msg, 'step.started of a step with no agent adds the orchestrator message');
  const before = model.items.length;
  const extra = [
    { seq: 22.1, type: 'log', level: 'info', kind: 'suite', step_id: 'e2e', message: 'e2e: the files that failed first, then the whole suite: 2 failed in round 0 (e2e/a.spec.js, e2e/b.spec.js)', ts: T(10, 3) },
    { seq: 22.2, type: 'log', level: 'info', kind: 'suite', step_id: 'e2e', message: 'e2e: selection: 14 spec files', ts: T(10, 4) },
    { seq: 22.3, type: 'log', level: 'warn', kind: 'suite', step_id: 'e2e', message: 'e2e: 2 spec files are slower than usual', ts: T(10, 5) },
  ];
  for (const ev of [...FAILING_E2E.filter((e) => e.seq > 20 && e.seq < 24), ...extra].sort((a, b) => ms(a.ts) - ms(b.ts))) {
    const touched = model.apply(ev);
    assert.ok(touched.every((id) => id === msg.id), `${ev.type} ${ev.message || ''}: only the orchestrator message changes`);
  }
  assert.equal(model.items.length, before, 'no chat item was added for the log lines');
  assert.equal(orch(model, 'e2e').length, 1);
  assert.equal(msg.state, 'running', 'still running until step.finished');
  assert.equal(msg.counts?.failed, 30, 'the failing count from the suite\'s log line, before the step finishes');
});

test('#795 a rerun after the memory guard: the same message waits for memory (rerun 1 of 2), then runs again and ends passed', () => {
  const model = chatOf([...START, ...atSeq(E2E_MEMORY_RERUN, 35)]);
  let msgs = orch(model, 'e2e');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].state, 'waiting');
  assert.match(textOf(msgs[0].waitingReason), /memory/i);
  assert.match(textOf(msgs[0]), /rerun 1\b/i);
  assert.match(textOf(msgs[0]), /\b2\b/, 'the rerun limit (at most 2)');

  model.apply(E2E_MEMORY_RERUN.find((e) => e.seq === 36));
  assert.equal(orch(model, 'e2e')[0].state, 'waiting', 'still waiting while memory is low');
  assert.match(textOf(orch(model, 'e2e')[0].waitingReason), /memory/i);

  for (const ev of E2E_MEMORY_RERUN.filter((e) => e.seq > 36 && e.seq <= 39)) model.apply(ev);
  msgs = orch(model, 'e2e');
  assert.equal(msgs.length, 1, 'one message per step and round: the rerun updates it');
  assert.equal(msgs[0].state, 'running');
  assert.equal(msgs[0].round, 1);
  assert.equal(msgs[0].log, 'logs/e2e-1-env.log', 'the rerun\'s own log');

  for (const ev of E2E_MEMORY_RERUN.filter((e) => e.seq > 39)) model.apply(ev);
  msgs = orch(model, 'e2e');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].state, 'passed');
  assert.equal(systemTexts(model).filter((x) => /rerun 1 of at most 2/.test(x)).length, 0, 'the rerun is on the message, not also a system line');
});

test('#795 waiting for the suite slot: the message waits and says so, then runs once the round starts', () => {
  const model = chatOf([...START, ...atSeq(SUITE_SLOT_WAIT, 52)]);
  const [msg] = orch(model, 'suite');
  assert.ok(msg);
  assert.equal(msg.state, 'waiting');
  assert.match(textOf(msg.waitingReason), /suite slot/i);
  assert.equal(msg.round, 2);
  model.apply(SUITE_SLOT_WAIT.at(-1));
  assert.equal(orch(model, 'suite').length, 1);
  assert.equal(orch(model, 'suite')[0].state, 'running');
});

test('#795 a live run and its replay give the same orchestrator messages', () => {
  // the e2e step's second visit (round 2) fails, an hour after its first one
  const secondE2e = FAILING_E2E.map((e) => ({
    ...e, seq: e.seq + 200, ts: new Date(ms(e.ts) + 3600000).toISOString(),
    ...(e.visit ? { visit: 2 } : {}), ...(e.output ? { output: { ...e.output, round: 2 } } : {}),
    ...(typeof e.message === 'string' ? { message: e.message.replace('round 1', 'round 2') } : {}),
  }));
  const events = [...START, ...PASSING_SUITE, ...E2E_MEMORY_RERUN.map((e) => ({ ...e, seq: e.seq + 100 })), ...secondE2e];
  const replay = chatOf(events);
  // live: the chat opened mid-run (part replayed, then every event live again, the overlap dropped by seq)
  const live = new RunChatModel();
  for (const ev of events.slice(0, 9)) live.apply(ev);
  for (const ev of events) live.apply(ev);
  const r = orch(replay).map(project);
  assert.equal(r.length, 3, 'suite, e2e round 1 (with its rerun), e2e again');
  assert.ok(r.every((m) => STATES.includes(m.state)));
  assert.deepEqual(orch(live).map(project), r);
});

test('#795 other machine steps (red_check, rule_check) get a message naming the step in plain words', () => {
  const model = chatOf([
    ...START,
    { seq: 2, type: 'step.started', step_id: 'red_check', visit: 1, iteration: 1, step_type: 'suite', agent: null, ts: T(1) },
    { seq: 3, type: 'step.log', step_id: 'red_check', path: 'logs/red_check-1.log', command: 'npm test -- test/new.test.js', ts: T(1, 1) },
    { seq: 4, type: 'step.finished', step_id: 'red_check', visit: 1, iteration: 1, duration_ms: 20000, ts: T(1, 21), output: { kind: 'suite', status: 'fail', round: 1, command: 'npm test -- test/new.test.js', log: 'logs/red_check-1.log', failed: 2, passed: 0, failures: [{ test: 'new behaviour' }, { test: 'other behaviour' }] } },
    { seq: 5, type: 'step.started', step_id: 'rule_check', visit: 1, iteration: 1, step_type: 'check', agent: null, ts: T(2) },
    { seq: 6, type: 'step.log', step_id: 'rule_check', path: 'logs/check-1.log', command: 'npm run lint', ts: T(2, 1) },
  ]);
  const [red] = orch(model, 'red_check');
  assert.ok(red, 'red_check has its orchestrator message');
  assert.ok(textOf(red).includes(model.stepName('red_check')), `named in plain words ("${model.stepName('red_check')}")`);
  assert.equal(red.log, 'logs/red_check-1.log');
  const [rule] = orch(model, 'rule_check');
  assert.ok(rule, 'rule_check has its orchestrator message');
  assert.equal(rule.state, 'running');
  assert.equal(rule.log, 'logs/check-1.log');
  assert.ok(textOf(rule).includes('npm run lint'));
});

test('#795 agent turns and fan-outs keep their place; the orchestrator message sits between them in time order', () => {
  const model = chatOf([
    ...START,
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' }, ts: T(0, 10) },
    { seq: 3, type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer', ts: T(0, 10) },
    { seq: 4, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop', ts: T(0, 11) },
    { seq: 5, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Implemented.', ts: T(0, 50) },
    { seq: 6, type: 'step.finished', step_id: 'develop', visit: 1, duration_ms: 40000, output: { branch: 'x' }, ts: T(0, 50) },
    ...PASSING_SUITE,
    { seq: 20, type: 'step.started', step_id: 'review', visit: 1, step_type: 'agent', agent: 'reviewer_a · reviewer_b', ts: T(6) },
    { seq: 21, type: 'session.opened', session_id: 'ra', session: { agent: 'reviewer_a', provider: 'claude', model: 'claude-opus-5-5' }, ts: T(6) },
    { seq: 22, type: 'session.opened', session_id: 'rb', session: { agent: 'reviewer_b', provider: 'codex', model: 'gpt-6-luna' }, ts: T(6) },
    { seq: 23, type: 'session.message_sent', session_id: 'ra', turn: 1, step_id: 'review', ts: T(6, 1) },
    { seq: 24, type: 'session.message_sent', session_id: 'rb', turn: 1, step_id: 'review', ts: T(6, 1) },
    { seq: 25, type: 'session.message_received', session_id: 'rb', turn: 1, step_id: 'review', text: 'B approves.', ts: T(7) },
    { seq: 26, type: 'session.message_received', session_id: 'ra', turn: 1, step_id: 'review', text: 'A approves.', ts: T(8) },
    { seq: 27, type: 'step.finished', step_id: 'review', visit: 1, duration_ms: 120000, output: {}, ts: T(8) },
  ]);
  const order = model.items.filter((it) => it.kind !== 'system').map((it) => (it.kind === 'orchestrator' ? `orchestrator:${it.step}` : it.kind === 'turn' ? `turn:${it.agent}` : it.kind));
  assert.deepEqual(order, ['start', 'turn:developer', 'orchestrator:suite', 'group', 'turn:reviewer_b', 'turn:reviewer_a']);
  const tsList = model.items.map((it) => ms(it.ts));
  assert.deepEqual(tsList, [...tsList].sort((a, b) => a - b), 'the chat stays in time order');
  const [group] = model.items.filter((it) => it.kind === 'group');
  assert.deepEqual([group.stepId, group.agents, group.done], ['review', ['reviewer_a', 'reviewer_b'], true]);
  assert.deepEqual(model.items.filter((it) => it.kind === 'turn' && it.parent === group.id).map((it) => it.agent).sort(), ['reviewer_a', 'reviewer_b']);
});

test('#795 guard: an agent step (one agent or a fan-out) adds no orchestrator message; its turn is unchanged', () => {
  const model = chatOf([
    ...START,
    { seq: 2, type: 'session.opened', session_id: 's1', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } },
    { seq: 3, type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer', ts: T(0, 10) },
    { seq: 4, type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop' },
    { seq: 5, type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.', ts: T(0, 50) },
    { seq: 6, type: 'step.started', step_id: 'compete', visit: 1, step_type: 'agent', agent: 'a · b', ts: T(1) },
  ]);
  assert.equal(orch(model).length, 0);
  const [turn] = model.items.filter((it) => it.kind === 'turn');
  assert.deepEqual([turn.agent, turn.stepId, turn.text, turn.side], ['developer', 'develop', 'Done.', 'left']);
  assert.equal(model.items.filter((it) => it.kind === 'group').length, 1);
});

// runchat.js runs only in the Electron renderer: its markup is checked on the source, as
// renderer-run-chat.test.js does.
test('#795 renderer: an orchestrator message carries its testids (step, state, log toggle, tail, whole-log link); an agent turn does not', () => {
  const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
  const src = fs.readFileSync(pageFileOf('views/runchat/runchat.js'), 'utf8');
  for (const id of ['runchat-orchestrator-message', 'runchat-orchestrator-log-toggle', 'runchat-orchestrator-log-tail', 'runchat-orchestrator-log-link']) {
    assert.ok(src.includes(`data-testid="${id}"`), `${id} in runchat.js`);
  }
  assert.match(src, /data-testid="runchat-orchestrator-message"[^\n]*data-step="\$\{/, 'data-step on the message');
  assert.match(src, /data-testid="runchat-orchestrator-message"[^\n]*data-state="\$\{/, 'data-state on the message');
  const turnHtml = /function turnHtml\(it\) \{[\s\S]*?\n  \}/.exec(src)?.[0];
  assert.ok(turnHtml, 'turnHtml not found in runchat.js: the source moved');
  assert.ok(!turnHtml.includes('runchat-orchestrator-message'), 'an agent turn is not an orchestrator message');
});
