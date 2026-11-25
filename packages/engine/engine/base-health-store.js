// The base-health store (#405): the tests known to fail on a project's base, one file per project,
// <workspace>/backlog/base-health/<project id>.json ({ failures, lastGreen, lastCheck: the last base
// check's { commit, at, status }, #598 (status no_tests: the project has none, #71), flaky: the tests red in the base check's whole suite and green
// on its re-run, { test, file, commit, at }, #613 }). Each failure is keyed
// by file + test: first_seen, last_seen, the runs that saw it, its issue. Here so the engine can
// record a run's pre-existing failures (recordSightings, packages/engine/engine/machine-actions.js) without the
// root area; filing issues and the base check stay in packages/engine/domains/project/base-health.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonSafe } = require('../domains/workspace/state-file');

// sightings of a pre-existing failure that file its issue
const RUNS_FOR_ISSUE = 2;
const HISTORY = 20;
// #613: the flaky sightings kept per project
const FLAKY_HISTORY = 100;

const slug = (s) => path.basename(String(s || '')).replace(/[^\w.-]+/g, '-');
const storeDir = (ws) => path.join(ws, 'backlog', 'base-health');
const storeFile = (ws, projectId) => path.join(storeDir(ws), `${slug(projectId)}.json`);
const keyOf = (f) => `${f.file || ''}\n${f.test || ''}`;

function readStore(ws, projectId) {
  try {
    const s = JSON.parse(fs.readFileSync(storeFile(ws, projectId), 'utf8'));
    // #598: the last check (commit, at, status), kept when there is one
    return {
      failures: Array.isArray(s.failures) ? s.failures : [],
      lastGreen: s.lastGreen || null,
      ...(s.lastCheck ? { lastCheck: s.lastCheck } : {}),
      flaky: Array.isArray(s.flaky) ? s.flaky : [],
    };
  } catch { return { failures: [], lastGreen: null, flaky: [] }; }
}
const writeStore = (ws, projectId, store) => writeJsonSafe(storeFile(ws, projectId), store, {
  validate: (s) => (Array.isArray(s?.failures) ? null : 'failures is not a list'),
});

/** The project's tests failing on its base now: [{ test, file, first_seen, last_seen, runs, issue }]. */
function knownFailures(ws, projectId) {
  return readStore(ws, projectId).failures.filter((f) => !f.fixed_at).map((f) => ({ ...f, runs: [...(f.runs || [])], issue: f.issue || null }));
}

/**
 * #527: the known failures a base check confirmed red alone since the last green check (confirmed_at,
 * set by packages/engine/domains/project/base-health.js runBaseCheck; a run's sightings never confirm): the only ones a run's
 * suite may count as pre-existing.
 */
function confirmedFailures(ws, projectId) {
  const { lastGreen } = readStore(ws, projectId);
  return knownFailures(ws, projectId).filter((f) => f.confirmed_at && (!lastGreen?.at || f.confirmed_at > lastGreen.at));
}

// One update of a project's store at a time (a run's record and a check may end together)
const locks = new Map();
function withStore(ws, projectId, fn) {
  const key = storeFile(ws, projectId);
  const next = (locks.get(key) || Promise.resolve()).then(() => fn());
  locks.set(key, next.catch(() => {}));
  return next;
}

// The failure's entry in the store, added when new; a fixed one is failing again (its issue is
// reopened, its first red commit is this one). `commit`: the base commit it is red at.
function upsert(store, f, at, commit) {
  let entry = store.failures.find((x) => keyOf(x) === keyOf(f));
  if (!entry) {
    entry = { test: String(f.test || ''), file: String(f.file || ''), first_seen: at, last_seen: at, runs: [], issue: null };
    store.failures.push(entry);
  }
  if (entry.fixed_at) {
    if (entry.issue) entry.reopen = true;
    delete entry.first_red_commit;
    delete entry.fixed_at;
    delete entry.confirmed_at;
  }
  entry.last_seen = at;
  if (commit) {
    entry.last_commit = commit;
    entry.first_red_commit ||= commit;
  }
  if (f.reason || f.error) entry.reason = String(f.reason || f.error).slice(0, 400);
  return entry;
}

// A run's sightings added to `store` (in memory) → the entries whose issue is due: seen by a second
// run, or tracked by an issue already, and not reported for this run yet
function addSightings(store, { runId, commit, failures = [], at }) {
  const due = [];
  for (const f of failures) {
    const entry = upsert(store, f, at, commit);
    if (!runId) continue;
    if (!entry.runs.includes(runId)) entry.runs = [...entry.runs, runId].slice(-HISTORY);
    if ((entry.reported || []).includes(runId)) continue;
    if (entry.issue || entry.runs.length >= RUNS_FOR_ISSUE) due.push(entry);
  }
  return due;
}

// #613: the base check's tests red in the whole suite, green on the re-run, added to `store` (in
// memory) as flaky sightings { test, file, commit, at }, the latest FLAKY_HISTORY kept
function addFlaky(store, failures, { commit, at }) {
  const seen = failures.map((f) => ({ test: String(f.test || ''), file: String(f.file || ''), commit: commit || null, at }));
  store.flaky = [...(store.flaky || []), ...seen].slice(-FLAKY_HISTORY);
  return seen;
}

/**
 * A run's pre-existing failures recorded in the store, nothing filed (the engine's suite step; the
 * service's packages/engine/domains/project/base-health.js recordPreexisting files what is due for the same run).
 * @param {string} ws the workspace root
 * @param {{ projectId: string, runId?: string, commit?: string, failures: object[], at?: string }} opts
 */
function recordSightings(ws, opts) {
  const { projectId, failures = [], at = new Date().toISOString() } = opts;
  if (!projectId || !failures.length) return Promise.resolve();
  return withStore(ws, projectId, async () => {
    const store = readStore(ws, projectId);
    addSightings(store, { ...opts, at });
    writeStore(ws, projectId, store);
  });
}

module.exports = {
  addFlaky,
  addSightings,
  confirmedFailures,
  HISTORY,
  knownFailures,
  readStore,
  recordSightings,
  slug,
  storeDir,
  upsert,
  withStore,
  writeStore,
};
