// #278 Self-healing: the new detectors and the per-day metrics (packages/engine/domains/night/night-watch.js). Pure functions over
// run events and the Oracle's night log: no service, no model call.
// Acceptance tests written before the code. The API they pin down (the developer implements it):
//   - INCIDENT_KINDS gains 'cost-gap', 'environment', 'repeat' (memory exists since #276); its keys
//     stay sorted.
//   - detectSelfHealing(runs, { now } = {}) → [{ kind, runId, projectId, since, evidence }]
//       runs: [{ runId, events }] (each run's events.jsonl lines, the engine's shapes);
//       at most ONE finding per run and kind; `evidence` a non-empty object naming what was seen
//       (the command line, the test file, ...); `since` the ts of the first event that shows it.
//     Kinds:
//       memory      a `process.killed` event, or a `memory.hold` with waited_ms > 5 min (#276);
//       cost-gap    a `session.message_received` with cost_usd 0 and usage tokens > 0, or with a
//                   cost_usd below a `session.stream` usage item ({ item: { kind: 'usage', costUsd } })
//                   of the same session and turn (#277);
//       environment a test file in the `failures` of a suite `step.finished` (output.kind 'suite', the
//                   base check ran: base_check set, so it passes on the base) of two runs of DIFFERENT
//                   issues (workflow.started `issues`) within one hour; a file listed in `preexisting`
//                   (fails on the base) never counts;
//       repeat      the same command failing (a `session.stream` tool_call + its tool_result with
//                   is_error) or stopped (`process.killed` command_line) three times in one step; the
//                   step of a stream item is the step_id of that session/turn's `session.message_sent`.
//   - selfHealingMetrics({ log, usage, day }) → { day, detected, repaired, waiting, costUsd, tokens }
//       for one UTC day (YYYY-MM-DD): detected = oracle.detected entries; repaired = oracle.action
//       entries with auto and ok !== false; waiting = oracle.escalated entries (left for the owner);
//       costUsd / tokens = the Oracle's usage.jsonl lines of that day (tokens summed over every kind).
const test = require('node:test');
const assert = require('node:assert/strict');

const nw = () => require('../domains/night/night-watch');

const T0 = Date.parse('2026-10-04T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString();
const GIB = 1024 ** 3;
const TOKENS = { input: 102, output: 84376, cache_read: 7714400, cache_write: 198504, reasoning: 0 };
const ZERO = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };

const started = (runId, issue, min = 0) => ({ ts: at(min), type: 'workflow.started', run_id: runId, workflow: 'AI Development', project_id: 'orchestrator', issues: [{ number: issue, title: `Issue ${issue}`, url: `https://github.com/o/r/issues/${issue}` }], mock: false, cost_accounting: 'per_turn' });
const sent = (min, turn, step) => ({ ts: at(min), type: 'session.message_sent', session_id: 's1', turn, step_id: step, prompt: 'do it' });
const received = (min, turn, step, usage, cost) => ({ ts: at(min), type: 'session.message_received', session_id: 's1', turn, step_id: step, text: 'done', usage, cost_usd: cost, duration_ms: 60e3 });
const usageItem = (min, turn, costUsd) => ({ ts: at(min), type: 'session.stream', session_id: 's1', turn, item: { kind: 'usage', usage: TOKENS, costUsd } });
const toolCall = (min, turn, id, command) => ({ ts: at(min), type: 'session.stream', session_id: 's1', turn, item: { kind: 'tool_call', id, name: 'Bash', input: { command } } });
const toolResult = (min, turn, id, isError) => ({ ts: at(min), type: 'session.stream', session_id: 's1', turn, item: { kind: 'tool_result', id, output: isError ? 'Error: exit 1' : 'ok', is_error: isError } });
const killed = (min, command, step = 'implement') => ({ ts: at(min), type: 'process.killed', pid: 4242 + min, command_line: command, bytes: 9 * GIB, limit_bytes: 8 * GIB, step_id: step, session: 's1' });
const suite = (min, { failures = [], preexisting = [] } = {}) => ({
  ts: at(min), type: 'step.finished', step_id: 'suite', visit: 1, duration_ms: 4 * 60e3,
  output: { kind: 'suite', status: failures.length ? 'fail' : 'pass', round: 1, failures, preexisting, base_check: { commit: 'abc12345', ran: true } },
});
const fail = (file) => ({ test: `${file} > a test`, file, error: 'EADDRINUSE: address already in use :::7300' });

const of = (found, kind) => found.filter((f) => f.kind === kind);
const detect = (runs) => nw().detectSelfHealing(runs);

test('#278 INCIDENT_KINDS: has memory, cost-gap, environment and repeat, each with a label, keys sorted', () => {
  const { INCIDENT_KINDS } = nw();
  for (const k of ['memory', 'cost-gap', 'environment', 'repeat']) assert.equal(typeof INCIDENT_KINDS[k], 'string', `no label for ${k}`);
  const keys = Object.keys(INCIDENT_KINDS);
  assert.deepEqual(keys, [...keys].sort());
});

test('#278 memory: a process stopped by the memory guard is one finding with the command line as evidence', () => {
  const found = detect([{ runId: 'r1', events: [started('r1', 276), killed(5, 'node --test test/x.test.js')] }]);
  const mem = of(found, 'memory');
  assert.equal(mem.length, 1);
  assert.equal(mem[0].runId, 'r1');
  assert.equal(mem[0].projectId, 'orchestrator');
  assert.equal(mem[0].since, at(5));
  assert.match(JSON.stringify(mem[0].evidence), /node --test test\/x\.test\.js/);
});

test('#278 memory: a low-memory hold over 5 minutes is a finding; a 2-minute hold is not', () => {
  const hold = (runId, waited) => ({ runId, events: [started(runId, 276), { ts: at(3), type: 'memory.hold', waited_ms: waited, free_bytes: 2 * GIB, floor_bytes: 3.2 * GIB }] });
  assert.equal(of(detect([hold('long', 6 * 60e3)]), 'memory').length, 1);
  assert.equal(of(detect([hold('short', 2 * 60e3)]), 'memory').length, 0);
});

test('#278 cost-gap: the eight turns of #277 recorded cost_usd 0 with tokens > 0 give ONE finding for the run, since the first', () => {
  const events = [started('r-277', 277)];
  for (let turn = 1; turn <= 8; turn++) events.push(sent(turn * 2, turn, 'implement'), received(turn * 2 + 1, turn, 'implement', TOKENS, 0));
  const gaps = of(detect([{ runId: 'r-277', events }]), 'cost-gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].runId, 'r-277');
  assert.equal(gaps[0].since, at(3));
  assert.equal(typeof gaps[0].evidence, 'object');
  assert.ok(gaps[0].evidence && Object.keys(gaps[0].evidence).length > 0, 'the finding carries its evidence');
});

test('#278 cost-gap: a turn recorded below a usage item of the same turn is a finding', () => {
  const events = [started('r1', 277), sent(1, 1, 'implement'), usageItem(2, 1, 3.2), usageItem(2, 1, 0), received(2, 1, 'implement', TOKENS, 0.5)];
  assert.equal(of(detect([{ runId: 'r1', events }]), 'cost-gap').length, 1);
});

test('#278 cost-gap: a priced turn (cost at least its usage items) and a mock turn with no tokens are not findings', () => {
  const priced = [started('ok', 277), sent(1, 1, 'implement'), usageItem(2, 1, 1.2), received(2, 1, 'implement', TOKENS, 1.2)];
  const mock = [started('mock', 277), sent(1, 1, 'implement'), received(2, 1, 'implement', ZERO, 0)];
  assert.deepEqual(of(detect([{ runId: 'ok', events: priced }, { runId: 'mock', events: mock }]), 'cost-gap'), []);
});

test('#369 cost-gap: a turn the app priced from its tokens is not a finding, though the CLI\'s usage item is higher', () => {
  const events = [started('r1', 369), sent(1, 1, 'implement'), usageItem(2, 1, 0.185), { ...received(2, 1, 'implement', TOKENS, 0.005), cost_source: 'tokens', cli_cost_usd: 0.185 }];
  assert.deepEqual(of(detect([{ runId: 'r1', events }]), 'cost-gap'), []);
});

test('#369 cost-gap: a turn with no price for its model (cost unknown) is not a finding', () => {
  const events = [started('r1', 369), sent(1, 1, 'implement'), usageItem(2, 1, 0.185), { ...received(2, 1, 'implement', TOKENS, null), cost_source: 'unknown', cli_cost_usd: 0.185 }];
  assert.deepEqual(of(detect([{ runId: 'r1', events }]), 'cost-gap'), []);
});

test('#369 cost-gap: the same gap on a turn priced by the CLI is still a finding', () => {
  const events = [started('r1', 369), sent(1, 1, 'implement'), usageItem(2, 1, 0.185), received(2, 1, 'implement', TOKENS, 0.005)];
  assert.equal(of(detect([{ runId: 'r1', events }]), 'cost-gap').length, 1);
});

test('#278 environment: the same test file failing (passing on the base) in runs of two different issues within one hour', () => {
  const a = { runId: 'r-a', events: [started('r-a', 270, 0), suite(10, { failures: [fail('test/server.test.js')] })] };
  const b = { runId: 'r-b', events: [started('r-b', 271, 20), suite(50, { failures: [fail('test/server.test.js')] })] };
  const env = of(detect([a, b]), 'environment');
  assert.ok(env.length >= 1, 'no environment finding');
  for (const f of env) {
    assert.ok(['r-a', 'r-b'].includes(f.runId), `finding on ${f.runId}`);
    assert.match(JSON.stringify(f.evidence), /test\/server\.test\.js/);
  }
  assert.ok(env.length <= 2, 'at most once per run');
});

test('#278 environment: not when both runs work on the same issue, more than an hour apart, or the file fails on the base too', () => {
  const run = (id, issue, min, out) => ({ runId: id, events: [started(id, issue, min), suite(min + 5, out)] });
  const f = { failures: [fail('test/server.test.js')] };
  assert.deepEqual(of(detect([run('a', 270, 0, f), run('b', 270, 10, f)]), 'environment'), [], 'same issue');
  assert.deepEqual(of(detect([run('a', 270, 0, f), run('b', 271, 120, f)]), 'environment'), [], 'two hours apart');
  const pre = { failures: [], preexisting: [fail('test/server.test.js')] };
  assert.deepEqual(of(detect([run('a', 270, 0, pre), run('b', 271, 10, pre)]), 'environment'), [], 'fails on the base');
});

test('#278 repeat: the same command failing three times in one step is one finding naming the command', () => {
  const events = [started('r1', 278), { ts: at(0), type: 'step.started', step_id: 'implement', visit: 1 }, sent(1, 1, 'implement')];
  for (let i = 0; i < 3; i++) events.push(toolCall(2 + i, 1, `t${i}`, 'npm run lint'), toolResult(2 + i, 1, `t${i}`, true));
  const rep = of(detect([{ runId: 'r1', events }]), 'repeat');
  assert.equal(rep.length, 1);
  assert.match(JSON.stringify(rep[0].evidence), /npm run lint/);
});

test('#278 repeat: the same command stopped three times in one step (process.killed) is a finding', () => {
  const events = [started('r1', 278), killed(1, 'node --test test/big.test.js'), killed(2, 'node --test test/big.test.js'), killed(3, 'node --test test/big.test.js')];
  assert.equal(of(detect([{ runId: 'r1', events }]), 'repeat').length, 1);
});

test('#278 repeat: twice, three different commands, or three failures split across two steps are not findings', () => {
  const twice = [started('a', 278), sent(1, 1, 'implement')];
  for (let i = 0; i < 2; i++) twice.push(toolCall(2 + i, 1, `t${i}`, 'npm run lint'), toolResult(2 + i, 1, `t${i}`, true));
  const different = [started('b', 278), sent(1, 1, 'implement')];
  ['npm run lint', 'npm test', 'npm run build'].forEach((c, i) => different.push(toolCall(2 + i, 1, `t${i}`, c), toolResult(2 + i, 1, `t${i}`, true)));
  const split = [started('c', 278), sent(1, 1, 'implement')];
  for (let i = 0; i < 2; i++) split.push(toolCall(2 + i, 1, `t${i}`, 'npm run lint'), toolResult(2 + i, 1, `t${i}`, true));
  split.push(sent(10, 2, 'fix'), toolCall(11, 2, 'u1', 'npm run lint'), toolResult(11, 2, 'u1', true));
  const succeeded = [started('d', 278), sent(1, 1, 'implement')];
  for (let i = 0; i < 3; i++) succeeded.push(toolCall(2 + i, 1, `t${i}`, 'npm run lint'), toolResult(2 + i, 1, `t${i}`, false));
  const found = detect([{ runId: 'a', events: twice }, { runId: 'b', events: different }, { runId: 'c', events: split }, { runId: 'd', events: succeeded }]);
  assert.deepEqual(of(found, 'repeat'), []);
});

test('#278 detectSelfHealing: at most once per run and kind, whatever the number of events', () => {
  const events = [started('r1', 276)];
  for (let i = 0; i < 5; i++) events.push(killed(i + 1, `node --test test/t${i}.test.js`));
  for (let turn = 1; turn <= 3; turn++) events.push(sent(10 + turn, turn, 'implement'), received(10 + turn, turn, 'implement', TOKENS, 0));
  const found = detect([{ runId: 'r1', events }]);
  const keys = found.map((f) => `${f.runId} ${f.kind}`);
  assert.deepEqual(keys, [...new Set(keys)]);
  assert.equal(of(found, 'memory').length, 1);
  assert.equal(of(found, 'cost-gap').length, 1);
});

test('#278 selfHealingMetrics: one day\'s detected, repaired alone, waiting, cost and tokens', () => {
  const { selfHealingMetrics } = nw();
  const day = '2026-10-04';
  const log = [
    { ts: '2026-10-04T09:00:00.000Z', type: 'oracle.detected', id: 'd1', kind: 'failed', target: 'r1', runId: 'r1' },
    { ts: '2026-10-04T11:00:00.000Z', type: 'oracle.detected', id: 'd2', kind: 'cost-gap', target: 'r2', runId: 'r2' },
    { ts: '2026-10-04T15:00:00.000Z', type: 'oracle.detected', id: 'd3', kind: 'repeat', target: 'r3', runId: 'r3' },
    { ts: '2026-10-04T09:05:00.000Z', type: 'oracle.action', actionId: 'a1', kind: 'roadmap.item', target: 'r1', runId: 'r1', permission: 'retry', auto: true, ok: true },
    { ts: '2026-10-04T09:06:00.000Z', type: 'oracle.action', actionId: 'a2', kind: 'dispatch.restart', target: 'all', permission: 'owner-click', auto: false, ok: true },
    { ts: '2026-10-04T11:01:00.000Z', type: 'oracle.escalated', target: 'r2', runId: 'r2', reason: 'permission' },
    { ts: '2026-10-04T15:01:00.000Z', type: 'oracle.escalated', target: 'r3', runId: 'r3', reason: 'permission' },
    // the day before: not counted
    { ts: '2026-10-03T23:59:00.000Z', type: 'oracle.detected', id: 'd0', kind: 'failed', target: 'r0', runId: 'r0' },
    { ts: '2026-10-03T23:59:30.000Z', type: 'oracle.action', actionId: 'a0', kind: 'roadmap.item', target: 'r0', auto: true, ok: true },
  ];
  const usage = [
    { ts: '2026-10-04T09:04:00.000Z', provider: 'claude', costUsd: 0.25, tokens: { input: 1000, output: 500 } },
    { ts: '2026-10-04T11:00:30.000Z', provider: 'claude', costUsd: 0.5, tokens: { input: 2000, cache_read: 3000 } },
    { ts: '2026-10-03T22:00:00.000Z', provider: 'claude', costUsd: 9, tokens: { input: 99999 } },
  ];
  const m = selfHealingMetrics({ log, usage, day });
  assert.equal(m.day, day);
  assert.equal(m.detected, 3);
  assert.equal(m.repaired, 1);
  assert.equal(m.waiting, 2);
  assert.ok(Math.abs(m.costUsd - 0.75) < 1e-9, `costUsd ${m.costUsd}`);
  assert.equal(m.tokens, 6500);
});
