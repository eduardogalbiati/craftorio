// Service area: what 'run:meta' pushes about a run, its PR (#84) and its title. The PR is read
// with gh/glab (no LLM), cached by URL: the runs in progress every minute and on their events,
// finished runs when a list shows them (runs:prState). A change is pushed as { runId, pr } or
// { runId, title, customTitle }. A simulated run's PR is not real: never read (unless
// host.readPrJson stands in for gh/glab).

const path = require('path');
const runs = require('../../runs');
const runPr = require('../../run-pr');

const SIMULATED_PR = { state: 'unknown', detail: 'simulated run: its PR is not real, so it is not read' };

module.exports = (ctx) => {
  const { host, events } = ctx;
  const prs = runPr.prCache({ reader: host.readPrJson });
  const unreadPr = (mock) => !!mock && !host.readPrJson;
  const prSeen = new Map(); // run id → "url state" last pushed

  function withPrState(pr, mock) {
    if (!pr) return null;
    if (unreadPr(mock)) return { ...pr, ...SIMULATED_PR, checkedAt: null };
    const hit = prs.get(pr.url);
    return hit ? { ...pr, state: hit.state, detail: hit.detail, checkedAt: hit.checkedAt } : { ...pr, state: null, detail: null, checkedAt: null };
  }

  async function refreshLivePr(run, maxAgeMs) {
    if (!run.pr) return;
    const pr = unreadPr(run.mock) ? withPrState(run.pr, true) : await prs.refresh(run.pr, { maxAgeMs });
    const key = `${pr.url} ${pr.state}`;
    if (prSeen.get(run.runId) === key) return;
    prSeen.set(run.runId, key);
    events.emit('run:meta', { runId: run.runId, pr });
  }

  // { title, customTitle } of a run in progress (meta.json, the run it resumes, its issue or task)
  const liveTitle = (run) => runs.runTitle(ctx.ws.runs, run.runId, { issues: run.issues, inputs: run.inputs });

  const prTimer = setInterval(() => {
    for (const run of ctx.active.values()) refreshLivePr(run, 0).catch((e) => console.error('run PR:', e.message));
  }, 60 * 1000);
  prTimer.unref?.();

  // The PR of a run with its state read now (or from the cache, under 5 minutes old): the lists ask
  // for the runs they show. null when the run opened none.
  async function runPrState({ runId }) {
    const id = path.basename(ctx.runFolder(runId));
    const run = ctx.active.get(id);
    const r = run ? { pr: run.pr, mock: run.mock } : runs.readRun(ctx.ws.runs, id);
    if (!r?.pr) return null;
    return unreadPr(r.mock) ? withPrState(r.pr, true) : prs.refresh(r.pr);
  }

  // The owner's title for a run (empty: back to the default), in runs/<id>/meta.json: events.jsonl
  // is never touched. Pushed on 'run:meta' so every window and list shows it.
  function setRunTitle({ runId, title }) {
    const dir = ctx.runFolder(runId);
    const id = path.basename(dir);
    runPr.writeTitle(dir, title);
    const run = ctx.active.get(id);
    const r = run ? null : runs.readRun(ctx.ws.runs, id);
    const out = { runId: id, ...runs.runTitle(ctx.ws.runs, id, run ? { issues: run.issues, inputs: run.inputs } : { issues: r?.issues, task: r?.task }) };
    events.emit('run:meta', out);
    return out;
  }

  return {
    liveTitle,
    refreshLivePr,
    runPrState,
    setRunTitle,
    stopPrTimer: () => clearInterval(prTimer),
    withPrState,
  };
};
