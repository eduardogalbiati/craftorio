// @ts-check
// A roadmap item's status from its run (#112), pure but for mergedPullRequest (it reads the run's
// events). Split from roadmap.js (#797), which re-exports what the service asks for.
// A run that succeeded with a PR a person merges on the platform (#797): `run.pr` is that PR, and the
// item waits for its merge (`waiting_merge`, derived, never stored) until the service's read says it
// merged (`run.merged`, the item is done with `run.mergedCommit`) or closed (`run.prClosed`, it failed).
// #807: so does a run still waiting at its PR's review gate (pr_review), `waiting` kept for Move on (#395);
// #809: and a run in its PR monitor (pr_monitor), its PR with the monitor's card.

const fs = require('fs');
const path = require('path');
const { isFinished } = require('@multiagent/shared/roadmap-model');

const runFailure = (runId, run) => (run.prClosed ? `PR #${run.pr.number} was closed without merging`
  : `Run ${runId} ${run.status === 'success' ? 'finished without merging: merge it, then skip the item'
    : `${run.status === 'interrupted' ? 'was interrupted' : run.status}${run.error ? `: ${String(run.error).slice(0, 200)}` : ''}`}`);

// #797: the run ended well and its PR is still to merge: not a failure, a person may merge it
const waitsForMerge = (run) => run.status === 'success' && !!run.pr && !run.prClosed;
// #797: what a merged run adds to its item (stored with it: the done item no longer reads its PR)
const mergedOf = (run) => (run.mergedCommit ? { mergedCommit: run.mergedCommit } : {});

// An item's status from its run: running (a live run, in this process or another one, `waiting` at
// a gate), paused (#368: its run paused after its current turn, never a failure), done (it merged),
// waiting_merge (#797: its PR is open, `pr` says which), failed (it ended otherwise, or it could not
// start), else as stored.
// #395: a parked item stays parked while its run waits (or was interrupted, or paused, or #797: its PR
// is open); once its gate is answered it takes the run's outcome: done when it merged, else failed,
// still marked `parked` so it never holds its stage or pauses the roadmap (packages/shared/roadmap-model.js isFinished).
function itemStatus(item, runOf) {
  if (item.status === 'parked') {
    const parked = item.parked || { at: null, gate: null };
    const run = item.runId ? runOf(item.runId) : null;
    if (!run) return { status: 'failed', error: `Run ${item.runId} no longer exists.`, parked };
    if (['interrupted', 'paused', 'pending', 'running'].includes(run.status)) return { status: 'parked', error: null, parked };
    if (run.status === 'success' && run.merged) return { status: 'done', error: null, parked, ...mergedOf(run) };
    if (waitsForMerge(run)) return { status: 'parked', error: null, parked, pr: run.pr };
    return { status: 'failed', error: runFailure(item.runId, run), parked };
  }
  if (isFinished(item)) return { status: item.status, error: item.error || null };
  if (!item.runId) return item.error ? { status: 'failed', error: item.error } : { status: 'planned', error: null };
  const run = runOf(item.runId);
  if (!run) return { status: 'failed', error: `Run ${item.runId} no longer exists.` };
  // #807: a run waiting at its PR's review gate (`atMergeGate`, the service's roadmapRun) waits for that merge too
  if (['pending', 'running'].includes(run.status) && run.atMergeGate && run.pr) return { status: 'waiting_merge', error: null, pr: run.pr, waiting: true };
  if (['pending', 'running'].includes(run.status)) return { status: 'running', error: null, ...(run.waiting ? { waiting: true } : {}) };
  if (run.status === 'paused') return { status: 'paused', error: null };
  if (run.status === 'success' && run.merged) return { status: 'done', error: null, ...mergedOf(run) };
  if (waitsForMerge(run)) return { status: 'waiting_merge', error: null, pr: run.pr };
  return { status: 'failed', error: runFailure(item.runId, run) };
}

/** The roadmap with each item's status derived from its run (`runOf` as in `advance`). */
function withStatus(roadmap, runOf) {
  return {
    ...roadmap,
    stages: (roadmap.stages || []).map((s) => ({ ...s, items: (s.items || []).map(({ waiting: _w, pr: _p, ...x }) => ({ ...x, ...itemStatus(x, runOf) })) })),
  };
}

/** Whether a run's events show a PR/MR merged by its action (`gh pr merge` / `glab mr merge`, exit 0), or by a
 * merge from the app that landed (#810: `pr.merge` merged; one that did not land never counts). */
function mergedPullRequest(runDir) {
  let text;
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return false; }
  return text.split('\n').some((l) => {
    const fromApp = l.includes('"pr.merge"');
    if (!fromApp && !l.includes('"action.executed"')) return false;
    try {
      const ev = JSON.parse(l);
      if (ev.type === 'pr.merge') return ev.merged === true;
      return ev.exit_code === 0 && !ev.skipped && /\b(gh\s+pr|glab\s+mr)\s+merge\b/.test(ev.command || '');
    } catch { return false; }
  });
}

module.exports = {
  mergedPullRequest,
  withStatus,
};
