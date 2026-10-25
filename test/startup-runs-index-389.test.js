// #389 acceptance: after a READ_VERSION change (src/domains/run/runs.js: a new way of reading a run), the run
// index is rebuilt incrementally and asynchronously, never in one synchronous transaction at start.
//
// The contract these tests assume:
//   - runs.listRuns(runsDir) (sync) with the workspace index open: a row whose run files are
//     unchanged but that was read by an older READ_VERSION is still served from the index (it is
//     not read again from its folder there and then); its re-read is left to the async rebuild.
//     A run whose files changed is read again, as before.
//   - runs.rebuildIndexAsync(runsDir) -> Promise<number> (new export, required inside each test):
//     re-reads the rows of an older reading (and the runs not indexed yet) one run at a time,
//     letting other work in between runs (the event loop turns while it works), and resolves to
//     the number of runs it read again. After it, every row carries the current reading.
//
// An older reading is simulated by rewriting the index rows with a signature whose last part (the
// READ_VERSION) is another one, and a title only that row has.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runs = require('../src/domains/run/runs');
const { openStore } = require('../src/domains/workspace/store');

const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const OLD_TITLE = 'Read by an older version';

function workspaceWithRuns(t, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-index-389-'));
  const ws = { root, runs: path.join(root, 'runs'), backlog: path.join(root, 'backlog'), index: path.join(root, 'index.db') };
  fs.mkdirSync(ws.runs, { recursive: true });
  fs.mkdirSync(ws.backlog, { recursive: true });
  for (let i = 0; i < count; i++) {
    const id = `run-${String(i).padStart(3, '0')}`;
    const dir = path.join(ws.runs, id);
    const started = new Date(Date.UTC(2026, 8, 1, 10, i)).toISOString();
    const finished = new Date(Date.UTC(2026, 8, 1, 10, i, 30)).toISOString();
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'events.jsonl'), jl(
      { ts: started, type: 'workflow.started', workflow: 'writer-reviewer', file: 'writer-reviewer.yaml', inputs: { task: `Task ${i}` }, mock: true },
      { ts: finished, type: 'workflow.finished', status: 'success' },
    ));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: id, workflow: 'writer-reviewer', status: 'success', started_at: started, finished_at: finished, duration_ms: 30000, inputs: { task: `Task ${i}` }, sessions: [], mock: true,
    }));
  }
  const store = openStore(ws);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { ws, store };
}

// Indexes every run, then rewrites each row as an older READ_VERSION would have left it.
function indexedByAnOlderReading(ws, store) {
  runs.listRuns(ws.runs);
  const rows = store.runEntries();
  assert.ok(rows.size > 0, 'the runs were indexed');
  for (const [, row] of rows) {
    const sig = String(row.sig).replace(/\|[^|]*$/, '|an-older-reading');
    store.putRun({ ...row.info, title: OLD_TITLE }, sig, null);
  }
  return rows.size;
}

test('listRuns answers from the rows of an older reading instead of reading every run again synchronously (#389)', (t) => {
  const { ws, store } = workspaceWithRuns(t, 12);
  indexedByAnOlderReading(ws, store);

  const list = runs.listRuns(ws.runs);
  assert.equal(list.length, 12);
  assert.deepEqual([...new Set(list.map((r) => r.title))], [OLD_TITLE], 'every run comes from its index row: none was read again from its folder in the listing');
});

test('rebuildIndexAsync re-reads the rows of an older reading in the background, one run at a time (#389)', async (t) => {
  assert.equal(typeof runs.rebuildIndexAsync, 'function', 'src/domains/run/runs.js exports rebuildIndexAsync');
  const { ws, store } = workspaceWithRuns(t, 30);
  indexedByAnOlderReading(ws, store);

  let ticks = 0;
  let ticking = true;
  const tick = () => { if (!ticking) return; ticks++; setImmediate(tick); };
  setImmediate(tick);
  let count;
  try {
    const pending = runs.rebuildIndexAsync(ws.runs);
    assert.ok(pending && typeof pending.then === 'function', 'rebuildIndexAsync returns a Promise');
    count = await pending;
  } finally {
    ticking = false;
  }
  assert.equal(count, 30, 'every row of the older reading was read again');
  assert.ok(ticks >= 2, `the event loop turned while the index was rebuilt (${ticks} turns)`);

  const rows = store.runEntries();
  assert.equal([...rows.values()].filter((r) => String(r.sig).endsWith('|an-older-reading')).length, 0, 'every row now carries the current reading');
  const titles = runs.listRuns(ws.runs).map((r) => r.title);
  assert.equal(titles.length, 30);
  assert.ok(!titles.includes(OLD_TITLE), 'the listing now shows what the current reading reads');
  assert.ok(titles.includes('Task 0'));
});
