// #308: a turn's recorded tokens include its sub-agents' model calls, as its cost already does.
// - parseClaude (packages/engine/engine/providers.js) fed stream-json events with a fresh acc per turn (as runCli
//   gives it); the parsed turn (what runCli resolves with, and the engine records in
//   session.message_received) is read through `turnResult(acc)`, the provider module's builder of
//   that object (new export, required inside the tests). Its `usage` is the whole turn (main
//   conversation + sub-agents, never below the `result` figures field by field), `usage_main` the
//   `result`'s figures (#277: largest of each field over several results), `subagents` { calls, usage }
//   (absent when the turn started none) and `model_calls` (distinct model calls).
// - Codex and Grok: no sub-agent figures from their CLIs, so no `subagents` field.
// - Readers: Analytics › Run (runFigures), the 3D model's Tokens KPI (tokensOut) and the run report
//   (supervisor.runReport) read `usage`; events recorded before #308 (no usage_main / subagents) still read.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseClaude, parseGrok } = require('@multiagent/engine/engine/providers');
const { runFigures } = require('@multiagent/engine/domains/run/run-analysis');
const { runReport } = require('@multiagent/engine/domains/supervisor/supervisor');
const M = require('../renderer/run3d-model');

const newSid = () => `sess-308-${crypto.randomUUID()}`;
const apiUsage = (input, output, cacheRead, cacheWrite) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });
const init = (sid) => ({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-opus-5-5' });
// a main-conversation message (parent_tool_use_id null) and a sub-agent's (started by the Task tool)
const main = (sid, id, usage, content = [{ type: 'text', text: 'working' }]) => ({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id, usage, content } });
const sub = (sid, id, usage) => ({ type: 'assistant', session_id: sid, parent_tool_use_id: 'toolu_task_1', message: { id, usage, content: [{ type: 'text', text: 'exploring' }] } });
const result = (sid, usage, total = 1.5) => ({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'done', total_cost_usd: total, usage });
const tokens = (input, output, cacheRead, cacheWrite) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite, reasoning: 0 });
const four = (u) => ({ input: u.input, output: u.output, cache_read: u.cache_read, cache_write: u.cache_write });

function parsedTurn(parser, events) {
  const { turnResult } = require('@multiagent/engine/engine/providers');
  const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId: null, error: null };
  for (const ev of events) parser(ev, () => {}, acc);
  return turnResult(acc);
}

test('a Claude turn with two sub-agent calls records as usage the sum of its four model calls', () => {
  const sid = newSid();
  const res = parsedTurn(parseClaude, [
    init(sid),
    // Claude Code repeats a message's usage on each of its content blocks: m1 is one model call
    main(sid, 'm1', apiUsage(10, 100, 1000, 200), [{ type: 'thinking', thinking: 'plan' }]),
    main(sid, 'm1', apiUsage(10, 100, 1000, 200), [{ type: 'tool_use', id: 'toolu_task_1', name: 'Task', input: { description: 'Map files' } }]),
    sub(sid, 's1', apiUsage(5, 40, 500, 100)),
    sub(sid, 's2', apiUsage(7, 60, 700, 50)),
    main(sid, 'm2', apiUsage(20, 300, 2000, 0)),
    result(sid, apiUsage(30, 400, 3000, 200)),
  ]);
  assert.deepEqual(res.usage, tokens(42, 500, 4200, 350));
  assert.deepEqual(res.usage_main, tokens(30, 400, 3000, 200));
  assert.equal(res.subagents.calls, 2);
  assert.deepEqual(four(res.subagents.usage), { input: 12, output: 100, cache_read: 1200, cache_write: 150 });
  assert.equal(res.model_calls, 4);
  assert.equal(res.usage.reasoning, 0);
});

test('a Claude turn whose stream lost messages takes the result\'s figure for each field the stream sum is below', () => {
  const sid = newSid();
  const res = parsedTurn(parseClaude, [
    init(sid),
    main(sid, 'm1', apiUsage(10, 100, 1000, 0)),
    sub(sid, 's1', apiUsage(5, 50, 500, 0)),
    result(sid, apiUsage(10, 100, 5000, 300)),
  ]);
  assert.deepEqual(res.usage, tokens(15, 150, 5000, 300));
});

test('a Claude turn without sub-agents has no subagents field, and its usage_main is the result\'s figures', () => {
  const sid = newSid();
  const res = parsedTurn(parseClaude, [init(sid), main(sid, 'm1', apiUsage(10, 100, 1000, 200)), result(sid, apiUsage(10, 100, 1000, 200))]);
  assert.equal('subagents' in res, false);
  assert.deepEqual(res.usage, tokens(10, 100, 1000, 200));
  assert.deepEqual(res.usage_main, tokens(10, 100, 1000, 200));
  assert.equal(res.model_calls, 1);
});

test('a Claude turn with two result events (#277): usage_main is the largest of each result field, usage the larger of it and the stream sum', () => {
  const sid = newSid();
  const res = parsedTurn(parseClaude, [
    init(sid),
    main(sid, 'm1', apiUsage(100, 1000, 10000, 500)),
    sub(sid, 's1', apiUsage(10, 200, 2000, 100)),
    result(sid, apiUsage(102, 900, 9000, 700), 3.2),
    result(sid, apiUsage(22, 1100, 3500, 50), 3.2),
  ]);
  // a sum of the two results would be 124 / 2000 / 12500 / 750
  assert.deepEqual(res.usage_main, tokens(102, 1100, 9000, 700));
  assert.deepEqual(res.usage, tokens(110, 1200, 12000, 700));
  assert.equal(res.subagents.calls, 1);
  assert.equal(res.model_calls, 2);
});

test('a Codex turn has no subagents field', () => {
  const { parseCodex } = require('@multiagent/engine/engine/providers');
  const res = parsedTurn(parseCodex, [
    { type: 'thread.started', thread_id: 'th-308' },
    { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200, reasoning_output_tokens: 50 } },
  ]);
  assert.equal(res.subagents, undefined);
  assert.deepEqual(res.usage, { input: 400, output: 200, cache_read: 600, cache_write: 0, reasoning: 50 });
});

test('a Grok turn has no subagents field', () => {
  const res = parsedTurn(parseGrok, [
    { type: 'text', data: 'done' },
    { type: 'end', sessionId: 'g-308', total_cost_usd: 0.02, usage: { input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0, reasoning_tokens: 10 } },
  ]);
  assert.equal(res.subagents, undefined);
  assert.deepEqual(res.usage, { input: 300, output: 80, cache_read: 1200, cache_write: 0, reasoning: 10 });
});

// ---- readers -------------------------------------------------------------------------------

const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const WHOLE = { input: 42, output: 500, cache_read: 4200, cache_write: 350, reasoning: 0 };
const MAIN = { input: 30, output: 400, cache_read: 3000, cache_write: 200, reasoning: 0 };
// sub-agents: 100 + 200 + 500 + 100 = 900 tokens
const SUBAGENTS = { calls: 2, usage: { input: 100, output: 200, cache_read: 500, cache_write: 100, reasoning: 0 } };
const received = (fields) => ({ ts: at(60), type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'develop', text: 'done', cost_usd: 1.5, duration_ms: 59e3, active_ms: 59e3, waiting_ms: 0, stalled_ms: 0, ...fields });
const withNew = received({ usage: WHOLE, usage_main: MAIN, subagents: SUBAGENTS, model_calls: 6 });
const recordedBefore = received({ usage: WHOLE });

function runEvents(turnEvent) {
  return [
    { ts: at(0), type: 'workflow.started', run_id: 'r-308', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, inputs: { task: 'Task' } },
    { ts: at(0), type: 'session.opened', session_id: 's1', session: { id: 's1', agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } },
    { ts: at(1), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
    { ts: at(1), type: 'session.message_sent', session_id: 's1', turn: 1, step_id: 'develop', prompt: 'do it' },
    turnEvent,
    { ts: at(61), type: 'step.finished', step_id: 'develop', visit: 1, duration_ms: 60e3, output: {} },
    { ts: at(62), type: 'workflow.finished', status: 'success', error: null },
  ];
}

for (const [label, ev] of [['with usage_main and subagents', withNew], ['recorded before #308 (usage only)', recordedBefore]]) {
  test(`Analytics › Run counts a turn ${label} at its usage`, () => {
    const figures = runFigures({ summary: { run_id: 'r-308', workflow: 'AI Development', status: 'success' }, events: runEvents(ev) });
    const dev = figures.agents.find((a) => a.agent === 'developer');
    assert.deepEqual(dev.tokens, { input: 42, output: 500, cache_read: 4200, cache_write: 350 });
    assert.equal(dev.totalTokens, 5092);
  });

  test(`the 3D view's Tokens KPI counts a turn ${label} at its usage`, () => {
    const m = new M.Run3DModel({ mainGates: [] });
    m.applyAll(runEvents(ev).map((e, i) => ({ seq: i + 1, run_id: 'r-308', ...e })));
    assert.equal(m.tokensOut(), 500);
  });
}

function reportOf(t, turnEvent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-308-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${runEvents(turnEvent).map((e) => JSON.stringify(e)).join('\n')}\n`);
  return runReport(dir, { workflowsDir: dir });
}

test('the run report\'s per-agent line says how many sub-agent calls and tokens the agent\'s turns include', (t) => {
  const line = reportOf(t, withNew).split('\n').find((l) => l.includes('of which sub-agents'));
  assert.ok(line, 'a line with the sub-agents');
  assert.match(line, /developer/);
  assert.match(line, /of which sub-agents: 2 calls, 900 tokens/);
});

test('the run report shows no sub-agents for a turn recorded before #308', (t) => {
  assert.doesNotMatch(reportOf(t, recordedBefore), /of which sub-agents/);
});
