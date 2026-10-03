// src/chat-progress.js (#180): the agent chats' live turn. progressItem cuts a runTurn item to what
// the UI shows; createChatTurns batches a turn's items on one throttled 'chat:progress' push and lets
// chat:cancel stop the turn in flight; mockSteps streams a simulated turn's fake steps and text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatTurns, mockSteps, partialText, progressItem } = require('../src/chat-progress');

// ---- progressItem: a runTurn item cut to what the UI shows -------------------------------------

test('progressItem: drops a kind the UI does not show (context, usage, anything unknown) and a missing item', () => {
  assert.equal(progressItem({ kind: 'usage', tokens: 100 }), null);
  assert.equal(progressItem({ kind: 'context', tokens: 100 }), null);
  assert.equal(progressItem(null), null);
  assert.equal(progressItem(undefined), null);
});

test('progressItem: text keeps its text; thinking drops its text (only the kind is shown)', () => {
  assert.deepEqual(progressItem({ kind: 'text', text: 'Hello' }), { kind: 'text', text: 'Hello' });
  assert.deepEqual(progressItem({ kind: 'thinking', text: 'internal reasoning the UI never shows' }), { kind: 'thinking' });
});

test('progressItem: tool_result drops its output, keeping only id and is_error (missing is_error reads false)', () => {
  assert.deepEqual(progressItem({ kind: 'tool_result', id: 't1', output: 'a huge dump', is_error: true }), { kind: 'tool_result', id: 't1', is_error: true });
  assert.deepEqual(progressItem({ kind: 'tool_result', id: 't2', output: 'ok' }), { kind: 'tool_result', id: 't2', is_error: false });
});

test('progressItem: tool_call input keeps only short scalar values, strings cut at 200 characters', () => {
  const longValue = 'x'.repeat(250);
  const it = progressItem({ kind: 'tool_call', id: 'c1', name: 'Bash', input: { command: 'gh issue list', limit: 10, longValue } });
  assert.deepEqual(it, { kind: 'tool_call', id: 'c1', name: 'Bash', input: { command: 'gh issue list', limit: 10, longValue: `${'x'.repeat(200)}…` } });
});

test('progressItem: a tool_call\'s non-scalar values (object, array) are dropped; at most 8 keys are kept', () => {
  const input = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6', g: '7', h: '8', i: '9', nested: { x: 1 }, list: [1, 2] };
  const it = progressItem({ kind: 'tool_call', name: 'Tool', input });
  assert.deepEqual(Object.keys(it.input), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']); // the 9th scalar ('i') and the non-scalars never make it in
});

test('progressItem: a tool_call with no input (or a non-object one) gets an empty input', () => {
  assert.deepEqual(progressItem({ kind: 'tool_call', name: 'Tool' }).input, {});
  assert.deepEqual(progressItem({ kind: 'tool_call', name: 'Tool', input: null }).input, {});
});

// ---- partialText: the prose written so far, without the trailing ```json block -----------------

test('partialText: joins text blocks with a blank line and strips a trailing ```json block', () => {
  assert.equal(partialText(['First part.', 'Second part.']), 'First part.\n\nSecond part.');
  assert.equal(partialText(['Some prose.', '```json\n{"a":1}\n```']), 'Some prose.');
  assert.equal(partialText([]), '');
});

// ---- createChatTurns: start/items (throttled)/end, cancel ---------------------------------------

test('createChatTurns: start() pushes "start" at once; a turn\'s first item flushes immediately, later items in the same window are batched into one "items" push', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const turns = createChatTurns({ emit: (p) => emitted.push(p), throttleMs: 100 });
  const turn = turns.start('po', 'proj1');
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], { chat: 'po', key: 'proj1', turnId: turn.turnId, phase: 'start', items: [] });

  turn.onItem({ kind: 'thinking' }); // the turn's very first item: nothing was flushed yet, so it goes at once
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].phase, 'items');
  assert.deepEqual(emitted[1].items, [{ kind: 'thinking' }]);

  turn.onItem({ kind: 'tool_call', id: 't1', name: 'Read', input: { file_path: 'a.js' } });
  turn.onItem({ kind: 'tool_result', id: 't1', is_error: false });
  assert.equal(emitted.length, 2); // still queued: inside the throttle window of the last flush

  t.mock.timers.tick(100);
  assert.equal(emitted.length, 3);
  assert.deepEqual(emitted[2].items.map((i) => i.kind), ['tool_call', 'tool_result']);
});

test('createChatTurns: a turn\'s partial() joins its text items; end() flushes any queued items first, then pushes "end" with the given status (a second end() is a no-op)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const turns = createChatTurns({ emit: (p) => emitted.push(p), throttleMs: 1000 });
  const turn = turns.start('oracle', '');
  turn.onItem({ kind: 'text', text: 'first' }); // flushes at once (nothing flushed yet)
  assert.equal(turn.partial(), 'first');
  turn.onItem({ kind: 'text', text: 'second' }); // queued: still inside the throttle window
  assert.equal(turn.partial(), 'first\n\nsecond');
  assert.equal(emitted.filter((p) => p.phase === 'items').length, 1);

  turn.end('done');
  assert.deepEqual(emitted.map((p) => p.phase), ['start', 'items', 'items', 'end']);
  assert.deepEqual(emitted[2].items, [{ kind: 'text', text: 'second' }]);
  assert.equal(emitted[3].status, 'done');

  turn.end('failed'); // ended already: ignored
  assert.equal(emitted.length, 4);
});

test('createChatTurns: cancel(chat, key) aborts the turn in flight and returns true while it is live, false once it has ended or for an unknown key', () => {
  const emitted = [];
  const turns = createChatTurns({ emit: (p) => emitted.push(p) });
  const turn = turns.start('po', 'p1');
  assert.equal(turns.cancel('po', 'nope'), false);
  assert.equal(turns.cancel('po', 'p1'), true);
  assert.equal(turn.signal.aborted, true);
  assert.equal(turn.stopped(), true);
  assert.equal(turns.cancel('po', 'p1'), true); // still live until end()
  turn.end('stopped');
  assert.equal(turns.cancel('po', 'p1'), false);
});

test('createChatTurns: a second start() for the same chat and key while one is live is detached (no turnId, no push); the first stays the one tracked and cancellable', () => {
  const emitted = [];
  const turns = createChatTurns({ emit: (p) => emitted.push(p) });
  const first = turns.start('po', 'p1');
  const before = emitted.length;
  const second = turns.start('po', 'p1');
  assert.equal(second.turnId, null);
  second.onItem({ kind: 'text', text: 'ignored' });
  second.end('done');
  assert.equal(emitted.length, before); // nothing pushed for the detached turn
  assert.equal(second.stopped(), false); // its own controller was never aborted

  assert.equal(turns.active('po', 'p1'), first.turnId);
  assert.equal(turns.cancel('po', 'p1'), true);
  assert.equal(first.signal.aborted, true);
});

test('createChatTurns: active(chat, key) is the turn id in flight, or null once no turn is live', () => {
  const turns = createChatTurns({ emit: () => {} });
  assert.equal(turns.active('po', 'p1'), null);
  const turn = turns.start('po', 'p1');
  assert.equal(turns.active('po', 'p1'), turn.turnId);
  turn.end('done');
  assert.equal(turns.active('po', 'p1'), null);
});

// ---- mockSteps: the simulated turn's stream ------------------------------------------------------

test('mockSteps: streams thinking, each step as a tool_call/tool_result pair (by index), then the text block by block, then a trailing json block the UI hides', async () => {
  const items = [];
  await mockSteps((it) => items.push(it), {
    steps: [{ name: 'Read', input: { file_path: 'a.js' } }, { name: 'Grep', input: { pattern: 'x' } }],
    text: 'First paragraph.\n\nSecond paragraph.',
    json: { ok: true },
    delayMs: 0,
  });
  assert.deepEqual(items[0], { kind: 'thinking', text: 'Simulated' });
  assert.deepEqual(items[1], { kind: 'tool_call', id: 'mock-0', name: 'Read', input: { file_path: 'a.js' } });
  assert.deepEqual(items[2], { kind: 'tool_result', id: 'mock-0', output: '', is_error: false });
  assert.deepEqual(items[3], { kind: 'tool_call', id: 'mock-1', name: 'Grep', input: { pattern: 'x' } });
  assert.deepEqual(items[4], { kind: 'tool_result', id: 'mock-1', output: '', is_error: false });
  assert.deepEqual(items[5], { kind: 'text', text: 'First paragraph.' });
  assert.deepEqual(items[6], { kind: 'text', text: 'Second paragraph.' });
  assert.equal(items.length, 8);
  assert.equal(items[7].kind, 'text');
  assert.match(items[7].text, /^```json\n\{\n {2}"ok": true\n\}\n```$/);
});

test('mockSteps: no json block when none is given, and no text items for empty text', async () => {
  const items = [];
  await mockSteps((it) => items.push(it), { steps: [], text: '', delayMs: 0 });
  assert.deepEqual(items, [{ kind: 'thinking', text: 'Simulated' }]);
});

test('mockSteps: rejects "Cancelled" at once when the signal is already aborted (after the thinking item, which fires before the first wait)', async () => {
  const controller = new AbortController();
  controller.abort();
  const items = [];
  await assert.rejects(() => mockSteps((it) => items.push(it), { steps: [{ name: 'Read' }], signal: controller.signal, delayMs: 10 }), /Cancelled/);
  assert.deepEqual(items, [{ kind: 'thinking', text: 'Simulated' }]); // no step was ever reached
});

test('mockSteps: rejects "Cancelled" when the signal aborts mid-stream, after some items were already seen', async () => {
  const controller = new AbortController();
  const items = [];
  const p = mockSteps((it) => { items.push(it); if (items.length === 1) controller.abort(); }, { steps: [{ name: 'Read' }, { name: 'Grep' }], signal: controller.signal, delayMs: 20 });
  await assert.rejects(() => p, /Cancelled/);
  assert.deepEqual(items, [{ kind: 'thinking', text: 'Simulated' }]); // the abort fired during the wait right after
});
