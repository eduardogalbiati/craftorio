// Backlog Refresh suggestion (#161): when a project's last successful backlog-refresh run is older
// than the backlogRefreshHours setting (with none, the project's add time is the baseline, #784; with
// neither, "never refreshed") and its base branch got merges since, the
// Backlog shows a banner offering to start one (never starts it by itself). "Dismiss for today" is
// kept per project in <workspace>/backlog/<project id>.refresh.json. The issues the last refresh
// updated (its applied-safe.json) carry a "refreshed" badge for a day after the run.
// Service: packages/engine/service/areas/backlog.js (withIssueRuns, afterBacklogRefresh); screen:
// fronts/build/views/backlog/backlog.js (refreshAlert).

const fs = require('fs');
const path = require('path');

const WORKFLOW = 'backlog-refresh.yaml';
const DAY_MS = 24 * 3600e3;

// by basename, for a Windows or a POSIX path on any platform (#763)
const isRefreshRun = (r) => path.posix.basename(String(r?.file || '').replace(/\\/g, '/')) === WORKFLOW;
const dismissFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.refresh.json`);
// the local calendar day ("today" for Dismiss for today)
const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function readDismissed(dir, projectId) {
  try { return JSON.parse(fs.readFileSync(dismissFile(dir, projectId), 'utf8')).dismissedOn || null; } catch { return null; }
}

function dismiss(dir, projectId, now = Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dismissFile(dir, projectId), JSON.stringify({ dismissedOn: localDay(now) }, null, 2));
}

/** The last successful refresh run and the live one among a project's runs (newest first). */
function refreshRuns(list) {
  const mine = (list || []).filter(isRefreshRun);
  return {
    last: mine.find((r) => r.status === 'success') || null,
    running: mine.find((r) => r.status === 'running' || r.status === 'pending') || null,
  };
}

/**
 * The banner's state. runs: the project's runs, newest first, live ones with status `running`;
 * intervalHours: the setting (0/empty = off); merges: merges on the base since the last refresh
 * started, or since addedAt with no refresh run (null when unknown); addedAt: when the project
 * was added (#784: the baseline with no refresh run; none = "never refreshed");
 * dismissedOn: the day of Dismiss for today.
 * due: show "Refresh now" (stale, merges since or no baseline, not dismissed today, none running).
 */
function refreshState({ runs, intervalHours, merges = null, addedAt = null, dismissedOn = null, now = Date.now() }) {
  const interval = Number(intervalHours) > 0 ? Number(intervalHours) : 0;
  const { last, running } = refreshRuns(runs);
  const added = addedAt ? Date.parse(addedAt) : NaN;
  const since = last ? last.startedAt || null : (Number.isFinite(added) ? addedAt : null);
  const baseline = last || since;
  const startedAt = since ? Date.parse(since) : NaN;
  const hoursAgo = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 3600e3)) : null;
  const stale = !baseline || hoursAgo == null || hoursAgo >= interval;
  const changed = baseline ? merges > 0 : true;
  return {
    interval,
    lastRun: last ? { runId: last.runId, startedAt: last.startedAt, mock: !!last.mock } : null,
    running: running ? { runId: running.runId, workflow: running.workflow || null } : null,
    hoursAgo,
    merges: baseline ? merges : null,
    since,
    dismissed: dismissedOn === localDay(now),
    due: !!interval && !running && stale && changed && dismissedOn !== localDay(now),
  };
}

/** Numbers of the issues a refresh run updated (its applied-safe.json), within a day of its end. */
function refreshedIssues(runDir, finishedAt, now = Date.now()) {
  const end = Date.parse(finishedAt);
  if (!runDir || !Number.isFinite(end) || now - end > DAY_MS) return [];
  try {
    const applied = JSON.parse(fs.readFileSync(path.join(runDir, 'applied-safe.json'), 'utf8'));
    return (applied.results || []).filter((r) => r.result === 'updated').map((r) => Number(r.number)).filter(Number.isFinite);
  } catch { return []; }
}

module.exports = {
  dismiss,
  isRefreshRun,
  localDay,
  readDismissed,
  refreshedIssues,
  refreshRuns,
  refreshState,
  WORKFLOW,
};
