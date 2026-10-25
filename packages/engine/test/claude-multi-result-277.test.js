// parseClaude (packages/engine/engine/providers.js) on a turn that used sub-agents (#277): Claude Code ends the
// stream with 2-4 `result` events one ms apart, all carrying the CLI session's running
// total_cost_usd. The turn's cost is recorded once and never lowered: the highest total seen in the
// turn minus the session's total before the turn (the --resume and forked-session rules of #233 keep
// their results). Its tokens cover all the turn's result events, not only the last one's.
// Seam: parseClaude(ev, emit, acc) fed the stream-json events directly, a fresh acc per turn (as
// runCli gives it), a distinct CLI session id per test (claudeTotals is module-level).
// The raw `result` events of a turn with more than one are streamed as `raw` items (the engine records
// them as session.stream), so the token rule can be checked against a real stream.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { parseClaude } = require('../engine/providers');

const newSid = () => `sess-277-${crypto.randomUUID()}`;
const init = (sid) => ({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-opus-5-5' });
const assistant = (sid, id, output) => ({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id, usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: output }, content: [{ type: 'text', text: 'working' }] } });
const apiUsage = (input, output, cacheRead, cacheWrite) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });
const result = (sid, total, usage = apiUsage(5, 100, 1000, 0)) => ({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'done', total_cost_usd: total, usage });

// One CLI turn as runCli feeds it: a fresh acc, with the CLI session id already set when resuming.
function turn(events, resumeId = null) {
  const items = [];
  const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId: resumeId, error: null };
  for (const ev of events) parseClaude(ev, (i) => items.push(i), acc);
  return { acc, items };
}

test('a turn ending with two result events carrying the same total records that total once, not 0', () => {
  const sid = newSid();
  const { acc } = turn([init(sid), assistant(sid, 'm1', 50), result(sid, 15.123904), result(sid, 15.123904)]);
  assert.equal(acc.costUsd, 15.123904);
  assert.equal(acc.cliTotalCostUsd, 15.123904, 'the CLI session total kept for the snapshot is the highest one');
});

test('a turn ending with four result events carrying the same total records that total once, not 0', () => {
  const sid = newSid();
  const { acc } = turn([init(sid), result(sid, 2.5), result(sid, 2.5), result(sid, 2.5), result(sid, 2.5)]);
  assert.equal(acc.costUsd, 2.5);
});

test('a turn whose result totals grow (3.0, 3.0, 3.4) costs the highest total minus the session total before the turn', () => {
  const sid = newSid();
  const { acc } = turn([init(sid), result(sid, 3.0), result(sid, 3.0), result(sid, 3.4)]);
  assert.equal(acc.costUsd, 3.4);
});

test('a later result event never replaces the turn cost with a smaller one (the last usage item streamed carries the turn cost)', () => {
  const sid = newSid();
  const { acc, items } = turn([init(sid), result(sid, 4.2), result(sid, 4.2)]);
  assert.equal(acc.costUsd, 4.2);
  const usageItems = items.filter((i) => i.kind === 'usage');
  assert.ok(usageItems.length >= 1, 'a usage item is streamed');
  assert.equal(usageItems.at(-1).costUsd, 4.2, 'the last usage item the engine sees is not 0');
});

test('a resumed turn with two result events (session total 5 before, the turn reports 7 and 7) costs 2', () => {
  const sid = newSid();
  const first = turn([init(sid), result(sid, 5)]);
  assert.equal(first.acc.costUsd, 5);
  const resumed = turn([init(sid), result(sid, 7), result(sid, 7)], sid);
  assert.equal(resumed.acc.costUsd, 2);
});

test('a forked session with two result events (session total 5 before, the turn reports 2 and 2) is a new count: costs 2', () => {
  const sid = newSid();
  assert.equal(turn([init(sid), result(sid, 5)]).acc.costUsd, 5);
  const forked = turn([init(sid), result(sid, 2), result(sid, 2)], sid);
  assert.equal(forked.acc.costUsd, 2);
});

test('the turn after a multi-result turn costs the difference with that turn\'s highest total', () => {
  const sid = newSid();
  assert.equal(turn([init(sid), result(sid, 3.0), result(sid, 3.4), result(sid, 3.4)]).acc.costUsd, 3.4);
  assert.equal(turn([init(sid), result(sid, 4.4)], sid).acc.costUsd, 1);
});

test('the tokens of a multi-result turn are not only the last result event\'s smaller usage', () => {
  const sid = newSid();
  const { acc } = turn([
    init(sid),
    result(sid, 15.123904, apiUsage(102, 84376, 7714400, 198504)),
    result(sid, 15.123904, apiUsage(22, 18805, 1203311, 40211)),
  ]);
  assert.ok(acc.usage.output >= 84376, `output tokens cover the first result event: got ${acc.usage.output}`);
  assert.ok(acc.usage.cache_read >= 7714400, `cache reads cover the first result event: got ${acc.usage.cache_read}`);
  assert.ok(acc.usage.cache_write >= 198504, `cache writes cover the first result event: got ${acc.usage.cache_write}`);
});

test('a turn with a single result event keeps its cost and usage as reported', () => {
  const sid = newSid();
  const { acc } = turn([init(sid), result(sid, 1.75, apiUsage(12, 3000, 340000, 41000))]);
  assert.equal(acc.costUsd, 1.75);
  assert.deepEqual(acc.usage, { input: 12, output: 3000, cache_read: 340000, cache_write: 41000, reasoning: 0 });
});

test('the raw result events of a turn with several are kept, each once and in order', () => {
  const sid = newSid();
  const r1 = result(sid, 15.123904, apiUsage(102, 84376, 7714400, 198504));
  const r2 = result(sid, 15.123904, apiUsage(22, 18805, 2198766, 21202));
  const r3 = result(sid, 15.2, apiUsage(7, 900, 1000, 0));
  const { items } = turn([init(sid), r1, r2, r3]);
  const raw = items.filter((i) => i.kind === 'raw').map((i) => i.event);
  assert.deepEqual(raw, [r1, r2, r3]);
});

test('a turn with a single result event keeps no raw result', () => {
  const sid = newSid();
  const { items } = turn([init(sid), result(sid, 1.75)]);
  assert.equal(items.filter((i) => i.kind === 'raw').length, 0);
});
