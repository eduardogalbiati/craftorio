// The worker thread of readLocalUsageAsync (src/local-usage.js, #389): runs the incremental scan of
// the CLIs' transcripts off the main process and keeps each file's entry between calls. Given the
// workspace's index.db, it loads the entries from its usage_files table once (the first scan after an
// app start reads only what changed since the last one) and saves the entries a scan changed, through
// a node:sqlite connection of its own opened for each scan (the service's handle keeps its own).
//
// It also computes the Usage screen's totals (src/usage.js computeUsage, op 'usage'), so the records
// of the machine scope never cross to the main process.
//
// Message in: { id, op: 'scan' | 'usage', home, index, opts }; out: { id, result } or { id, error }.

const fs = require('fs');
const { parentPort } = require('worker_threads');
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

function save(d, changed, gone) {
  if (!changed.length && !gone.length) return;
  const put = d.prepare(`INSERT INTO usage_files (file, key, state) VALUES (?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET key = excluded.key, state = excluded.state`);
  const del = d.prepare('DELETE FROM usage_files WHERE file = ?');
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const f of changed) { const e = states.get(f); if (e) put.run(f, e.key, encodeEntry(e)); }
    for (const f of gone) del.run(f);
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

// One incremental scan of `home`'s transcripts, its entries saved in the index.
function scan(home, index) {
  const d = openIndex(index);
  try {
    const { changed, gone, ...out } = scanLocalUsage({ home, states });
    if (d) {
      try { save(d, changed, gone); } catch (e) { console.error('local usage index:', e.message); }
    }
    return out;
  } finally {
    try { d?.close(); } catch { /* already closed */ }
  }
}

parentPort.on('message', ({ id, op, home, index, opts }) => {
  try {
    // 'usage': src/usage.js computeUsage here, with the scan when the scope needs it (only the totals go back)
    const result = op === 'usage'
      ? require('./usage').computeUsage({ ...opts, local: opts.scope === 'machine' ? scan(home, index) : null })
      : scan(home, index);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
