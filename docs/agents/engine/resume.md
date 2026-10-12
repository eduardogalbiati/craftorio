# Resume from a step

Resuming a run from a step: what the new run keeps, the service channels behind the dialog, and why a human gate always asks again.

- A resume is a new run (`resume: { runId, fromStep, steps, sessions, handoffs, instruction, worktree }`
  in `WorkflowRun`): the previous steps' outputs and visits, the agents' provider sessions and handoff
  notes, and the run's worktree/branch (a removed worktree: a new one from the base). `fromStep` must
  exist in the current version of the workflow; the instruction becomes that step's note.
- Service: `resumeRun({ runId, step, instruction, mock })` on the `runs:resume` channel
  (`supervisor:resume` is an alias for older clients). No LLM call: the owner's **Resume from step…**
  dialog and the supervisor's recommendations both use it. `mock: true` resumes as a simulation; a
  simulated run always resumes as one; simulation-only refuses a real resume. An active run is refused.
- `runs:resumeOptions({ runId })` feeds the dialog: the steps in order (visits, `blockedBy`), where the
  run stopped, the failed step, the suggested step, the worktree (and whether it still exists), the
  agents with sessions/handoffs.
- **Gates**: a resume never reuses a human gate's decision. A step after (in the workflow's order) a
  `human_approval` step the previous run decided is refused (`supervisor.skippedGate`): resume from
  the gate, which asks again. Gate outputs are dropped from the kept outputs
  (`supervisor.withoutGateDecisions`), so every gate reached again opens again.
