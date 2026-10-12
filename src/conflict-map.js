// The conflict map (#150): the files, and the single lines, that most runs of a project change. Parallel
// runs collide in these hub files (registries, shared lists, one import line with many names) even when
// their issues look unrelated; the Product Owner reads the map to keep apart what would collide and to
// propose fixes for the hot spots (`hotSpots` → its answer's `decongest`).
//   - files: per file, the distinct finished runs that changed it (newest first), the last of them and
//     the number of those runs whose merge conflicts named it (conflictsOf). A run's commits are its
//     commit range (src/repo-performance.js commitRanges: `worktree.ready`..`local_merge.commit`, a
//     resumed run walked back to the first run's base, the PR/MR merge commit for GitHub/GitLab runs);
//     simulated and unfinished runs are left out;
//   - lines: the lines (numbered at HEAD) that more than one run changed: each run's `git -U0` hunks,
//     carried to HEAD through `git diff <commit> HEAD`;
//   - no finished real run with commits (a new project): the last commits of the branch, one commit
//     counting as one run (`source: 'git'`).
// Saved per project in <workspace>/backlog/<projectId>.conflict-map.json: loadConflictMap builds it
// when the file is missing, updateConflictMap rebuilds it after a run merges. Read-only for the Product
// Owner, never blocks a run; built from git and the run folders only, no model call.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  commitRanges,
  conflictsOf,
  filesEditedByRuns,
  recommendationOf,
} = require('./repo-performance');

const MAX_FILES = 200;
const MAX_LINES = 100;
const GIT_COMMITS = 50;
const GIT_CONCURRENCY = 8;
const HOT_WINDOW = 20;
const HOT_SHARE = 0.5;
const LINE_FIX = 'Split this line into one item per line, sorted, so each run adds its own line instead of editing this one (a shared list or import).';

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out)));
  });
}

async function pool(items, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const item = items[next++]; await fn(item); } };
  await Promise.all(Array.from({ length: Math.min(GIT_CONCURRENCY, items.length) }, worker));
}

const isRepo = (repo) => !!repo && fs.existsSync(path.join(repo, '.git'));
const finished = (r) => !r.mock && !!r.finishedAt && r.status !== 'running';

/**
 * A `-U0` patch (git log -p / git diff) → [{ sha, file, hunks: [{ a, b, c, d }] }]. `log`: records start
 * with \x1e and the commit's sha; otherwise every file is of `sha`.
 */
function parsePatch(text, sha = null) {
  const out = [];
  const records = sha ? [[sha, String(text || '')]] : String(text || '').split('\x1e').filter((r) => r.trim()).map((r) => {
    const nl = r.indexOf('\n');
    return [r.slice(0, nl < 0 ? r.length : nl).trim(), nl < 0 ? '' : r.slice(nl + 1)];
  });
  for (const [commit, body] of records) {
    let cur = null;
    for (const line of body.split('\n')) {
      if (line.startsWith('diff --git ')) { cur = null; continue; }
      if (line.startsWith('+++ ')) {
        const p = line.slice(4).trim();
        cur = { sha: commit, file: p === '/dev/null' ? null : p.replace(/^b\//, ''), hunks: [] };
        out.push(cur);
        continue;
      }
      const m = cur && line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) cur.hunks.push({ a: +m[1], b: m[2] == null ? 1 : +m[2], c: +m[3], d: m[4] == null ? 1 : +m[4] });
    }
  }
  return out;
}

// Line `n` of the old side carried through `hunks` to the new side; null when it was deleted.
function carry(n, hunks) {
  let offset = 0;
  for (const h of hunks) {
    if (h.b === 0) {
      if (n > h.a) offset += h.d; else break;
      continue;
    }
    if (n < h.a) break;
    // changed again later: it is the new hunk's line now (the hub-line case)
    if (n < h.a + h.b) return h.d > 0 ? h.c + Math.min(n - h.a, h.d - 1) : null;
    offset += h.d - h.b;
  }
  return n + offset;
}

/**
 * The lines at HEAD that more than one unit changed. `changes` [{ unit, sha, file, hunks }] (each
 * commit's own hunks, in its coordinates); only `files` are looked at.
 */
async function hubLines(repo, changes, files) {
  const byLine = new Map();
  const bySha = new Map();
  for (const ch of changes) if (ch.file && files.has(ch.file)) bySha.set(ch.sha, [...(bySha.get(ch.sha) || []), ch]);
  const head = String(await git(['rev-parse', 'HEAD'], repo) || '').trim();
  await pool([...bySha], async ([sha, list]) => {
    const names = [...new Set(list.map((c) => c.file))];
    const later = sha === head ? [] : parsePatch(await git(['diff', '-U0', '--no-renames', '--no-color', sha, 'HEAD', '--', ...names], repo) || '', sha);
    // a file deleted since has no "+++ b/" side: the HEAD check below leaves it out
    const toHead = new Map(later.filter((p) => p.file).map((p) => [p.file, p.hunks]));
    const exists = new Set(await Promise.all(names.map(async (f) => ((await git(['cat-file', '-e', `HEAD:${f}`], repo)) != null ? f : null))));
    for (const ch of list) {
      if (!exists.has(ch.file)) continue;
      for (const h of ch.hunks) {
        for (let n = h.c; n < h.c + h.d; n++) {
          const at = carry(n, toHead.get(ch.file) || []);
          if (at == null) continue;
          const key = `${ch.file}\n${at}`;
          if (!byLine.has(key)) byLine.set(key, new Set());
          byLine.get(key).add(ch.unit);
        }
      }
    }
  });
  const hubs = [...byLine].filter(([, units]) => units.size > 1).map(([key, units]) => {
    const [file, line] = key.split('\n');
    return { file, line: Number(line), units: [...units] };
  });
  const texts = new Map();
  await pool([...new Set(hubs.map((h) => h.file))], async (file) => texts.set(file, String(await git(['show', `HEAD:${file}`], repo) || '').split('\n')));
  return hubs.map((h) => ({ ...h, text: String(texts.get(h.file)?.[h.line - 1] ?? '').replace(/\r$/, '').slice(0, 200) }));
}

// Each counted run's own hunks: its log range (no merges) or its PR merge commit's diff.
async function runChanges(repo, ranges, ids, files) {
  const changes = [];
  const names = [...files];
  if (!names.length) return changes;
  await pool(ids.filter((id) => ranges.has(id)), async (id) => {
    const range = ranges.get(id);
    const text = range.kind === 'log'
      ? await git(['log', '-p', '-U0', '--no-merges', '--no-renames', '--no-color', '--format=%x1e%H', ...range.args, '--', ...names], repo)
      : await git(['diff', '-U0', '--no-renames', '--no-color', ...range.args, '--', ...names], repo);
    const sha = range.kind === 'log' ? null : range.args[range.args.length - 1];
    for (const p of parsePatch(text || '', sha)) changes.push({ unit: id, ...p });
  });
  return changes;
}

const ordered = (ids, order) => [...ids].sort((x, y) => order.get(x) - order.get(y));

function filesOf(byUnit, unitIds, conflictsBy = new Map()) {
  const order = new Map(unitIds.map((id, n) => [id, n]));
  const by = new Map();
  for (const [id, files] of byUnit) for (const f of new Set(files)) by.set(f, [...(by.get(f) || []), id]);
  const named = (file) => [...conflictsBy.values()].filter((list) => list.some((x) => x === file || file.endsWith(`/${x}`))).length;
  return [...by].map(([file, ids]) => {
    const runIds = ordered(ids, order);
    return { file, runs: runIds.length, runIds, lastRun: runIds[0], conflicts: named(file) };
  }).sort((a, b) => b.runs - a.runs || a.file.localeCompare(b.file)).slice(0, MAX_FILES);
}

function linesOf(hubs, unitIds) {
  const order = new Map(unitIds.map((id, n) => [id, n]));
  return hubs.map((h) => {
    const runIds = ordered(h.units, order);
    return { file: h.file, line: h.line, text: h.text, runs: runIds.length, runIds };
  }).sort((a, b) => b.runs - a.runs || a.file.localeCompare(b.file) || a.line - b.line).slice(0, MAX_LINES);
}

// The fallback of a project without runs: the last commits of the branch, one commit as one run.
async function fromGit(repo) {
  const empty = { source: 'git', runs: 0, runIds: [], files: [], lines: [] };
  if (!isRepo(repo)) return empty;
  const text = await git(['log', '-n', String(GIT_COMMITS), '--no-merges', '--no-renames', '--format=%x1e%H', '--name-only', 'HEAD'], repo);
  const byUnit = new Map();
  for (const rec of String(text || '').split('\x1e')) {
    const [sha, ...rest] = rec.split('\n').map((l) => l.trim());
    if (sha) byUnit.set(sha, rest.filter(Boolean));
  }
  const unitIds = [...byUnit.keys()];
  if (!unitIds.length) return empty;
  const files = filesOf(byUnit, unitIds);
  const shared = new Set(files.filter((f) => f.runs > 1).map((f) => f.file));
  const changes = [];
  if (shared.size) {
    const patch = await git(['log', '-n', String(GIT_COMMITS), '-p', '-U0', '--no-merges', '--no-renames', '--no-color', '--format=%x1e%H', 'HEAD', '--', ...shared], repo);
    for (const p of parsePatch(patch || '')) changes.push({ unit: p.sha, ...p });
  }
  return { source: 'git', runs: unitIds.length, runIds: unitIds, files, lines: linesOf(await hubLines(repo, changes, shared), unitIds) };
}

/**
 * The conflict map of a project: `runs` its RunInfos (src/runs.js), `repo` its local clone, `store` the
 * workspace index (caches each run's file list). → { source: 'runs'|'git', runs, runIds (newest
 * finished first), files: [{ file, runs, runIds, lastRun, conflicts }], lines: [{ file, line, text,
 * runs, runIds }], builtAt }.
 */
async function buildConflictMap({ runs = [], repo, store = null }) {
  const builtAt = new Date().toISOString();
  const real = (runs || []).filter((r) => !r.mock);
  const counted = real.filter(finished).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const byUnit = new Map();
  if (counted.length && isRepo(repo)) {
    // every real run, so that a resumed run finds the first run's base
    const edited = await filesEditedByRuns({ runs: real, repo, store });
    for (const r of counted) if (edited.get(r.runId)?.length) byUnit.set(r.runId, edited.get(r.runId));
  }
  if (!byUnit.size) return { ...(await fromGit(repo)), builtAt };
  const unitIds = counted.map((r) => r.runId).filter((id) => byUnit.has(id));
  const conflictsBy = new Map(counted.filter((r) => byUnit.has(r.runId) && r.runDir).map((r) => [r.runId, conflictsOf(r.runDir).files]));
  const files = filesOf(byUnit, unitIds, conflictsBy);
  const shared = new Set(files.filter((f) => f.runs > 1).map((f) => f.file));
  const ranges = await commitRanges(real, repo);
  const changes = await runChanges(repo, ranges, unitIds, shared);
  return { source: 'runs', runs: unitIds.length, runIds: unitIds, files, lines: linesOf(await hubLines(repo, changes, shared), unitIds), builtAt };
}

/** <backlogDir>/<projectId>.conflict-map.json */
const conflictMapPath = (backlogDir, projectId) => path.join(backlogDir, `${projectId}.conflict-map.json`);

/** The saved map, or null (missing or unreadable). */
function readConflictMap(backlogDir, projectId) {
  try { return JSON.parse(fs.readFileSync(conflictMapPath(backlogDir, projectId), 'utf8')); } catch { return null; }
}

/** Rebuilds the map and saves it (after a run merges). */
async function updateConflictMap({ backlogDir, projectId, runs, repo, store = null }) {
  const map = await buildConflictMap({ runs, repo, store });
  const file = conflictMapPath(backlogDir, projectId);
  fs.mkdirSync(backlogDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, file);
  return map;
}

/** The saved map; a full build (saved) when the file is missing. */
async function loadConflictMap({ backlogDir, projectId, runs, repo, store = null }) {
  return readConflictMap(backlogDir, projectId) || updateConflictMap({ backlogDir, projectId, runs, repo, store });
}

/**
 * The files and lines changed by more than `threshold` of the newest `window` runs of `map` (two runs at
 * least), most-changed first, files before lines: [{ kind: 'file'|'line', file, line?, text?, runs, of,
 * runIds, fix }]. `fix` in the repository's terms (src/repo-performance.js recommendationOf for a file).
 */
function hotSpots(map, { window = HOT_WINDOW, threshold = HOT_SHARE } = {}) {
  const recent = new Set((map?.runIds || []).slice(0, window));
  const of = recent.size;
  if (!of) return [];
  const hot = (entry) => {
    const runIds = (entry.runIds || []).filter((id) => recent.has(id));
    return runIds.length > 1 && runIds.length / of > threshold ? runIds : null;
  };
  const files = [];
  for (const f of map.files || []) {
    const runIds = hot(f);
    if (!runIds) continue;
    const rec = recommendationOf({ file: f.file, runs: runIds.length, share: runIds.length / of });
    files.push({ kind: 'file', file: f.file, runs: runIds.length, of, runIds, conflicts: f.conflicts || 0, fix: rec?.text || 'Many runs edit this file: split it by feature so runs edit different files.' });
  }
  const lines = [];
  for (const l of map.lines || []) {
    const runIds = hot(l);
    if (runIds) lines.push({ kind: 'line', file: l.file, line: l.line, text: l.text || '', runs: runIds.length, of, runIds, fix: LINE_FIX });
  }
  const byRuns = (a, b) => b.runs - a.runs || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0);
  return [...files.sort(byRuns), ...lines.sort(byRuns)];
}

module.exports = {
  buildConflictMap,
  carry,
  conflictMapPath,
  hotSpots,
  loadConflictMap,
  parsePatch,
  readConflictMap,
  updateConflictMap,
};
