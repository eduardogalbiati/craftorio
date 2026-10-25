// #389 review: the index keeps a compact entry per transcript (records as rows, each session's times
// folded, the last ids of the dedup sets), and a transcript read on from it gives the same result as
// reading it whole. worker-client marks the errors the work itself answered (no fallback on them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decodeEntry, encodeEntry, scanLocalUsage } = require('../../domains/local/local-usage');
const { workerClient } = require('../../domains/workspace/worker-client');

const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const msg = (id, minute) => ({
  type: 'assistant', sessionId: 's1', requestId: `r-${id}`, timestamp: `2026-09-27T09:${String(minute).padStart(2, '0')}:00Z`,
  message: { id: `m-${id}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `t-${id}`, name: 'Edit', input: { file_path: `f${id}.js`, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: id, output_tokens: 4 } },
});

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-compact-389-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  return { home, file: path.join(dir, 'a.jsonl') };
}

test('a transcript read on from its index entry gives the same records and metrics as reading it whole', (t) => {
  const { home, file } = tmp(t);
  fs.writeFileSync(file, jl(msg(1, 0), msg(1, 0), msg(2, 2), msg(3, 30)));
  const states = new Map();
  scanLocalUsage({ home, states });
  const text = encodeEntry(states.get(file));
  assert.doesNotMatch(text, /"times":\["/, 'no raw timestamps in the index');

  const restored = new Map([[file, decodeEntry(text)]]);
  fs.appendFileSync(file, jl(msg(3, 30), msg(4, 33), msg(5, 36)));
  const resumed = scanLocalUsage({ home, states: restored });
  const whole = scanLocalUsage({ home, states: new Map() });
  assert.equal(resumed.scan.parsedFiles, 1);
  assert.deepEqual(resumed.records, whole.records);
  assert.deepEqual(resumed.sessions, whole.sessions);
  assert.equal(whole.records.length, 5);
});

test('an entry in the older format is refused (the transcript is read again)', () => {
  assert.throws(() => decodeEntry(JSON.stringify({ kind: 'claude', key: '1:2', offset: 2, state: { records: [] } })));
});

test('worker-client marks an error the worker answered, not one of a worker that stopped', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-389-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'w.js');
  fs.writeFileSync(file, `const { parentPort } = require('worker_threads');
parentPort.on('message', ({ id, op }) => { if (op === 'exit') process.exit(1); parentPort.postMessage({ id, error: 'the work failed' }); });`);
  const call = workerClient(file);
  await assert.rejects(call({ op: 'fail' }), (e) => e.answered === true && /the work failed/.test(e.message));
  await assert.rejects(call({ op: 'exit' }), (e) => !e.answered);
});
