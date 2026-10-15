// Main stays green (#405): the tests known to fail on a project's base, and the base check.
// - recordPreexisting: each failure a run counted as pre-existing (#211, #396: it fails on the base
//   too) is recorded per project, keyed by file + test: first_seen, last_seen, the runs that saw it.
//   Seen by a second run (or already tracked), it files one bug issue, then updates it.
// - runBaseCheck: after a merge into the local base (and at once after a merge "not tested green"),
//   the whole suite runs on a clean detached checkout of the base tip (<workspace>/worktrees/
//   base-check-<project>), with no agent, in simulation (MULTIAGENT_SIMULATION_ONLY=1), one check at
//   a time, deferred while a release run holds the base. A red test files a bug issue naming the
//   commit range (last green, this commit) and the log; with Settings › Execution's onRed 'fix' a
//   fix item, mode auto, goes in a new stage before the roadmap's current one (src/roadmap.js
//   insertFrontStage). It never pushes, never answers a gate and never touches a running item.
// - knownFailures: what the Roadmap shows ("N known failures on the base", backlog:get baseFailures).
// Store: <workspace>/backlog/base-health/<project id>.json ({ failures, lastGreen }); the logs and
// issue bodies next to it, in <project id>/. Wired by src/service/areas/base-health.js.

const fs = require('fs');
const path = require('path');
const issues = require('./issues');
const roadmaps = require('./roadmap');
const { LOCAL } = require('./shared/default-workflow');
const { prepareBaseWorktree, removeWorktree } = require('./engine/worktree');
const { suiteEnv } = require('./engine/suite-step');
const { writeJsonSafe } = require('./state-file');

const ON_RED = ['off', 'issue', 'fix'];
// sightings of a pre-existing failure that file its issue
const RUNS_FOR_ISSUE = 2;
const LOG_TAIL_LINES = 60;
const HISTORY = 20;

const slug = (s) => path.basename(String(s || '')).replace(/[^\w.-]+/g, '-');
const storeDir = (ws) => path.join(ws, 'backlog', 'base-health');
const storeFile = (ws, projectId) => path.join(storeDir(ws), `${slug(projectId)}.json`);
const keyOf = (f) => `${f.file || ''}\n${f.test || ''}`;
const short = (c) => String(c || '').slice(0, 12) || 'unknown';
const stamp = (at) => String(at).replace(/[:.]/g, '-');

function readStore(ws, projectId) {
  try {
    const s = JSON.parse(fs.readFileSync(storeFile(ws, projectId), 'utf8'));
    return { failures: Array.isArray(s.failures) ? s.failures : [], lastGreen: s.lastGreen || null };
  } catch { return { failures: [], lastGreen: null }; }
}
const writeStore = (ws, projectId, store) => writeJsonSafe(storeFile(ws, projectId), store, {
  validate: (s) => (Array.isArray(s?.failures) ? null : 'failures is not a list'),
});

/** The project's tests failing on its base now: [{ test, file, first_seen, last_seen, runs, issue }]. */
function knownFailures(ws, projectId) {
  return readStore(ws, projectId).failures.filter((f) => !f.fixed_at).map((f) => ({ ...f, runs: [...(f.runs || [])], issue: f.issue || null }));
}

// One update of a project's store at a time (a run's record and a check may end together)
const locks = new Map();
function withStore(ws, projectId, fn) {
  const key = storeFile(ws, projectId);
  const next = (locks.get(key) || Promise.resolve()).then(() => fn());
  locks.set(key, next.catch(() => {}));
  return next;
}

// The failure's entry in the store, added when new; a fixed one is failing again
function upsert(store, f, at) {
  let entry = store.failures.find((x) => keyOf(x) === keyOf(f));
  if (!entry) {
    entry = { test: String(f.test || ''), file: String(f.file || ''), first_seen: at, last_seen: at, runs: [], issue: null };
    store.failures.push(entry);
  }
  delete entry.fixed_at;
  entry.last_seen = at;
  if (f.reason || f.error) entry.reason = String(f.reason || f.error).slice(0, 400);
  return entry;
}

// gh/glab's --repo value: a repository URL, or an owner/name already
function targetOf(platform, repo) {
  try { return issues.cliTarget(platform, repo); } catch (e) {
    if (issues.adapterOf(platform) && /^[^\s/]+\/\S+$/.test(String(repo || ''))) return String(repo);
    throw e;
  }
}

function issueBody(entry, { commit, lastGreen, logFile, logText, runId }) {
  const tail = String(logText || '').split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n').trim();
  return [
    `The test \`${entry.test}\` in \`${entry.file || '(unknown file)'}\` fails on the base.`,
    '',
    `- Last green commit: ${lastGreen ? short(lastGreen) : 'unknown (no green base check yet)'}`,
    `- First red commit: ${short(commit)}`,
    `- First seen: ${entry.first_seen}; last seen: ${entry.last_seen}`,
    `- Runs that counted it as pre-existing: ${entry.runs.length ? entry.runs.join(', ') : 'none yet'}`,
    ...(runId ? [`- Seen by run ${runId}`] : []),
    ...(entry.reason ? ['', '```', entry.reason, '```'] : []),
    ...(logFile ? ['', `Log: ${logFile}`] : []),
    ...(tail ? ['', '```', tail, '```'] : []),
    '',
    'Filed by the orchestrator (main stays green, #405).',
  ].join('\n');
}

// Files the entry's bug issue, or updates the one it has (a comment) → { url, action, test }
async function fileIssue(ws, projectId, entry, { platform, repo, exec, ...ctx }) {
  const p = issues.adapterOf(platform);
  const target = targetOf(platform, repo);
  const at = new Date().toISOString();
  const dir = path.join(storeDir(ws), slug(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp(at)}-issue.md`);
  const text = issueBody(entry, ctx);
  fs.writeFileSync(file, text);
  if (entry.issue?.number) {
    const c = p.issueSaveCommand({ target, n: String(entry.issue.number), mode: 'comment', file, text: `Still red on the base.\n\n${text}` });
    await exec(c.cli, c.args);
    return { url: entry.issue.url, number: entry.issue.number, action: 'updated', test: entry.test };
  }
  // the bug label when the repository has it (GitLab creates a missing one itself)
  let labels = ['bug'];
  if (p.readsLabels) {
    const l = p.labelListCommand(target);
    labels = await Promise.resolve(exec(l.cli, l.args)).then((out) => (p.parseLabelNames(out).includes('bug') ? ['bug'] : []), () => []);
  }
  const c = p.issueCreateCommand({ target, title: `Red on the base: ${entry.test}`.slice(0, 200), labels, file, text });
  const url = String(await exec(c.cli, c.args) || '').match(/https?:\/\/\S+/)?.[0] || null;
  const number = Number(url?.match(/\/issues\/(\d+)/)?.[1]) || null;
  entry.issue = url ? { url, number } : null;
  return { url, number, action: 'created', test: entry.test };
}

// The fix item, mode auto, in a new stage before the roadmap's current one → the item or null
function addFixItem(ws, projectId, filed, workflow) {
  const list = filed.filter((x) => x.number).map((x) => ({ number: x.number, title: `Red on the base: ${x.test}`, url: x.url }));
  if (!list.length) return null;
  const stage = roadmaps.insertFrontStage(path.join(ws, 'backlog'), projectId, {
    name: 'Fix the base',
    note: 'Added by the base check (#405): a test is red on the base.',
    items: [{ workflow: workflow || LOCAL, inputs: { mode: 'auto' }, issues: list, reason: 'Main stays green: the base has a red test.' }],
  });
  return stage?.items[0] || null;
}

// Files (or updates) the issues of `entries` and, with onRed 'fix', a fix item for the new ones
async function report(ws, projectId, entries, opts) {
  const { onRed = 'fix', exec, platform } = opts;
  const repo = opts.ghRepo || opts.repo;
  if (onRed === 'off' || !entries.length || !exec || !platform || !repo || !issues.adapterOf(platform)) return { issues: [], fixItem: null };
  const filed = [];
  for (const entry of entries) {
    try { filed.push(await fileIssue(ws, projectId, entry, { ...opts, repo })); } catch (e) { console.error(`base health: issue for ${entry.test}:`, e.message); }
  }
  const created = filed.filter((x) => x.action === 'created');
  const fixItem = onRed === 'fix' && created.length ? addFixItem(ws, projectId, created, opts.workflow) : null;
  return { issues: filed.map(({ url, action, test }) => ({ url, action, test })), fixItem };
}

/**
 * A run's pre-existing failures (the suite step's preexisting_failures): recorded, and an issue filed
 * once two runs saw a failure (updated by every later sighting). Without exec/platform/repo: record only.
 * @param {string} ws the workspace root
 * @param {{ projectId: string, runId?: string, commit?: string, failures: object[], at?: string,
 *   onRed?: string, platform?: string, repo?: string, exec?: Function, workflow?: string }} opts
 */
function recordPreexisting(ws, opts) {
  const { projectId, runId, commit, failures = [], at = new Date().toISOString() } = opts;
  if (!projectId || !failures.length) return Promise.resolve({ issues: [], fixItem: null });
  return withStore(ws, projectId, async () => {
    const store = readStore(ws, projectId);
    const due = [];
    for (const f of failures) {
      const entry = upsert(store, f, at);
      if (commit) entry.last_commit = commit;
      if (!runId || entry.runs.includes(runId)) continue;
      entry.runs = [...entry.runs, runId].slice(-HISTORY);
      if (entry.issue || entry.runs.length >= RUNS_FOR_ISSUE) due.push(entry);
    }
    writeStore(ws, projectId, store);
    const out = await report(ws, projectId, due, { ...opts, commit, lastGreen: store.lastGreen?.commit, runId });
    writeStore(ws, projectId, store);
    return out;
  });
}

// One base check at a time, whatever the project (each runs a whole suite)
let tail = Promise.resolve();
function serialize(fn) {
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
}

/**
 * The base check: the suite on a clean checkout of the local base tip; a red test files its issue
 * and, with onRed 'fix', a fix item. → { status: green | red | deferred | error, commit, issues, fixItem }
 * @param {string} ws the workspace root
 * @param {{ projectId: string, repo: string, base: string, platform?: string, ghRepo?: string,
 *   trigger?: string, onRed?: string, releaseHoldsBase?: () => boolean,
 *   runSuite: ({ cwd, env }) => Promise<{ failures: object[], log?: string, error?: string }>,
 *   exec?: Function, workflow?: string, log?: Function }} opts
 */
function runBaseCheck(ws, opts) {
  const deferred = { status: 'deferred', commit: null, issues: [], fixItem: null };
  if (opts.releaseHoldsBase?.()) return Promise.resolve(deferred);
  return serialize(async () => {
    // a release may have taken the base while this check waited for the one before
    if (opts.releaseHoldsBase?.()) return deferred;
    const { projectId, repo, base, log = () => {} } = opts;
    const onRed = ON_RED.includes(opts.onRed) ? opts.onRed : 'fix';
    const dir = path.join(ws, 'worktrees', `base-check-${slug(projectId)}`);
    const info = await prepareBaseWorktree({ repo, base, dir, log, remote: false });
    if (!info) return { status: 'error', error: `${repo} is not a git repository`, commit: null, issues: [], fixItem: null };
    let result;
    try {
      result = await opts.runSuite({ cwd: info.workDir, env: suiteEnv(process.env).env });
    } catch (e) {
      result = { failures: [], log: '', error: e.message };
    } finally {
      await removeWorktree({ repo: info.repo, dir: info.dir, remote: false, log }).catch(() => {});
    }
    const failures = (result?.failures || []).filter((f) => f?.test);
    const at = new Date().toISOString();
    return withStore(ws, projectId, async () => {
      const store = readStore(ws, projectId);
      if (!failures.length) {
        if (result?.error) return { status: 'error', error: result.error, commit: info.commit, issues: [], fixItem: null };
        // green: the known failures are fixed (their entries keep the issue, should the test go red again)
        store.lastGreen = { commit: info.commit, at };
        for (const f of store.failures) if (!f.fixed_at) f.fixed_at = at;
        writeStore(ws, projectId, store);
        return { status: 'green', commit: info.commit, issues: [], fixItem: null };
      }
      const dirLog = path.join(storeDir(ws), slug(projectId));
      fs.mkdirSync(dirLog, { recursive: true });
      const logFile = path.join(dirLog, `${stamp(at)}-suite.log`);
      fs.writeFileSync(logFile, String(result.log || ''));
      const entries = failures.map((f) => Object.assign(upsert(store, f, at), { last_commit: info.commit, base_check: { at, commit: info.commit, trigger: opts.trigger || 'merge' } }));
      writeStore(ws, projectId, store);
      const out = await report(ws, projectId, entries, { ...opts, onRed, commit: info.commit, lastGreen: store.lastGreen?.commit, logFile, logText: result.log });
      writeStore(ws, projectId, store);
      return { status: 'red', commit: info.commit, ...out };
    });
  });
}

module.exports = {
  knownFailures,
  ON_RED,
  recordPreexisting,
  runBaseCheck,
};
