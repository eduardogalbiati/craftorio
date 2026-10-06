// A run's artifacts, indexed (#200): the files it produced (`file.saved` / `handoff.saved` events,
// possibly outside the run folder, e.g. docs/arena in the project, plus any other file of the run
// folder except its own logs), without parsing its whole events.jsonl at every listing.
//
// Everything here is asynchronous (fs.promises), so a listing never blocks the main process:
// - a finished run (summary.json) is computed once and kept while its events.jsonl and its folder
//   keep their size + mtime;
// - a live run reads only the bytes of events.jsonl appended since the last read (the saved files
//   found so far and the offset are kept), then walks and stats its folder again;
// - the cache lives in the service's index (src/store.js, table run_artifacts, which also records
//   each project copy's path → run for artifactRunIds), or in memory without one (scripts, tests).
// Each entry carries its category (src/artifact-categories.js, #225); internal files (owner.json,
// locks) are not listed, and the run's result.md comes first.
// runsOfArtifact finds the runs a path can belong to (its run folder, or the runs that recorded it as
// a project copy) so opening one artifact checks one run's list, not every run's.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { categoryOf } = require('./artifact-categories');
const { storeFor } = require('./store');

const INTERNAL = new Set(['events.jsonl', 'meta.json', 'summary.json']);
// top-level folders that are not the run's output: its sessions, and the scratch workspace of its
// agents' checks (#120, #201; a file an agent saved there on purpose is listed from its file.saved)
const SKIPPED_DIRS = new Set(['scratch', 'sessions']);
const KINDS = { '.md': 'markdown', '.markdown': 'markdown', '.json': 'json', '.jsonl': 'json', '.tsv': 'table', '.csv': 'table', '.txt': 'text', '.log': 'text', '.yaml': 'text', '.yml': 'text', '.html': 'text', '.patch': 'text', '.diff': 'text', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image' };
const kindOf = (file) => KINDS[path.extname(file).toLowerCase()] || 'other';
const normPath = (p) => {
  const r = path.resolve(String(p));
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const SAVED_TYPES = new Set(['file.saved', 'handoff.saved']);
const READ_CHUNK = 1024 * 1024;
// bumped when an entry's fields change: an index row of an older version is computed again
const CACHE_VERSION = 'v2';
const STAT_BATCH = 64;

/** The files of a run folder (relative paths), without sessions/, scratch/ and the run's own logs (sync). */
function walkFiles(dir, rel = '') {
  let entries = [];
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) return rel === '' && SKIPPED_DIRS.has(e.name) ? [] : walkFiles(dir, r);
    return rel === '' && INTERNAL.has(e.name) ? [] : [r];
  });
}

async function walkFilesAsync(dir, rel = '') {
  let entries = [];
  try { entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) { if (!(rel === '' && SKIPPED_DIRS.has(e.name))) out.push(...await walkFilesAsync(dir, r)); }
    else if (!(rel === '' && INTERNAL.has(e.name))) out.push(r);
  }
  return out;
}

const statOrNull = (file) => fsp.stat(file).catch(() => null);

// One artifact entry: { path, name, rel, location, kind, category, size, mtime, step, agent, exists }
// (event: the event that saved it, 'file.saved' or 'handoff.saved', for its category)
function artifactEntry(runDir, file, st, step, agent, event = null) {
  const inside = normPath(file).startsWith(normPath(runDir) + path.sep);
  const rel = inside ? path.relative(runDir, file) : file;
  return {
    path: file,
    name: path.basename(file),
    rel,
    location: inside ? 'run' : 'external',
    kind: kindOf(file),
    category: categoryOf(inside ? rel : path.basename(file), event),
    size: st ? st.size : null,
    mtime: st ? st.mtime.toISOString() : null,
    exists: !!st,
    step: step || null,
    agent: agent || null,
  };
}

// The listing order: the run's result.md first, then by path; internal files left out
function listed(files) {
  const first = (f) => (f.category === 'result' ? 0 : 1);
  return files.filter((f) => f.category !== 'internal').sort((a, b) => first(a) - first(b) || a.rel.localeCompare(b.rel));
}

// The saved files recorded in events.jsonl from byte `offset` to `size`: [{ path, step, agent }] and
// the offset after the last complete line (a line being written is read next time). Only the lines
// that mention a save are parsed: the streamed CLI output, most of the file, is skipped.
async function readSaved(file, offset, size) {
  const saved = [];
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return { saved, offset }; }
  let pos = offset;
  let carry = Buffer.alloc(0);
  let next = offset;
  try {
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(READ_CHUNK, size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let start = 0;
      for (let nl = data.indexOf(10); nl !== -1; nl = data.indexOf(10, start)) {
        const line = data.subarray(start, nl);
        if (line.includes('.saved"')) {
          try {
            const ev = JSON.parse(line.toString('utf8'));
            if (SAVED_TYPES.has(ev.type) && ev.path) saved.push({ path: ev.path, step: ev.step_id || null, agent: ev.agent || null, event: ev.type });
          } catch { /* a broken line */ }
        }
        start = nl + 1;
      }
      next = pos - (data.length - start);
      carry = Buffer.from(data.subarray(start));
      data = null;
    }
  } finally {
    await fh.close().catch(() => {});
  }
  return { saved, offset: next };
}

// ---- the cache: the index's run_artifacts table, or memory -------------------------------------
const memory = new Map(); // normPath(runDir) → entry (no index open)
function cacheOf(runDir) {
  const store = storeFor(path.dirname(runDir));
  const runId = path.basename(runDir);
  if (store?.runArtifacts) {
    return { get: () => store.runArtifacts(runId), put: (e) => store.putRunArtifacts(runId, e) };
  }
  return { get: () => memory.get(normPath(runDir)) || null, put: (e) => memory.set(normPath(runDir), e) };
}

const inflight = new Map(); // normPath(runDir) → Promise<entry>

/**
 * A run's artifact index: { files: [artifact entries, sorted by rel], count, images }. Cached; a
 * finished run unchanged since it was computed is not read again, a live run only from where its
 * events.jsonl was read last.
 */
function artifactIndex(runDir) {
  const key = normPath(runDir);
  if (inflight.has(key)) return inflight.get(key);
  const p = computeIndex(runDir).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function computeIndex(runDir) {
  const eventsFile = path.join(runDir, 'events.jsonl');
  const [root, ev, summary] = await Promise.all([statOrNull(runDir), statOrNull(eventsFile), statOrNull(path.join(runDir, 'summary.json'))]);
  if (!root) return { files: [], count: 0, images: 0 };
  const quick = `${CACHE_VERSION}|${ev ? `${ev.size}:${ev.mtimeMs}` : '-'}|${root.mtimeMs}`;
  const cache = cacheOf(runDir);
  let cached = null;
  try { cached = cache.get(); } catch { /* a broken row: computed again */ }
  if (cached && !String(cached.quick || '').startsWith(`${CACHE_VERSION}|`)) cached = null;
  if (cached && cached.finished && summary && cached.quick === quick) return cached;

  // the events: only the bytes appended since the last read (from 0 when the file shrank or is new)
  let offset = cached?.offset || 0;
  let saved = cached?.saved || [];
  if (!ev || ev.size < offset) { offset = 0; saved = []; }
  if (ev && ev.size > offset) {
    const more = await readSaved(eventsFile, offset, ev.size);
    saved = saved.concat(more.saved);
    offset = more.offset;
  }

  // the saved files first (a later save of the same path wins its step and agent), then the folder's
  const wanted = new Map();
  for (const s of saved) wanted.set(normPath(s.path), s);
  for (const rel of await walkFilesAsync(runDir)) {
    const file = path.join(runDir, rel);
    if (!wanted.has(normPath(file))) wanted.set(normPath(file), { path: file, step: null, agent: null });
  }
  const todo = [...wanted.values()];
  const files = [];
  for (let i = 0; i < todo.length; i += STAT_BATCH) {
    const part = todo.slice(i, i + STAT_BATCH);
    const stats = await Promise.all(part.map((s) => statOrNull(s.path)));
    part.forEach((s, n) => files.push(artifactEntry(runDir, s.path, stats[n], s.step, s.agent, s.event)));
  }
  const shown = listed(files);
  const entry = { quick, finished: !!summary, offset, saved, files: shown, count: shown.length, images: shown.filter((f) => f.kind === 'image').length };
  try { cache.put(entry); } catch (e) { console.error('artifact index:', e.message); }
  return entry;
}

/** The artifacts of one run (artifact entries), from the index. */
async function runArtifactsAsync(runDir) {
  return (await artifactIndex(runDir)).files;
}

/**
 * The run ids a file can be an artifact of: the run whose folder holds it, else the runs that
 * recorded it as a project copy (from the cached indexes; the runs not indexed yet are indexed first).
 */
async function runsOfArtifact(runsDir, file) {
  const target = normPath(file);
  const base = normPath(runsDir) + path.sep;
  if (target.startsWith(base)) return [target.slice(base.length).split(path.sep)[0]].filter(Boolean);
  const known = () => {
    const store = storeFor(runsDir);
    if (store?.artifactRunIds) return store.artifactRunIds(target);
    const ids = [];
    for (const [dir, e] of memory) {
      if (dir.startsWith(base) && e.files.some((f) => f.location === 'external' && normPath(f.path) === target)) ids.push(path.basename(dir));
    }
    return ids;
  };
  let ids = known();
  if (ids.length) return ids;
  // runs never indexed yet (a new index.db, a run that just saved it)
  let names = [];
  try { names = await fsp.readdir(runsDir); } catch { return []; }
  for (const id of names) await artifactIndex(path.join(runsDir, id));
  ids = known();
  return ids;
}

module.exports = {
  artifactEntry,
  artifactIndex,
  INTERNAL,
  kindOf,
  listed,
  normPath,
  runArtifactsAsync,
  runsOfArtifact,
  walkFiles,
};
