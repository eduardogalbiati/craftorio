// #308 internals: parseClaude's stream sum (packages/engine/engine/providers.js addStreamUsage) when Claude Code
// repeats a message on each of its content blocks with growing figures, and the parsed turn of a
// turn killed before its `result`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClaude, turnResult } = require('../engine/providers');

const usage = (input, output) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const msg = (id, u, parent = null) => ({ type: 'assistant', session_id: 'sess-308-int', parent_tool_use_id: parent, message: { id, usage: u, content: [] } });

function run(events) {
  const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId: null, error: null };
  for (const ev of events) parseClaude(ev, () => {}, acc);
  return acc;
}

test('a message repeated with a growing output counts once, at its largest figures', () => {
  const acc = run([msg('m1', usage(10, 3)), msg('m1', usage(10, 90)), msg('s1', usage(5, 2), 'toolu_1'), msg('s1', usage(5, 40), 'toolu_1')]);
  assert.equal(acc.modelCalls, 2);
  assert.equal(acc.streamUsage.input, 15);
  assert.equal(acc.streamUsage.output, 130);
  assert.deepEqual({ calls: acc.subagents.calls, input: acc.subagents.usage.input, output: acc.subagents.usage.output }, { calls: 1, input: 5, output: 40 });
});

test('a turn without a result: no usage_main, its stream still counted for the partial', () => {
  const acc = run([msg('m1', usage(10, 30))]);
  const res = turnResult(acc);
  assert.equal('usage_main' in res, false);
  assert.equal(res.model_calls, 1);
  assert.equal(acc.streamUsage.output, 30);
});
