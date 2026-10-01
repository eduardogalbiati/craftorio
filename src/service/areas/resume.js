// Service area: resuming a run from a step (Resume from step…, the supervisor's recommendations)
// and the work an ended run kept (#112): the commits of its kept worktree, and whether the owner
// may confirm a human gate's earlier approval. Never goes past a human gate on its own.

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const runs = require('../../runs');
const supervisor = require('../../supervisor');
const { gitOut } = require('../common');

module.exports = (ctx) => {
  // Commits a run's kept worktree has on top of its base (0: none, or no worktree left).
  function runWorktreeCommits(runId) {
    const runDir = ctx.runFolder(runId);
    const ready = supervisor.readEvents(runDir).find((e) => e.type === 'worktree.ready');
    const dir = ready?.dir;
    if (!dir || !fs.existsSync(dir)) return 0;
    for (const base of [ready.base && `origin/${ready.base}`, ready.base].filter(Boolean)) {
      const n = gitOut(dir, ['rev-list', '--count', `${base}..HEAD`]);
      if (n !== null) return Number(n) || 0;
    }
    return 0;
  }

  // The newest ended run of one of these issues whose kept worktree still has commits, or null
  // (#112: starting the same issues again would redo that work; resuming that run keeps it).
  // { runId, commits, issues, message }
  function keptWorkForIssues(issues) {
    const numbers = new Set((issues || []).map((i) => Number(i?.number ?? i)).filter(Boolean));
    if (!numbers.size || !ctx.ws) return null;
    const ended = runs.listRuns(ctx.ws.runs)
      .filter((r) => r.status !== 'running' && !ctx.runAlive(r.runId) && (r.issues || []).some((i) => numbers.has(Number(i.number))))
      .sort((a, b) => String(b.runId).localeCompare(String(a.runId)));
    for (const r of ended) {
      const commits = runWorktreeCommits(r.runId);
      if (!commits) continue;
      const names = r.issues.filter((i) => numbers.has(Number(i.number))).map((i) => `#${i.number}`).join(', ');
      return {
        runId: r.runId, commits, issues: r.issues,
        message: `Run ${r.runId} (${r.status}) still has ${commits} commit(s) in its worktree for ${names}. Resuming that run keeps its work; a new run starts it again from scratch.`,
      };
    }
    return null;
  }

  // Whether the owner may confirm, at resume, the decision a run took at a human gate (#112): only
  // an approval (approved: true, or the gate's first choice, its forward one by the workflows'
  // convention, e.g. `approve`; never `changes` or `stop`), and only while the branch is still at
  // the commit approved there (a simulation has no branch: nothing can have changed).
  // { ok, approvedCommit, currentCommit, reason }
  function gateConfirmation(runDir, gate, spec, wf) {
    const evs = supervisor.readEvents(runDir);
    const requested = new Map(evs.filter((e) => e.type === 'approval.requested').map((e) => [e.approval_id, e]));
    const decided = evs.filter((e) => e.type === 'approval.resolved' && !e.withdrawn && (e.step_id || requested.get(e.approval_id)?.step_id) === gate).pop();
    const out = spec.steps[gate]?.output || {};
    if (!decided && !spec.steps[gate]) return { ok: false, reason: `the previous run has no decision at ${gate}` };
    const choices = (decided && requested.get(decided.approval_id)?.choices) || wf?.steps.find((s) => s.id === gate)?.choices || null;
    const choice = decided ? decided.choice : out.choice;
    const approval = choice !== undefined && choice !== null
      ? !!choices?.length && String(choices[0].id) === String(choice) && !choices[0].feedback_required
      : (decided ? decided.approved === true : out.approved !== false);
    if (!approval) return { ok: false, reason: `the decision at ${gate} was ${choice ?? 'a rejection'}, not an approval` };
    const approvedCommit = decided?.commit || null;
    const wt = spec.worktree;
    const currentCommit = wt?.dir && fs.existsSync(wt.dir) ? gitOut(wt.dir, ['rev-parse', 'HEAD']) : null;
    if (!wt) return { ok: true, approvedCommit, currentCommit };
    if (!approvedCommit) return { ok: false, approvedCommit, currentCommit, reason: `the run did not record the commit approved at ${gate}` };
    if (!currentCommit) return { ok: false, approvedCommit, currentCommit, reason: 'the run\'s worktree is gone' };
    if (currentCommit !== approvedCommit) return { ok: false, approvedCommit, currentCommit, reason: `the branch changed after the approval at ${gate}` };
    return { ok: true, approvedCommit, currentCommit };
  }

  // Continues a run from a step: a new run with the previous outputs, agent conversations and an
  // instruction. Called by the owner directly (Resume from step…) and by the supervisor's
  // recommendations; no LLM call. It never goes past a human gate on an earlier decision: a step
  // after a gate the previous run decided is refused, and every gate reached again asks again.
  // Only the owner, in the dialog, may confirm that decision (`confirmGate`, the gate's id, #112)
  // while the branch is still at the approved commit; it is recorded as their approval.
  // mock: true resumes as a simulation (a simulated run always resumes as one).
  function resumeRun({ runId, step, instruction, mock, confirmGate = null }) {
    const runDir = ctx.runFolder(runId);
    if (ctx.runIsLive(path.basename(runDir))) throw new Error('The run is still active: wait for it to end (or stop it) before resuming it.');
    if (ctx.runAlive(path.basename(runDir))) throw new Error(`Run ${path.basename(runDir)} is still running in another app window: resume it there, or stop it first.`);
    const spec = supervisor.resumeSpec(runDir, step);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    const wf = loadWorkflow(ctx.workflowPath(spec.file).file);
    const fromStep = step || wf.steps[0].id;
    if (!wf.steps.some((s) => s.id === fromStep)) throw new Error(`Cannot resume: step "${fromStep}" does not exist in the current version of the workflow.`);
    const gate = supervisor.skippedGate(wf, fromStep, spec.steps);
    let confirmedGate = null;
    if (gate) {
      if (confirmGate !== gate) throw new Error(`Cannot resume from "${fromStep}": it would go past the human gate "${gate}" on the previous run's decision. Resume from "${gate}" instead: it asks again.`);
      const check = gateConfirmation(runDir, gate, spec, wf);
      if (!check.ok) throw new Error(`Cannot confirm ${gate} again: ${check.reason}. Resume from "${gate}" instead: it asks again.`);
      confirmedGate = { step: gate, commit: check.currentCommit };
    }
    const steps = supervisor.withoutGateDecisions(wf, spec.steps);
    if (confirmedGate) steps[gate] = spec.steps[gate];
    return ctx.startWorkflowRun({
      file: spec.file, inputs: spec.inputs, mock: spec.mock || mock === true, projectId: spec.projectId, issues: spec.issues,
      resume: { runId: spec.runId, fromStep, steps, sessions: spec.sessions, handoffs: spec.handoffs, instruction: instruction || null, worktree: spec.worktree, confirmedGate },
    });
  }

  // What the Resume from step… dialog shows: the workflow's steps in order (reached, where the run
  // stopped, the steps a decided gate keeps out of reach), the suggested step and what is kept.
  function resumeOptions({ runId }) {
    const runDir = ctx.runFolder(runId);
    const id = path.basename(runDir);
    const spec = supervisor.resumeSpec(runDir, null);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    let wf;
    try { wf = loadWorkflow(ctx.workflowPath(spec.file).file); } catch (e) { throw new Error(`The run's workflow (${spec.file}) cannot be loaded: ${e.message}`); }
    const visits = {};
    let stoppedAt = null;
    let failedStep = null;
    for (const ev of supervisor.readEvents(runDir)) {
      if (ev.type === 'step.started') { visits[ev.step_id] = (visits[ev.step_id] || 0) + 1; stoppedAt = ev.step_id; }
      if (ev.type === 'step.finished' && ev.error) failedStep = ev.step_id;
    }
    const status = ctx.runIsLive(id) ? 'running' : runs.readRun(ctx.ws.runs, id)?.status || 'interrupted';
    // a step after a decided gate: allowed when the owner confirms that gate again (#112), see gateConfirmation
    const confirmations = new Map();
    const confirmationOf = (gate) => {
      if (!confirmations.has(gate)) confirmations.set(gate, gateConfirmation(runDir, gate, spec, wf));
      return confirmations.get(gate);
    };
    const steps = wf.steps.map((s) => {
      const blockedBy = supervisor.skippedGate(wf, s.id, spec.steps);
      return {
        id: s.id, type: s.type || 'agent', gate: s.type === 'human_approval', visits: visits[s.id] || 0,
        blockedBy, confirm: blockedBy ? confirmationOf(blockedBy) : null,
      };
    });
    const allowed = (x) => steps.some((s) => s.id === x && (!s.blockedBy || s.confirm?.ok));
    // where the run stopped, else the nearest allowed step before it; never the first step by default
    const stoppedIdx = steps.findIndex((s) => s.id === stoppedAt);
    const before = stoppedIdx > 0 ? steps.slice(0, stoppedIdx).reverse().find((s) => allowed(s.id))?.id : null;
    const suggested = [status === 'failed' ? failedStep : null, stoppedAt, failedStep, before].find(allowed) || steps.find((s) => !s.blockedBy)?.id || null;
    const wt = spec.worktree;
    return {
      runId: id, workflow: wf.metadata?.name || spec.file, file: spec.file, status, active: status === 'running', mock: spec.mock,
      steps, stoppedAt, failedStep, suggested,
      worktree: wt ? { dir: wt.dir, branch: wt.branch, exists: fs.existsSync(wt.dir) } : null,
      sessions: Object.keys(spec.sessions), handoffs: Object.keys(spec.handoffs),
    };
  }

  return {
    keptWorkForIssues,
    resumeOptions,
    resumeRun,
    runWorktreeCommits,
  };
};
