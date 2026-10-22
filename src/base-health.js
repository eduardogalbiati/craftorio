// Main stays green (#405): the tests known to fail on a project's base, and the base check.
// - recordPreexisting: each failure a run counted as pre-existing (#211, #396: it fails on the base
//   too) is recorded per project, keyed by file + test: first_seen, last_seen, the runs that saw it.
//   Seen by a second run (or already tracked), it files one bug issue, then updates it. This is the
//   one store of those failures: the engine records each run's (record only), the service files.
//   A test red again after a green check reopens its issue and gets a fix item again.
// - runBaseCheck: after a merge into the local base (and at once after a merge "not tested green"),
//   the whole suite runs on a clean detached checkout of the base tip (<workspace>/worktrees/
//   base-check-<project>), with no agent, in simulation (MULTIAGENT_SIMULATION_ONLY=1), one check at
//   a time, deferred while a release run holds the base. A red test files a bug issue naming the
//   commit range (last green, first red) and the log; with Settings › Execution's onRed 'fix' a
//   fix item, mode auto, goes in a new stage before the roadmap's current one (src/roadmap.js
//   insertFrontStage). It never pushes, never answers a gate and never touches a running item.
// - knownFailures: what the Roadmap shows ("N known failures on the base", backlog:get baseFailures).
// Store: <workspace>/backlog/base-health/<project id>.json ({ failures, lastGreen }); the logs and
// issue bodies next to it, in <project id>/ (the store itself: src/engine/base-health-store.js, so
// the engine records a run's failures without this module). Wired by src/service/areas/base-health.js.

const fs = require('fs');
const path = require('path');
const issues = require('./issues');
const roadmaps = require('./roadmap');
const { LOCAL } = require('./shared/default-workflow');
const { prepareBaseWorktree, removeWorktree } = require('./engine/worktree');
const { suiteEnv } = require('./engine/suite-step');
const {
  addSightings,
  HISTORY,
  knownFailures,
  readStore,
  slug,
  storeDir,
  upsert,
  withStore,
  writeStore,
} = require('./engine/base-health-store');

const ON_RED = ['off', 'issue', 'fix'];
const LOG_TAIL_LINES = 60;

const short = (c) => String(c || '').slice(0, 12) || 'unknown';
const stamp = (at) => String(at).replace(/[:.]/g, '-');

function issueBody(entry, { commit, lastGreen, logFile, logText, runId }) {
  const tail = String(logText || '').split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n').trim();
  return [
    `The test \`${entry.test}\` in \`${entry.file || '(unknown file)'}\` fails on the base.`,
    '',
    `- Last green commit: ${lastGreen ? short(lastGreen) : 'unknown (no green base check yet)'}`,
    `- First red commit: ${short(entry.first_red_commit || commit)}`,
    ...(commit && entry.first_red_commit && commit !== entry.first_red_commit ? [`- Still red at: ${short(commit)}`] : []),
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
  const target = issues.cliTargetOrName(platform, repo);
  const at = new Date().toISOString();
  const dir = path.join(storeDir(ws), slug(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp(at)}-issue.md`);
  const text = issueBody(entry, ctx);
  fs.writeFileSync(file, text);
  if (entry.issue?.number) {
    const n = String(entry.issue.number);
    // red again after a green check: the issue (closed with its fix, most likely) is reopened
    const reopen = !!entry.reopen;
    if (reopen) {
      const r = p.issueReopenCommand(target, n);
      await Promise.resolve(exec(r.cli, r.args)).catch(() => { /* already open */ });
    }
    const c = p.issueSaveCommand({ target, n, mode: 'comment', file, text: `${reopen ? 'Red again on the base.' : 'Still red on the base.'}\n\n${text}` });
    await exec(c.cli, c.args);
    delete entry.reopen;
    return { url: entry.issue.url, number: entry.issue.number, action: reopen ? 'reopened' : 'updated', test: entry.test };
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

// Whether `opts` can file issues (setting not off, a platform, a repository and a way to run its CLI)
const canReport = (opts) => (opts.onRed || 'fix') !== 'off' && !!opts.exec && !!opts.platform && !!(opts.ghRepo || opts.repo) && !!issues.adapterOf(opts.platform);

// Files (or updates) the issues of `entries` and, with onRed 'fix', a fix item for them (none when
// the roadmap plans their issues already)
async function report(ws, projectId, entries, opts) {
  const { onRed = 'fix' } = opts;
  const repo = opts.ghRepo || opts.repo;
  if (!entries.length || !canReport(opts)) return { issues: [], fixItem: null };
  const filed = [];
  for (const entry of entries) {
    try { filed.push(await fileIssue(ws, projectId, entry, { ...opts, repo })); } catch (e) { console.error(`base health: issue for ${entry.test}:`, e.message); }
  }
  const fixItem = onRed === 'fix' && filed.length ? addFixItem(ws, projectId, filed, opts.workflow) : null;
  return { issues: filed.map(({ url, action, test }) => ({ url, action, test })), fixItem };
}

/**
 * A run's pre-existing failures (the suite step's preexisting_failures): recorded, and an issue filed
 * once two runs saw a failure (updated by every later sighting). Without exec/platform/repo: record
 * only (the engine's suite step records through src/engine/base-health-store.js recordSightings); the service's call for the same run
 * then files what is due (`reported`: the runs whose sighting went to the issue already).
 * @param {string} ws the workspace root
 * @param {{ projectId: string, runId?: string, commit?: string, failures: object[], at?: string,
 *   onRed?: string, platform?: string, repo?: string, exec?: Function, workflow?: string }} opts
 */
function recordPreexisting(ws, opts) {
  const { projectId, runId, commit, failures = [], at = new Date().toISOString() } = opts;
  if (!projectId || !failures.length) return Promise.resolve({ issues: [], fixItem: null });
  return withStore(ws, projectId, async () => {
    const store = readStore(ws, projectId);
    const due = addSightings(store, { runId, commit, failures, at });
    writeStore(ws, projectId, store);
    if (!canReport(opts)) return { issues: [], fixItem: null };
    for (const entry of due) entry.reported = [...(entry.reported || []), runId].slice(-HISTORY);
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
 *   runSuite: ({ cwd, env, commit }) => Promise<{ failures: object[], log?: string, error?: string }>,
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
      // the check's own screenshot slot (#210), as each run's suite has
      const env = suiteEnv(process.env, { locksDir: path.join(ws, 'worktrees', `base-check-${slug(projectId)}-locks`) }).env;
      result = await opts.runSuite({ cwd: info.workDir, env, commit: info.commit });
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
      const entries = failures.map((f) => Object.assign(upsert(store, f, at, info.commit), { base_check: { at, commit: info.commit, trigger: opts.trigger || 'merge' } }));
      writeStore(ws, projectId, store);
      const out = await report(ws, projectId, entries, { ...opts, onRed, commit: info.commit, lastGreen: store.lastGreen?.commit, logFile, logText: result.log });
      writeStore(ws, projectId, store);
      return { status: 'red', commit: info.commit, ...out };
    });
  });
}

// the base check's suite log, next to its checkout (kept until the next check of the project, #465)
const baseCheckLog = (ws, projectId) => path.join(ws, 'worktrees', `base-check-${slug(projectId)}-suite.log`);

module.exports = {
  baseCheckLog,
  knownFailures,
  ON_RED,
  recordPreexisting,
  runBaseCheck,
};
