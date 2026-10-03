// Runs recorded in <workspace>/runs, for the project view: which workflows ran in a project,
// their status and their agent sessions (to reopen them in a terminal).
//
// A finished run has summary.json; a run that is still going, or that died with the app, only
// has events.jsonl, so its data is rebuilt from the events (status "interrupted" unless it is
// the run in progress in this window).
//
// Each run also has a display title and the PR it opened (#84, src/run-pr.js): the owner's title is
// in runs/<id>/meta.json, and a resumed run inherits both from the run it resumes.
//
// With the service's index open (src/store.js) listRuns reads unchanged runs from it (`indexRun`,
// `rebuildIndex`, `runSummaries` for Usage and Analytics); deleting index.db loses nothing.
// The run lists use listRunsAsync (#200: async stats, never blocking the process) and findRun (one run).

const fs = require('fs');
const path = require('path');
const { trailOf } = require('./renderer/run-progress-model');
const { defaultTitle, prOfEvents, readMeta } = require('./run-pr');
const { ownerAlive, readOwner } = require('./run-owner');
const { storeFor } = require('./store');
const { kindOf, walkFiles } = require('./run-artifacts');

const SESSION_EVENTS = new Set(['session.opened', 'session.message_received', 'session.closed']);

// The saves of a run's document to its issue (written by backlog.saveRunToIssue), oldest first.
function readIssueSaves(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'issue-saves.json'), 'utf8')); } catch { return []; }
}

// A run's chain (#134): runs/<id>/chain.json, written by the service (src/service/areas/chain.js):
// { then, state: waiting | started | paused | dropped | done, reason, nextRunId, at }. Its `then` wins
// over the one recorded in the events (the owner edits the chain while the run goes and after it).
function readChain(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'chain.json'), 'utf8')) || null; } catch { return null; }
}
function writeChain(dir, patch) {
  const next = { ...(readChain(dir) || {}), ...patch, at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'chain.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// What the run lists show of a run's chain: { then, from, state, reason, nextRunId }, null without one.
function chainOf(dir, summary, started) {
  const file = readChain(dir) || {};
  const then = file.then !== undefined ? file.then : summary?.then || started?.then || null;
  const from = summary?.from || started?.from || null;
  if (!then && !from) return null;
  return { then, from, state: then ? file.state || 'waiting' : undefined, reason: file.reason || null, nextRunId: file.nextRunId || null };
}

// What a run without a (complete) summary.json needs from its events.jsonl: its sessions, its
// step trail (progress by group) and its local merge (runs recorded before summary.local_merge),
// cached by mtime+size so an unchanged file is read once.
const derived = new Map(); // events.jsonl path → { key, sessions, progress, localMerge, recovery, pr }
function fromEvents(file) {
  let st;
  try { st = fs.statSync(file); } catch { return { sessions: [], progress: [], localMerge: null, recovery: null, pr: null, childRuns: [] }; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = derived.get(file);
  if (hit?.key === key) return hit;
  const events = readEvents(file).filter((e) => e.type !== 'session.stream');
  const byId = new Map();
  for (const ev of events) {
    if (SESSION_EVENTS.has(ev.type) && ev.session) byId.set(ev.session_id, { ...ev.session, status: ev.type === 'session.closed' ? ev.status : ev.session.status });
    else if (ev.type === 'session.status' && byId.has(ev.session_id)) byId.get(ev.session_id).status = ev.status;
  }
  const merged = events.findLast((e) => e.type === 'worktree.merged');
  const localMerge = merged ? { branch: merged.branch, base: merged.base, commit: merged.commit } : null;
  // the supervisor's latest recovery from a failed merge/action ("went back to develop at 00:10 because ...")
  const recovery = events.findLast((e) => e.type === 'supervisor.decision' && e.kind === 'action_error')?.record || null;
  // the child runs its `type: workflow` steps started (#174), for a run without summary.child_runs yet
  const children = new Map();
  for (const ev of events) {
    if (ev.type === 'workflow.child_started') children.set(ev.child_run_id, { run_id: ev.child_run_id, step_id: ev.step_id, ...(ev.index !== undefined ? { index: ev.index } : {}), workflow: ev.workflow, status: 'running' });
    else if (ev.type === 'workflow.child_finished' && children.has(ev.child_run_id)) Object.assign(children.get(ev.child_run_id), { status: ev.status, ...(ev.cost_usd !== undefined ? { cost_usd: ev.cost_usd } : {}) });
  }
  // the PR the run opened (#84): the latest step output with pr_url / pr_number
  const out = { key, sessions: [...byId.values()], progress: trailOf(events), localMerge, recovery, pr: prOfEvents(events), childRuns: [...children.values()] };
  derived.set(file, out);
  return out;
}

// A resumed run without a PR or a title of its own shows those of the run it resumes (the chain,
// followed through workflow.started's resumed_from).
function fromChain(runsDir, runId, pick, depth = 0) {
  if (!runId || depth > 20) return null;
  const dir = path.join(runsDir, path.basename(String(runId)));
  const own = pick(dir);
  if (own) return own;
  return fromChain(runsDir, firstEvent(path.join(dir, 'events.jsonl'))?.resumed_from?.run_id, pick, depth + 1);
}
const chainPr = (dir) => fromEvents(path.join(dir, 'events.jsonl')).pr;
const chainTitle = (dir) => readMeta(dir).title || null;

/** { title, customTitle } of a run (also one in progress): the owner's title, else the default. */
// inputs: the run's inputs, when the task is not known yet
function runTitle(runsDir, runId, { issues, task, inputs } = {}) {
  const customTitle = fromChain(runsDir, runId, chainTitle);
  return { title: customTitle || defaultTitle({ issues, task: task ?? firstText(inputs) }), customTitle };
}

/** The PR a finished run (or the run it resumes) opened: { number, url } or null. */
const runPr = (runsDir, runId) => fromChain(runsDir, runId, chainPr);

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

// The issues recorded in workflow.started / summary.json: `issues`, or the single `issue` of runs
// recorded before a run could implement several; null when there are none.
function issuesOf(rec) {
  if (Array.isArray(rec?.issues) && rec.issues.length) return rec.issues;
  return rec?.issue ? [rec.issue] : null;
}

// A run without summary.json (#112): "running" while its owner (runs/<id>/owner.json, src/run-owner.js)
// is alive, in this process or another one; "interrupted" only once the owner is gone.
function liveStatus(dir) {
  const owner = readOwner(dir);
  if (!ownerAlive(owner)) return { status: 'interrupted', elsewhere: null };
  return { status: 'running', elsewhere: owner.pid === process.pid ? null : { pid: owner.pid, host: owner.host } };
}

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
  let progress;
  if (summary) {
    sessions = summary.sessions || [];
    status = summary.status;
    finishedAt = summary.finished_at;
    // runs recorded before summary.progress existed
    progress = summary.progress || fromEvents(path.join(dir, 'events.jsonl')).progress;
  } else {
    ({ sessions, progress } = fromEvents(path.join(dir, 'events.jsonl')));
    status = liveStatus(dir).status;
  }
  if (summary && summary.status !== 'success') {
    const last = readEvents(path.join(dir, 'events.jsonl')).reverse().find((e) => e.type === 'workflow.finished');
    error = last?.error || null;
  }
  // what a `merge: local` put on the local base (summaries before local_merge: from the events)
  const localMerge = summary && summary.local_merge !== undefined ? summary.local_merge
    : summary?.status === 'success' && summary.worktree?.repo ? fromEvents(path.join(dir, 'events.jsonl')).localMerge : null;
  const inputs = summary?.inputs || started?.inputs || {};
  const startedAt = summary?.started_at || started?.ts || null;
  const issues = issuesOf(summary) || issuesOf(started);
  const task = firstText(inputs);
  const resumedFrom = started?.resumed_from?.run_id || null;
  const childRuns = summary ? summary.child_runs : fromEvents(path.join(dir, 'events.jsonl')).childRuns;
  const { title, customTitle } = runTitle(runsDir, runId, { issues, task });
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
    // of durationMs, the time spent waiting for the owner at human gates (not agent time)
    gateWaitMs: summary?.timing?.gate_wait_ms || 0,
    costUsd: sessions.reduce((a, s) => a + (s.cost_usd || 0), 0),
    tokens: sumTokens(sessions),
    projectId: summary?.project_id || started?.project_id || null,
    // the issues the run implements (Backlog); runs recorded before groups have one `issue`
    issues,
    task,
    // what the lists show instead of the workflow name (#84): the owner's title (meta.json, or the
    // resumed run's), else the issue or the task's first line; customTitle: null when none is set
    title,
    customTitle,
    resumedFrom,
    // { number, url } of the PR the run (or the run it resumes) opened; the state is added by the service
    pr: runPr(runsDir, runId),
    localMerge,
    // where the owner saved the run's document to its issue ([{ number, url, mode, at, platform, commentUrl? }], #103)
    issueSaves: readIssueSaves(dir),
    // what happens with its result when it finishes, and the run whose chain started it (#134)
    chain: chainOf(dir, summary, started),
    // the declared outputs it finished with (#134), null before it finished or without a contract
    outputs: summary?.outputs || null,
    // #203: [{ input, label, value, value_label, source: 'workflow default' | 'chosen for this run' }]
    // of the development workflows' unit_tests / e2e_tests (null: a workflow without them)
    testsPlan: summary?.tests_plan || started?.tests_plan || null,
    // `type: workflow` steps (#174): { run_id, workflow, step_id, index?, depth } of the run that started
    // this one, and [{ run_id, step_id, index?, workflow, status, cost_usd }] of the runs this one started (null: none)
    parentRun: summary?.parent_run || started?.parent_run || null,
    childRuns: childRuns?.length ? childRuns : null,
    // what those child runs cost (#175, their own children included; not in costUsd), 0 without any
    childrenCostUsd: summary?.children_cost_usd ?? (childRuns || []).reduce((a, c) => a + (+c.cost_usd || 0), 0),
    recovery: fromEvents(path.join(dir, 'events.jsonl')).recovery,
    error,
    // a run without an end that another live app process runs (#112): { pid, host }, else null
    runningElsewhere: summary ? null : liveStatus(dir).elsewhere,
    inputs,
    runDir: dir,
    sessions,
    // null: recorded before groups existed (the workflow file may have them now)
    groups: summary?.groups || started?.groups || null,
    // agents from the Agents menu: key → their own name (workflow.started)
    agentNames: started?.agent_names || null,
    progress,
  };
}

// ---- the run index (src/store.js, #76) ---------------------------------------------------------
// With the service's index open, a listing reads each run from its row and only stats its files:
// a run whose files changed since it was indexed (signature below), or that has no row, is read
// again and its row replaced; rows of deleted folders go. The files stay the source of truth.
const SIG_FILES = ['events.jsonl', 'summary.json', 'meta.json', 'issue-saves.json', 'chain.json'];
function runSignature(dir) {
  return SIG_FILES.map((f) => {
    try { const st = fs.statSync(path.join(dir, f)); return `${st.mtimeMs}:${st.size}`; } catch { return '-'; }
  }).join('|');
}

const readSummaryText = (dir) => { try { return fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'); } catch { return null; } };

// Reads one run folder into the index; returns its RunInfo (null when it is not a run).
const readAt = new Map(); // run id → when indexRunIn last read it
function indexRunIn(store, runsDir, runId) {
  const dir = path.join(runsDir, runId);
  const sig = runSignature(dir);
  const info = readRun(runsDir, runId);
  if (info) store.putRun(info, sig, readSummaryText(dir));
  readAt.set(runId, Date.now());
  return info;
}

// A run without an end keeps aging while its files stay the same, and its owner's heartbeat
// decides between running (elsewhere) and interrupted (#112).
function listedRow(runsDir, id, info) {
  if (info.finishedAt || !info.startedAt || !['interrupted', 'running'].includes(info.status)) return info;
  const live = liveStatus(path.join(runsDir, id));
  return { ...info, status: live.status, runningElsewhere: live.elsewhere, durationMs: Date.now() - Date.parse(info.startedAt) };
}

// A run this process runs (`live`) whose events.jsonl alone changed keeps its row for LIVE_REREAD_MS
// (#200): reading it again parses its whole events.jsonl, and the service lays the engine's live
// state (status, steps, sessions, cost) over the row anyway; workflow.finished indexes it again.
const LIVE_REREAD_MS = 20000;
const onlyEventsChanged = (a, b) => String(a).split('|').slice(1).join('|') === String(b).split('|').slice(1).join('|');

// The row of a run when it is current (or a live run's recent one), else null: the run is read again.
function currentRow(runsDir, id, row, sig, live) {
  if (!row?.info) return null;
  if (row.sig === sig) return listedRow(runsDir, id, row.info);
  if (live?.has(id) && onlyEventsChanged(row.sig, sig) && Date.now() - (readAt.get(id) || 0) < LIVE_REREAD_MS) return listedRow(runsDir, id, row.info);
  return null;
}

const statSignature = async (dir) => (await Promise.all(SIG_FILES.map((f) => fs.promises.stat(path.join(dir, f))
  .then((st) => `${st.mtimeMs}:${st.size}`, () => '-')))).join('|');
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * listRuns without blocking the process (#200), newest first: the folders' signatures are read with
 * async stats, and a run read again (changed, or not indexed yet) lets other work in after it.
 * `live`: ids of the runs this process runs (see LIVE_REREAD_MS).
 */
async function listRunsAsync(runsDir, { live } = {}) {
  let ids = [];
  try { ids = await fs.promises.readdir(runsDir); } catch { return []; }
  const sigs = [];
  for (let i = 0; i < ids.length; i += 64) sigs.push(...await Promise.all(ids.slice(i, i + 64).map((id) => statSignature(path.join(runsDir, id)))));
  const store = storeFor(runsDir);
  const rows = store ? store.runEntries() : new Map();
  const list = [];
  for (let i = 0; i < ids.length; i++) {
    const row = currentRow(runsDir, ids[i], rows.get(ids[i]), sigs[i], live);
    if (row) { list.push(row); continue; }
    const s = storeFor(runsDir); // the workspace may have changed meanwhile
    list.push(s ? indexRunIn(s, runsDir, ids[i]) : readRun(runsDir, ids[i]));
    await nextTick();
  }
  if (store && storeFor(runsDir) === store) {
    const present = new Set(ids);
    const gone = [...rows.keys()].filter((id) => !present.has(id));
    if (gone.length) store.deleteRuns(gone);
  }
  return list.filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** One run as the lists show it (its index row when current, else read from its folder), null: not a run. */
function findRun(runsDir, runId, { live } = {}) {
  const id = path.basename(String(runId || ''));
  if (!id || id === '.' || id === '..') return null;
  const store = storeFor(runsDir);
  const row = currentRow(runsDir, id, store?.runEntry(id), runSignature(path.join(runsDir, id)), live);
  if (row) return row;
  return store ? indexRunIn(store, runsDir, id) : readRun(runsDir, id);
}

/** Re-reads one run into the index (the service calls it as the run's events are written). */
function indexRun(runsDir, runId) {
  const store = storeFor(runsDir);
  return store ? indexRunIn(store, runsDir, path.basename(String(runId))) : readRun(runsDir, runId);
}

/** Empties the runs cache and rebuilds it from runs/ (Settings › Rebuild index); returns the count. */
function rebuildIndex(runsDir) {
  const store = storeFor(runsDir);
  if (!store) return 0;
  store.clearRuns();
  return listRuns(runsDir).length;
}

function listRuns(runsDir) {
  let ids = [];
  try { ids = fs.readdirSync(runsDir); } catch { return []; }
  const store = storeFor(runsDir);
  let list;
  if (!store) list = ids.map((id) => readRun(runsDir, id));
  else {
    const rows = store.runEntries();
    list = store.transaction(() => ids.map((id) => {
      const row = rows.get(id);
      if (!row?.info || row.sig !== runSignature(path.join(runsDir, id))) return indexRunIn(store, runsDir, id);
      return listedRow(runsDir, id, row.info);
    }));
    const present = new Set(ids);
    const gone = [...rows.keys()].filter((id) => !present.has(id));
    if (gone.length) store.deleteRuns(gone);
  }
  return list.filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** summary.json of every finished run (`mock: false`: real runs only), from the index when it is open. */
function runSummaries(runsDir, { mock } = {}) {
  const store = storeFor(runsDir);
  if (!store) return null;
  listRuns(runsDir); // brings the index up to date (stats only for unchanged runs)
  return store.runSummaries({ mock });
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

/** The project a run belongs to (same rules as runsForProject), or null. */
function projectOf(run, projectList) {
  return run.projectId ? projectList.find((p) => p.id === run.projectId) || null
    : projectList.find((p) => runsForProject([run], p).length) || null;
}

// ---------------------------------------------------------------------------
// Artifacts: files a run produced. Those written by the engine (`save_as`, `file.saved`
// events, possibly outside the run folder, e.g. docs/arena in the project) plus any other file
// in the run folder, except the run's own logs. The lists and the Artifacts screen read them from
// the cached, asynchronous index of src/run-artifacts.js (#200); runArtifacts reads one run at once.
// ---------------------------------------------------------------------------

/** Files produced by a run, read now (sync): [{ path, name, rel, location, kind, size, mtime, step, agent, exists }] */
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
    if ((ev.type === 'file.saved' || ev.type === 'handoff.saved') && ev.path) add(ev.path, { step: ev.step_id || null, agent: ev.agent || null });
  }
  for (const rel of walkFiles(runDir)) {
    const file = path.join(runDir, rel);
    if (!byPath.has(normPath(file))) add(file, { step: null, agent: null });
  }
  return [...byPath.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

// A run's events without the streamed CLI output (session.stream), which is most of the file:
// enough to replay the run (e.g. the Write & Review chat of a past run).
// `activity: true` (the run chat) keeps what the agents did, compacted: thinking merged into one
// event per turn and truncated, tool calls with a short input, failed tool results as a flag.
// Streamed answer text, stderr, raw CLI events and usage are still dropped (the answer arrives
// whole in session.message_received).
const ACTIVITY_TEXT = 4000;
const ACTIVITY_INPUT = 600;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
function runEvents(runDir, { activity = false } = {}) {
  const events = readEvents(path.join(runDir, 'events.jsonl'));
  if (!activity) return events.filter((e) => e.type !== 'session.stream');
  const out = [];
  let thinking = null; // the thinking event being merged, while the same turn keeps thinking
  for (const e of events) {
    if (e.type !== 'session.stream') { out.push(e); continue; }
    const item = e.item || {};
    const same = thinking && thinking.session_id === e.session_id && thinking.turn === e.turn;
    if (item.kind === 'thinking' && item.text) {
      if (same && thinking === out.at(-1)) { thinking.item.text = cut(thinking.item.text + item.text, ACTIVITY_TEXT); continue; }
      thinking = { ...e, item: { kind: 'thinking', text: cut(String(item.text), ACTIVITY_TEXT) } };
      out.push(thinking);
    } else if (item.kind === 'tool_call' && ['Agent', 'Task'].includes(item.name) && item.input && typeof item.input === 'object') {
      // a sub-agent call keeps its type and description (the run chat shows them), not its long prompt
      const { subagent_type, description } = item.input;
      out.push({ ...e, item: { kind: 'tool_call', name: item.name, input: { subagent_type, description: cut(String(description || ''), ACTIVITY_INPUT) } } });
    } else if (item.kind === 'tool_call') {
      const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? '');
      out.push({ ...e, item: { kind: 'tool_call', name: item.name, input: cut(input, ACTIVITY_INPUT) } });
    } else if (item.kind === 'tool_result' && item.is_error) {
      out.push({ ...e, item: { kind: 'tool_result', is_error: true } });
    }
  }
  return out;
}

module.exports = {
  findRun,
  indexRun,
  kindOf,
  listRuns,
  listRunsAsync,
  projectOf,
  readChain,
  readRun,
  rebuildIndex,
  runArtifacts,
  runEvents,
  runPr,
  runsForProject,
  runSummaries,
  runTitle,
  writeChain,
};
