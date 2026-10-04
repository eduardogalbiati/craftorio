---
order: 200
---

<!-- section:engine -->
### Resuming a run from a step

A finished, failed, cancelled or interrupted run (e.g. by an app restart) can go on from any step
without asking the supervisor: **Resume from step…** in the Run view (Details), in the run's row in
**Workflows › Runs** and **Settings › Projects › Project**, and in the run chat's end-of-run note. It is not
offered while the run is active, and it makes no LLM call.

The dialog lists the workflow's steps in order, marks the ones the run reached and where it stopped,
and pre-selects that step (or the failed one). An optional **Instruction for the agents** goes to
the chosen step. It says what is kept (the previous steps' outputs, the agents' sessions and handoff
notes, the worktree and branch, or a new worktree from the base when it was removed) and what runs
again (the chosen step and the steps its transitions lead to). The resume is a new run.

Human gates are never crossed by automation: every gate reached again asks again, and a step after
a gate the run already decided is refused (resume from the gate instead), unless you tick **Approve
<gate> again** in the dialog. That box shows the commit approved at the gate and the branch's
current commit, and is only offered while they are the same; your confirmation is recorded in the
new run as your approval ("confirmed at resume"). The supervisor and the roadmap never confirm a
gate. The dialog pre-selects the step where the run stopped (or the nearest allowed step before
it). In Developer mode the dialog has the Simulation toggle; a simulated run always resumes as one.
