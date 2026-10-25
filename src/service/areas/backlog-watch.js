// Service area: the workspace's backlog/ folder watched for changes (#204). The Backlog screen
// follows its files live (Roadmap, Kanban, List, Epics), also when nothing runs: a write by the app
// (writeRoadmap, the queue snapshot, a sync) or from outside (another window, the Oracle, a script,
// temp file + rename) pushes `backlog:changed { projectId, file, watching: true }` once per file,
// debounced (DEBOUNCE_MS). `file` is the kind: roadmap | queue | issues (<id>.json) | local | refresh.
// A write that leaves the file as it was (same mtime and size) pushes nothing.
// One watcher per workspace: started by setWorkspace, closed on a workspace switch and on shutdown.
// A watcher that cannot start or fails (folder deleted, network drive, EPERM on Windows) pushes
// `backlog:changed { projectId: null, file: null, watching: false }`: the screen falls back to a 5 s
// poll while it is visible (`backlogWatching()` tells a window that loads later).

const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 300;
// <project id>[.<kind>].json; .bak and .tmp files (src/domains/workspace/state-file.js) are not the data
const KINDS = ['local', 'queue', 'refresh', 'roadmap'];

// 'proj.roadmap.json' → { projectId: 'proj', file: 'roadmap' }; 'proj.json' → { projectId: 'proj', file: 'issues' }
function parseBacklogFile(name) {
  const m = /^(.+)\.json$/.exec(String(name || ''));
  if (!m) return null;
  const kind = KINDS.find((k) => m[1].endsWith(`.${k}`));
  const projectId = kind ? m[1].slice(0, -(kind.length + 1)) : m[1];
  return projectId ? { projectId, file: kind || 'issues' } : null;
}

// Watches dir and calls onChange({ projectId, file }) per changed file (debounced), onError(e) once
// when the watcher fails. Returns { close, watching }. fsWatch is replaceable (tests).
function watchBacklogDir(dir, { onChange, onError = () => {}, debounceMs = DEBOUNCE_MS, fsWatch = fs.watch } = {}) {
  const timers = new Map();
  const seen = new Map(); // file name -> 'mtime:size' last pushed
  let watcher = null;
  let closed = false;
  const stamp = (name) => {
    try { const s = fs.statSync(path.join(dir, name)); return `${s.mtimeMs}:${s.size}`; } catch { return 'gone'; }
  };
  const fire = (name) => {
    timers.delete(name);
    if (closed) return;
    const parsed = parseBacklogFile(name);
    const now = stamp(name);
    if (!parsed || seen.get(name) === now) return;
    seen.set(name, now);
    onChange(parsed);
  };
  const fail = (e) => {
    if (closed) return;
    close();
    onError(e);
  };
  function close() {
    closed = true;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    try { watcher?.close(); } catch { /* already closed */ }
    watcher = null;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (parseBacklogFile(f)) seen.set(f, stamp(f));
    watcher = fsWatch(dir, { persistent: false }, (_type, name) => {
      if (closed || !name) return;
      const file = path.basename(String(name));
      if (!parseBacklogFile(file)) return;
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => fire(file), debounceMs));
    });
    watcher.on?.('error', fail);
  } catch (e) {
    fail(e);
  }
  return { close, get watching() { return !closed; } };
}

module.exports = (ctx) => {
  let current = null; // { dir, handle }

  function stopBacklogWatch() {
    current?.handle.close();
    current = null;
  }

  // (Re)starts the watcher on the open workspace's backlog/ folder (setWorkspace calls it).
  function watchBacklog() {
    stopBacklogWatch();
    const dir = ctx.ws?.backlog;
    if (!dir) return;
    const handle = watchBacklogDir(dir, {
      onChange: ({ projectId, file }) => ctx.events.emit('backlog:changed', { projectId, file, watching: true }),
      onError: (e) => {
        console.error('backlog watch:', e.message);
        ctx.events.emit('backlog:changed', { projectId: null, file: null, watching: false, error: e.message });
      },
    });
    current = { dir, handle };
  }

  return {
    backlogWatching: () => !!current?.handle.watching,
    stopBacklogWatch,
    watchBacklog,
  };
};
// the pure parts, for tests
module.exports.parseBacklogFile = parseBacklogFile;
module.exports.watchBacklogDir = watchBacklogDir;
