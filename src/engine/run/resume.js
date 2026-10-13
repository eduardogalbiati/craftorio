// Resume from a step (#250, from src/engine/workflow.js): what a run restarted from a stopped one
// reuses. `seedResume` (constructor) pre-seeds the previous run's step outputs, visits and
// instruction; `replayConfirmedGate` (start, #112) records the gate the owner confirmed in the
// Resume dialog as their decision; `resumeSession` continues an agent's previous provider
// conversation (#233: the CLI's running total seeded); `previousChildren` (#175) the child runs the
// previous run finished; `resumableSteps` the steps the supervisor may resume from. The worktree
// reuse is in src/engine/run/checkout.js (setupWorktree); the dialog and its channels in src/supervisor.js.

'use strict';

const { checkAttachments, seedClaudeTotal } = require('../providers');

const methods = {
  // The previous run's step outputs and visits (never the resumed step's own), its instruction as
  // the resumed step's supervisor note, and the images pasted into it (#130: checked here, copied
  // at start, given to the first agent step).
  seedResume(resume) {
    if (!this.wf.steps.some((x) => x.id === resume.fromStep)) throw new Error(`Cannot resume: step "${resume.fromStep}" does not exist in this workflow.`);
    for (const [id, v] of Object.entries(resume.steps || {})) {
      if (this.ctx.steps[id] && id !== resume.fromStep) Object.assign(this.ctx.steps[id], { output: v.output ?? null, outputs: v.output ? [v.output] : [], visits: v.visits || 1 });
    }
    if (resume.instruction) this.ctx.steps[resume.fromStep].supervisorNote = resume.instruction;
    // images pasted into the instruction (#130): checked here, copied at start, given to the first agent step
    this.resumeImages = checkAttachments(resume.images || []);
  },

  // the owner confirmed, in the Resume from step dialog, a gate the previous run decided (#112):
  // recorded as the owner's decision; automation never sets `confirmedGate`
  replayConfirmedGate() {
    const confirmed = this.resume?.confirmedGate;
    if (confirmed) {
      const out = this.ctx.steps[confirmed.step]?.output || {};
      const data = out.choice !== undefined ? { choice: out.choice } : { approved: out.approved !== false };
      this.emitEvent('approval.resolved', {
        approval_id: `resume-${confirmed.step}`, step_id: confirmed.step, ...data, by: 'owner', confirmed_at_resume: true,
        note: 'confirmed at resume', wait_ms: 0, ...(confirmed.commit ? { commit: confirmed.commit } : {}),
      });
    }
  },

  // resumed run: continue the agent's previous conversation (its system prompt is already there),
  // only for its first session in this run
  resumeSession(agentName, session, persistent) {
    this.resumeSessions ??= { ...(this.resume?.sessions || {}) };
    const previous = persistent && !this.machine.simulated &&this.resumeSessions[agentName];
    delete this.resumeSessions[agentName];
    if (previous) {
      session.providerSessionId = previous; session.turns = 1;
      // #233: the CLI's running total of that session, so the next turn costs only its own part
      seedClaudeTotal(previous, this.resume?.cliTotals?.[previous]);
    }
  },

  // The agent steps the run went through: where the supervisor may resume it.
  resumableSteps() {
    return this.wf.steps.filter((s) => s.type !== 'human_approval' && this.ctx.steps[s.id]?.visits > 0).map((s) => s.id);
  },

  // A resumed run (#175): the children the previous run started for the step it resumes from, by item
  // index ({ <index>: { run_id, status, label } }, the latest per index), the first time it runs that step
  // only (a later visit starts its children afresh); null when there are none.
  previousChildren(step) {
    const r = this.resume;
    if (!r?.childRuns?.length || r.fromStep !== step.id || this.previousChildrenUsed) return null;
    this.previousChildrenUsed = true;
    const out = {};
    for (const c of r.childRuns) if (c.step_id === step.id && c.run_id) out[c.index ?? 0] = { run_id: c.run_id, status: c.status, label: c.label ?? null };
    return Object.keys(out).length ? out : null;
  },
};

module.exports = {
  methods,
};
