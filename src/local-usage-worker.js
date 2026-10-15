// The worker thread of readLocalUsageAsync (src/local-usage.js, #389): runs the incremental scan of
// the CLIs' transcripts off the main process and keeps each file's entry between calls. Given the
// workspace's index.db, it loads the entries from its usage_files table once (the first scan after an
// app start reads only what changed since the last one) and, after answering, saves the entries a scan
// changed (compact, src/local-usage.js encodeEntry) in small transactions, through a node:sqlite
// connection of its own opened for each save (the service's handle keeps its own). When the service
// closes the index (releaseUsageIndex), the saves still pending for it are dropped (kept unsaved).
//
// It also computes the Usage screen's totals (src/usage.js computeUsage, op 'usage'), so the records
// of the machine scope never cross to the main process.
//
// Message in: { id, op: 'scan' | 'usage', home, index, opts }; out: { id, result } or { id, error }.

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const { decodeEntry, encodeEntry, scanLocalUsage } = require('./local-usage');

const BUSY_TIMEOUT_MS = 5000;
const states = new Map(); // file → entry
const loaded = new Set(); // the index files whose entries were loaded

// A connection to the index for one scan (closed after it, so the workspace folder is never held
// open), or null when there is none or it has no usage_files table yet. The first one loads the entries.
function openIndex(index) {
  if (!index || !fs.existsSync(index)) return null;
  let d = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    d = new DatabaseSync(index);
    d.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_files'").get()) { d.close(); return null; }
    if (!loaded.has(index)) {
      loaded.add(index);
      for (const r of d.prepare('SELECT file, state FROM usage_files').all()) {
        if (states.has(r.file)) continue;
        try { states.set(r.file, decodeEntry(r.state)); } catch { /* a broken row: the file is read again */ }
      }
    }
    return d;
  } catch (e) {
    console.error('local usage index:', e.message);
    try { d?.close(); } catch { /* not open */ }
    return null;
  }
}

// The files whose entry is not saved yet (a batch that failed is tried again at the next scan).
const unsaved = new Set();
const removed = new Set();
const BATCH = 50;
const BUSY_RETRIES = 3;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The index release (src/local-usage.js releaseUsageIndex): [GEN] grows when the service closes the
// index, [BUSY] says that this worker holds a connection to it.
const GEN = 0;
const BUSY = 1;
const { control } = workerData || {};
const released = (gen) => !!control && Atomics.load(control, GEN) !== gen;

// fn(d) with a connection to the index, unless the service released it since the message was sent.
function withIndex(index, gen, fn) {
  if (control) Atomics.store(control, BUSY, 1);
  try {
    if (released(gen)) return;
    const d = openIndex(index);
    if (!d) return;
    try { fn(d); } finally {
      try { d.close(); } catch { /* already closed */ }
    }
  } finally {
    if (control) { Atomics.store(control, BUSY, 0); Atomics.notify(control, BUSY); }
  }
}

// Saves the unsaved entries in small transactions, pausing between them, so the service's own writes
// to the index (the run listing, the background rebuild) never wait long for this worker. A busy
// index is tried again a few times; a batch that still fails stays unsaved, like the batches left
// when the service releases the index meanwhile.
function save(d, gen) {
  const put = d.prepare(`INSERT INTO usage_files (file, key, state) VALUES (?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET key = excluded.key, state = excluded.state`);
  const del = d.prepare('DELETE FROM usage_files WHERE file = ?');
  const work = [...[...removed].map((f) => ['del', f]), ...[...unsaved].map((f) => ['put', f])];
  for (let i = 0; i < work.length; i += BATCH) {
    if (i) pause(20);
    if (released(gen)) return;
    const batch = work.slice(i, i + BATCH);
    for (let attempt = 1; ; attempt++) {
      try {
        d.exec('BEGIN IMMEDIATE');
      } catch (e) {
        if (attempt < BUSY_RETRIES && /busy|locked/i.test(e.message)) { pause(200); continue; }
        throw e;
      }
      try {
        for (const [op, f] of batch) {
          const e = states.get(f);
          if (op === 'del') del.run(f);
          else if (e?.key) put.run(f, e.key, encodeEntry(e));
        }
        d.exec('COMMIT');
        break;
      } catch (e) {
        try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    }
    for (const [op, f] of batch) (op === 'del' ? removed : unsaved).delete(f);
  }
}

// One incremental scan of `home`'s transcripts; `persist()` then saves its entries in the index.
function scan(home, index, gen) {
  withIndex(index, gen, () => {}); // the first scan loads the saved entries, so it reads only what changed since
  const { changed, gone, ...out } = scanLocalUsage({ home, states });
  for (const f of changed) { unsaved.add(f); removed.delete(f); }
  for (const f of gone) { removed.add(f); unsaved.delete(f); }
  const persist = () => {
    if (!unsaved.size && !removed.size) return;
    withIndex(index, gen, (d) => {
      try { save(d, gen); } catch (e) { console.error('local usage index:', e.message); }
    });
  };
  return { out, persist };
}

parentPort.on('message', ({ id, op, home, index, opts, gen }) => {
  let persist = null;
  try {
    let local = null;
    if (op !== 'usage' || opts.scope === 'machine') ({ out: local, persist } = scan(home, index, gen));
    // 'usage': src/usage.js computeUsage here (only the totals go back)
    const result = op === 'usage' ? require('./usage').computeUsage({ ...opts, local }) : local;
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
  // after the answer: the caller does not wait for the index
  persist?.();
});
