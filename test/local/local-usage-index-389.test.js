// #389 internals: the local-usage scan's per-file entries survive an app start through the workspace's
// index (usage_files, src/domains/workspace/store.js), and a scan from entries read back parses nothing again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decodeEntry, encodeEntry, readLocalUsageAsync, scanLocalUsage } = require('../../src/domains/local/local-usage');
const { openStore } = require('../../src/domains/workspace/store');

const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const msg = (id) => ({
  type: 'assistant', sessionId: 's1', requestId: `r-${id}`, timestamp: '2026-09-27T09:00:00Z',
  message: { id: `m-${id}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `t-${id}`, name: 'Edit', input: { file_path: 'a.js', old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 3, output_tokens: 4 } },
});

function seed(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-index-389-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.jsonl'), jl({ type: 'user', sessionId: 's1', message: { content: 'hello' } }, msg(1), msg(1), msg(2)));
  return { root, home, dir };
}

test('entries encoded for the index and read back are used as they are: nothing is parsed again', (t) => {
  const { home } = seed(t);
  const states = new Map();
  const first = scanLocalUsage({ home, states });
  assert.equal(first.records.length, 2);
  assert.equal(first.changed.length, 1);

  const restored = new Map([...states].map(([f, e]) => [f, decodeEntry(encodeEntry(e))]));
  const again = scanLocalUsage({ home, states: restored });
  assert.equal(again.scan.parsedFiles, 0);
  assert.equal(again.records.length, 2);
  assert.deepEqual([...again.sessions.values()][0].files, ['a.js'], 'the session metrics (a Set inside) come back');
});

test('a transcript that shrank is read again from the start; one being written counts only its complete lines', (t) => {
  const { home, dir } = seed(t);
  const file = path.join(dir, 'a.jsonl');
  const states = new Map();
  scanLocalUsage({ home, states });
  fs.appendFileSync(file, '{"type":"assistant","sessionId":"s1"'); // a line still being written
  assert.equal(scanLocalUsage({ home, states }).records.length, 2);
  fs.writeFileSync(file, jl(msg(9)));
  const out = scanLocalUsage({ home, states });
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].tokens.input, 3);
});

test('readLocalUsageAsync with the workspace index saves each transcript\'s entry in usage_files', async (t) => {
  const { root, home } = seed(t);
  const ws = { root, runs: path.join(root, 'runs'), backlog: path.join(root, 'backlog'), index: path.join(root, 'index.db') };
  const store = openStore(ws);
  try {
    const out = await readLocalUsageAsync({ home, index: store.path });
    assert.equal(out.records.length, 2);
    await readLocalUsageAsync({ home, index: store.path }); // answered once the first call's entries are saved
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(store.path);
    try {
      const rows = db.prepare('SELECT file, key FROM usage_files').all();
      assert.equal(rows.length, 1);
      assert.match(rows[0].file, /a\.jsonl$/);
    } finally { db.close(); }
  } finally { store.close(); }
});

test('a save the busy index refuses stays pending and is saved by a later scan (#389)', { timeout: 90000 }, async (t) => {
  const { root, home } = seed(t);
  const ws = { root, runs: path.join(root, 'runs'), backlog: path.join(root, 'backlog'), index: path.join(root, 'index.db') };
  const store = openStore(ws);
  const { DatabaseSync } = require('node:sqlite');
  const holder = new DatabaseSync(store.path); // another writer holding the index (a long main-process transaction)
  const count = () => {
    const db = new DatabaseSync(store.path);
    try { return db.prepare('SELECT COUNT(*) AS n FROM usage_files').get().n; } finally { db.close(); }
  };
  let held = false;
  try {
    holder.exec('BEGIN IMMEDIATE');
    held = true;
    const out = await readLocalUsageAsync({ home, index: store.path });
    assert.equal(out.records.length, 2, 'the scan answers although the index is busy');
    await readLocalUsageAsync({ home, index: store.path }); // answered once the first save gave up
    assert.equal(count(), 0, 'nothing was saved while the index was held');
    holder.exec('ROLLBACK');
    held = false;
    await readLocalUsageAsync({ home, index: store.path }); // the second scan's save has run by now
    assert.equal(count(), 1, 'the unchanged transcript\'s pending entry was saved by a later scan');
  } finally {
    if (held) holder.exec('ROLLBACK');
    holder.close();
    store.close();
  }
});
