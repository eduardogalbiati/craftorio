// Service area: the runs the app (or `npm run serve`) died in continue by themselves at start-up
// (#607). A run the workspace's active-run marker names, without summary.json and with a stale
// owner.json, continues in its own folder, with its own id, at its last finished turn (WorkflowRun
// `recover`, packages/engine/engine/run/resume.js seedRecovery): the gate it waited at asks again, the
// turn the crash cut is recorded as a stopped attempt. Never a second copy: a run another live process
// owns is left alone (#112), and this process takes its owner.json over in the same tick as that
// check, so a process started next on the workspace sees it alive. Simulation-only
// (CRAFTORIO_SIMULATION_ONLY=1) never recovers a real run; a child run (`type: workflow`) is left
// to its parent. What is not recovered stays interrupted: notifyInterruptedRun reports it (areas/runs.js),
// Resume from step continues it (areas/resume.js). docs/agents/engine/resume.md.

const fs = require('fs');
const path = require('path');
const runs = require('../../domains/run/runs');
const runOwner = require('../../domains/run/run-owner');
const supervisor = require('../../domains/supervisor/supervisor');
const simulation = require('../../engine/simulation');
const { runStateFromEvents } = require('../../engine/run/resume');

module.exports = (ctx) => {
  // Why the run in `dir` is not recovered ('' = it is): live here or in another process, finished,
  // a child run, a real run in simulation-only, nothing left to run.
  function notRecoverable(runId, dir, events) {
    if (ctx.active.has(runId)) return 'it runs in this process';
    if (runOwner.ownerAlive(runOwner.readOwner(dir))) return 'another live process owns it (#112)';
    if (runs.readRun(ctx.ws.runs, runId)?.status !== 'interrupted') return 'it is not interrupted';
    const started = events.find((e) => e.type === 'workflow.started');
    if (started?.parent_run) return 'a child run: its parent runs its step again';
    if (!started?.mock && simulation.simulationOnly()) return `a real run, and ${simulation.ENV}=1 runs simulations only`;
    if (!runStateFromEvents(events).nextStep) return 'it has nothing left to run';
    return '';
  }

  // The runs to recover, each taken over now ({ runId, owner, events, spec, started }); the marks of
  // the others stay for notifyInterruptedRun. Called by setWorkspace before the index closes the
  // gates of the runs that did not survive (openIndex: a recovered run's gate is not "interrupted").
  function claimLiveRuns() {
    let marks = [];
    try { marks = [].concat(JSON.parse(fs.readFileSync(ctx.ws.activeRun, 'utf8'))).filter((m) => m?.runId); } catch { /* none */ }
    const claimed = [];
    for (const mark of marks) {
      const runId = path.basename(String(mark.runId));
      const dir = path.join(ctx.ws.runs, runId);
      try {
        const events = supervisor.readEvents(dir);
        const why = notRecoverable(runId, dir, events);
        if (why) { console.warn(`run recovery: ${runId} is not recovered: ${why}.`); continue; }
        const owner = runOwner.claimRun(dir);
        // a log cut in the middle of a line: the recovered run's events start on a line of their own
        const log = path.join(dir, 'events.jsonl');
        if (!fs.readFileSync(log, 'utf8').endsWith('\n')) fs.appendFileSync(log, '\n');
        claimed.push({ runId, mark, owner, events, spec: supervisor.resumeSpec(dir, null), started: events.find((e) => e.type === 'workflow.started') });
      } catch (e) { console.error(`run recovery: ${runId}: ${e.message}`); }
    }
    // every mark stays until its run ends here or is reported (a crash before a recovered run starts
    // leaves it to the next start)
    ctx.keepInterruptedMarks(marks, { replace: true });
    return claimed;
  }

  // #809: the run died waiting in its PR monitor (its next step is the `type: pr_monitor` step it started)
  function inPrMonitor(events) {
    const next = runStateFromEvents(events).nextStep;
    return !!next && events.some((e) => e.type === 'step.started' && e.step_id === next && e.step_type === 'pr_monitor');
  }

  // Starts the claimed runs, one after the other; one that cannot start (a busy slot, low memory, the
  // budget, its workflow gone) gives its owner.json back, stays interrupted and is reported at once.
  // A run in its PR monitor needs no slot (#809): it continues even when the other runs fill them.
  async function recoverLiveRuns(claimed) {
    for (const c of claimed || []) {
      const { spec, started } = c;
      try {
        await ctx.startWorkflowRun({
          file: spec.file, inputs: spec.inputs, mock: spec.mock, projectId: spec.projectId, issues: spec.issues, agentOverrides: spec.agentOverrides,
          then: started.then || null, from: started.from || null,
          recover: { runId: c.runId, events: c.events, worktree: spec.worktree, personas: spec.personas, owner: c.owner, prMonitor: inPrMonitor(c.events) },
        });
      } catch (e) {
        c.owner.release();
        console.error(`run recovery: ${c.runId} could not continue: ${e.message}`);
        ctx.reportInterruptedRun(c.mark);
      }
    }
  }

  return {
    claimLiveRuns,
    recoverLiveRuns,
  };
};
