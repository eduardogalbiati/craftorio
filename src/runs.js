// Runs recorded in <workspace>/runs, for the project view: which workflows ran in a project,
// their status and their agent sessions (to reopen them in a terminal).
//
// A finished run has summary.json; a run that is still going, or that died with the app, only
// has events.jsonl, so its data is rebuilt from the events (status "interrupted" unless it is
// the run in progress in this window).

const fs = require('fs');
const path = require('path');

const SESSION_EVENTS = new Set(['session.opened', 'session.message_received', 'session.closed']);

function readEvents(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// The first line of events.jsonl (workflow.started) without reading a large file.
function firstEvent(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return JSON.parse(buf.toString('utf8', 0, n).split('\n')[0]);
  } catch { return null; }
}

const TOKEN_KEYS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];
function sumTokens(sessions) {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
  for (const s of sessions) for (const k of TOKEN_KEYS) t[k] += s.tokens?.[k] || 0;
  return { ...t, total: t.input + t.output + t.cache_read + t.cache_write };
}

const firstText = (inputs) => {
  const v = inputs?.task ?? Object.values(inputs || {}).find((x) => typeof x === 'string' && x.length > 20 && !/[\\/]/.test(x.slice(0, 3)));
  return typeof v === 'string' ? v : null;
};

/** One run folder → RunInfo base (sessions as engine snapshots), or null if it is not a run. */
function readRun(runsDir, runId) {
  const dir = path.join(runsDir, runId);
  const started = firstEvent(path.join(dir, 'events.jsonl'));
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* not finished */ }
  if (!summary && started?.type !== 'workflow.started') return null;

  let sessions;
  let status;
  let finishedAt = null;
  let error = null;
  if (summary) {
    sessions = summary.sessions || [];
    status = summary.status;
    finishedAt = summary.finished_at;
  } else {
    const byId = new Map();
    for (const ev of readEvents(path.join(dir, 'events.jsonl'))) {
      if (SESSION_EVENTS.has(ev.type) && ev.session) byId.set(ev.session_id, { ...ev.session, status: ev.type === 'session.closed' ? ev.status : ev.session.status });
      else if (ev.type === 'session.status' && byId.has(ev.session_id)) byId.get(ev.session_id).status = ev.status;
    }
    sessions = [...byId.values()];
    status = 'interrupted';
  }
  if (summary && summary.status !== 'success') {
    const last = readEvents(path.join(dir, 'events.jsonl')).reverse().find((e) => e.type === 'workflow.finished');
    error = last?.error || null;
  }
  const inputs = summary?.inputs || started?.inputs || {};
  const startedAt = summary?.started_at || started?.ts || null;
  return {
    runId,
    workflow: summary?.workflow || started?.workflow || null,
    version: started?.version || null,
    file: started?.file || null,
    status,
    mock: !!(summary?.mock ?? started?.mock),
    startedAt,
    finishedAt,
    durationMs: summary?.duration_ms ?? (startedAt ? Date.now() - Date.parse(startedAt) : 0),
    costUsd: sessions.reduce((a, s) => a + (s.cost_usd || 0), 0),
    tokens: sumTokens(sessions),
    projectId: summary?.project_id || started?.project_id || null,
    task: firstText(inputs),
    error,
    inputs,
    runDir: dir,
    sessions,
  };
}

function listRuns(runsDir) {
  let ids = [];
  try { ids = fs.readdirSync(runsDir); } catch { return []; }
  return ids.map((id) => readRun(runsDir, id)).filter(Boolean)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

const normPath = (p) => {
  const r = path.resolve(String(p));
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/**
 * Runs of a project: recorded with its id, or (older runs) whose folder inputs (repo_path,
 * project_path…) point at the project's folder or at a folder it used before.
 */
function runsForProject(runs, project) {
  const folders = new Set([project.folder, ...(project.previousFolders || [])].filter(Boolean).map(normPath));
  return runs.filter((r) => (r.projectId ? r.projectId === project.id
    : Object.values(r.inputs || {}).some((v) => typeof v === 'string' && /[\\/]/.test(v) && folders.has(normPath(v)))));
}

// ---------------------------------------------------------------------------
// Artifacts: files a run produced. Those written by the engine (`save_as`, `file.saved`
// events, possibly outside the run folder, e.g. docs/arena in the project) plus any other file
// in the run folder, except the run's own logs.
// ---------------------------------------------------------------------------
const INTERNAL = new Set(['events.jsonl', 'summary.json']);
const KINDS = { '.md': 'markdown', '.markdown': 'markdown', '.json': 'json', '.jsonl': 'json', '.tsv': 'table', '.csv': 'table', '.txt': 'text', '.log': 'text', '.yaml': 'text', '.yml': 'text', '.html': 'text', '.patch': 'text', '.diff': 'text' };
const kindOf = (file) => KINDS[path.extname(file).toLowerCase()] || 'other';

function walkFiles(dir, rel = '') {
  let entries = [];
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) return rel === '' && e.name === 'sessions' ? [] : walkFiles(dir, r);
    return rel === '' && INTERNAL.has(e.name) ? [] : [r];
  });
}

/** Files produced by a run: [{ path, name, rel, location, kind, size, mtime, step, agent, exists }] */
function runArtifacts(runDir) {
  const byPath = new Map();
  const add = (file, extra = {}) => {
    const key = normPath(file);
    const cur = byPath.get(key) || {};
    let st = null;
    try { st = fs.statSync(file); } catch { /* deleted since */ }
    const inside = key.startsWith(normPath(runDir) + path.sep);
    byPath.set(key, {
      ...cur,
      path: file,
      name: path.basename(file),
      rel: inside ? path.relative(runDir, file) : file,
      location: inside ? 'run' : 'external',
      kind: kindOf(file),
      size: st ? st.size : null,
      mtime: st ? st.mtime.toISOString() : null,
      exists: !!st,
      ...extra,
    });
  };
  for (const ev of readEvents(path.join(runDir, 'events.jsonl'))) {
    if (ev.type === 'file.saved' && ev.path) add(ev.path, { step: ev.step_id || null, agent: ev.agent || null });
  }
  for (const rel of walkFiles(runDir)) {
    const file = path.join(runDir, rel);
    if (!byPath.has(normPath(file))) add(file, { step: null, agent: null });
  }
  return [...byPath.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

module.exports = { readRun, listRuns, runsForProject, runArtifacts, kindOf };
