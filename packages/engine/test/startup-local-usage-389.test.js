// #389 acceptance: the local-usage scan (packages/engine/domains/local/local-usage.js) runs off the main thread and is incremental.
//
// The contract these tests assume (new export of packages/engine/domains/local/local-usage.js, required inside each test):
//
//   readLocalUsageAsync({ home }) -> Promise<{ records, sessions, plans, found, sources, scan }>
//     - same result shape as the sync readLocalUsage({ home }) (records, sessions, plans.codex,
//       found, sources), computed in a worker thread or utilityProcess: the calling thread's event
//       loop keeps running while the CLIs' transcripts are read and parsed (no stall over 200 ms,
//       the budget of the issue's startup test);
//     - incremental: each file's state is kept between calls (in the process, and in the workspace
//       index when one is open), keyed by its size and mtime. An unchanged file is not parsed again;
//       a file that grew is parsed only from the bytes appended since the last scan;
//     - `scan`: what this call did, { files, parsedFiles, bytesParsed }:
//         files        the transcript files found (Claude, Codex, Grok)
//         parsedFiles  how many of them were read and parsed in this call (0 when nothing changed)
//         bytesParsed  how many bytes were read and parsed in this call
//
// The sync readLocalUsage stays (test/local-usage.test.js covers its parsing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const claudeMsg = (id, session, input, output) => ({
  type: 'assistant', sessionId: session, requestId: `req-${id}`, timestamp: '2026-09-27T09:00:00Z',
  message: { id: `msg-${id}`, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } },
});

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-389-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// `files` Claude transcripts of `messages` assistant messages each, every message written twice
// (as Claude Code does while streaming: counted once), plus one Codex rollout.
function seedHome(t, { files, messages }) {
  const home = tempHome(t);
  const cdir = path.join(home, '.claude', 'projects', 'C--proj');
  fs.mkdirSync(cdir, { recursive: true });
  for (let f = 0; f < files; f++) {
    const lines = [];
    for (let m = 0; m < messages; m++) {
      const msg = claudeMsg(`${f}-${m}`, `session-${f}`, 5, 50);
      lines.push(msg, msg);
    }
    fs.writeFileSync(path.join(cdir, `s${f}.jsonl`), jl({ type: 'user', sessionId: `session-${f}`, message: { content: 'hi' } }, ...lines));
  }
  const xdir = path.join(home, '.codex', 'sessions', '2026', '09', '27');
  fs.mkdirSync(xdir, { recursive: true });
  fs.writeFileSync(path.join(xdir, 'rollout-2026-09-27T09-00-00-x.jsonl'), jl(
    { timestamp: '2026-09-27T09:00:00Z', type: 'session_meta', payload: { id: 'codex-thread' } },
    { timestamp: '2026-09-27T09:00:01Z', type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    { timestamp: '2026-09-27T09:00:05Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 20, reasoning_output_tokens: 1 } } } },
  ));
  return { home, claudeDir: cdir };
}

const claudeCount = (r) => r.records.filter((x) => x.provider === 'claude').length;

test('readLocalUsageAsync scans many transcripts without stalling the calling thread over 200 ms (#389)', async (t) => {
  const { readLocalUsageAsync } = require('../domains/local/local-usage');
  assert.equal(typeof readLocalUsageAsync, 'function', 'packages/engine/domains/local/local-usage.js exports readLocalUsageAsync');
  // about 60,000 lines to parse: seconds of synchronous work on the main thread before #389
  const { home } = seedHome(t, { files: 200, messages: 150 });

  let last = Date.now();
  let maxGap = 0;
  let ticks = 0;
  const timer = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 10);
  let pending;
  try {
    const started = Date.now();
    pending = readLocalUsageAsync({ home });
    const syncMs = Date.now() - started;
    assert.ok(pending && typeof pending.then === 'function', 'readLocalUsageAsync returns a Promise');
    assert.ok(syncMs < 200, `the call returns at once (it took ${syncMs} ms before returning its Promise)`);
    const r = await pending;
    assert.equal(claudeCount(r), 200 * 150, 'every Claude message counted once');
    assert.equal(r.found.claude, true);
    assert.equal(r.found.codex, true);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks > 0, 'the event loop ran while the scan was in progress');
  assert.ok(maxGap < 200, `the calling thread never stalled over 200 ms during the scan (longest gap: ${maxGap} ms)`);
});

test('readLocalUsageAsync parses nothing again when no transcript changed (#389)', async (t) => {
  const { readLocalUsageAsync } = require('../domains/local/local-usage');
  assert.equal(typeof readLocalUsageAsync, 'function', 'packages/engine/domains/local/local-usage.js exports readLocalUsageAsync');
  const { home } = seedHome(t, { files: 5, messages: 20 });

  const first = await readLocalUsageAsync({ home });
  assert.equal(first.scan.files, 6, 'five Claude transcripts and one Codex rollout');
  assert.equal(first.scan.parsedFiles, 6, 'the first scan parses every file');
  assert.ok(first.scan.bytesParsed > 0);

  const again = await readLocalUsageAsync({ home });
  assert.equal(again.scan.files, 6);
  assert.equal(again.scan.parsedFiles, 0, 'unchanged files (same size and mtime) are not parsed again');
  assert.equal(again.scan.bytesParsed, 0);
  assert.equal(claudeCount(again), claudeCount(first), 'the totals come from the kept records');
  assert.equal(claudeCount(again), 5 * 20);
});

test('readLocalUsageAsync parses only the bytes appended to a transcript since the last scan (#389)', async (t) => {
  const { readLocalUsageAsync } = require('../domains/local/local-usage');
  assert.equal(typeof readLocalUsageAsync, 'function', 'packages/engine/domains/local/local-usage.js exports readLocalUsageAsync');
  const { home, claudeDir } = seedHome(t, { files: 3, messages: 200 });
  const grown = path.join(claudeDir, 's1.jsonl');

  const first = await readLocalUsageAsync({ home });
  assert.equal(claudeCount(first), 3 * 200);
  const sizeBefore = fs.statSync(grown).size;

  // two new messages in one transcript (one written twice while streaming), and an older one repeated
  const appended = jl(claudeMsg('new-1', 'session-1', 7, 70), claudeMsg('new-1', 'session-1', 7, 70), claudeMsg('new-2', 'session-1', 9, 90), claudeMsg('1-0', 'session-1', 5, 50));
  fs.appendFileSync(grown, appended);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(grown, later, later);

  const next = await readLocalUsageAsync({ home });
  assert.equal(next.scan.parsedFiles, 1, 'only the transcript that grew is read');
  const appendedBytes = Buffer.byteLength(appended);
  assert.ok(next.scan.bytesParsed >= appendedBytes, `the appended bytes are parsed (${next.scan.bytesParsed} of ${appendedBytes})`);
  assert.ok(next.scan.bytesParsed < sizeBefore, `the bytes before them are not parsed again (${next.scan.bytesParsed} bytes parsed, ${sizeBefore} were there before)`);
  assert.equal(claudeCount(next), 3 * 200 + 2, 'the two new messages are counted, each once; the repeated old one is not');
  const added = next.records.filter((x) => x.provider === 'claude' && x.tokens.input === 9);
  assert.equal(added.length, 1);
  assert.equal(added[0].tokens.output, 90);
});
