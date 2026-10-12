---
order: 200
---

<!-- section:engine -->
### Resuming a run from a step

A finished, failed, cancelled or interrupted run (e.g. by an app restart) can go on from any step
without asking the supervisor: **Resume from step…** in the Run view (Details), in the run's row in
**Workflows › Runs** and **Settings › Projects › Project**, and in the run chat's end-of-run note. An interrupted run (the app closed while it ran or waited at a gate, #288) ends its chat with "Interrupted at <step> (the app closed)", its cost and time so far and a primary **Resume**, which opens the dialog with that step (the gate's, when it stopped at one) preselected; a gate it left open says it was waiting when the run was interrupted, its choices are disabled, and it offers Resume too. A roadmap item whose run ended this way has **Resume run**. It is not
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
it). A run stopped by a limit (the context limit's gate, the cost or time limits) resumes at that step, and the dialog says the resumed run counts its limits from zero: it is a new run, so its own turns' context, cost and time start again (the gate asks again only once it reaches the limit). In Developer mode the dialog has the Simulation toggle; a simulated run always resumes as one.
