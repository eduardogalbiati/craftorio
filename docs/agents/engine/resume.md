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
- **A paused run** (#368, status `paused`): `runs:resume` without a step continues where it paused
  (summary.json `paused.step`): every step it visited is seeded from its summary (`resume.paused`:
  seedResume seeds the resumed step's finished visits too), so no finished turn runs again and the
  outputs end as an uninterrupted run's; the gates the owner answered before the pause are kept (it is
  the same work going on), the gate it waited at asks again. A resumed run yields once before its
  first step, so its starter hears that gate. `resumeOptions` gives `paused: { step, next, at, turns }`
  (turns: each agent's next turn, #320, a cold cache with its `cold_resume_usd`) for the confirmation.
  The roadmap's Start/Resume resumes its paused items first (areas/roadmap.js `resumePausedItems`). Only
  the owner resumes one: the Oracle's actions and `supervisor:resume` are refused
  (`refusePausedResume`), and the Night watch's `resume-paused` is never allowed.
- **Gates**: a resume never reuses a human gate's decision. A step after (in the workflow's order) a
  `human_approval` step the previous run decided is refused (`supervisor.skippedGate`): resume from
  the gate, which asks again. Gate outputs are dropped from the kept outputs
  (`supervisor.withoutGateDecisions`), so every gate reached again opens again. An agent's own
  question (#567, `needs_human` on an `ask_human` step) is never taken as answered: the answer is
  not kept (`humanAnswer` lives only in the running run), so a resume at that step runs the agent
  again and it asks again.
- **The state from the log** (#606): `runStateFromEvents(events, summary)` (`engine/run/resume.js`)
  is a pure function of a run's `events.jsonl` (and `summary.json`) giving
  `{ nextStep, visits, vars, sessions, handoffs, openGate }`, the same as the run held in memory:
  visits are the highest `step.started` visit per step, less the visit a cut or a pause left
  unfinished; `nextStep` is null once finished, else `summary.paused.step`, the gate left open, or
  the step started or routed to last; `vars` come from `step.transition.set`; sessions are each
  agent's latest persistent one (never the orchestrator's); handoffs each agent's latest note; the
  open gate an `approval.requested` with no `approval.resolved`. It reduces the longest real run
  (4117 events, 5.4 MB) in under 1 ms (parsing the file takes ~30 ms), so the engine keeps its
  in-memory state while running and reads it back only at start-up; a per-step reducer is a follow-up.
- **Recovery vs resume** (#607). *Recovery* is the app continuing a run it died in, by itself, at
  start-up (`setWorkspace`: the app and `npm run serve`; `service/areas/recover.js`): a run the
  active-run marker names, without `summary.json`, `interrupted`, whose `owner.json` heartbeat is
  stale, continues **in its own folder with its own id** (and so its own worktree) at its last
  finished turn, with no dialog. `recoveryStateFromEvents` adds to the state above each step's last
  output, each session's last snapshot (turns, tokens, cost: `summary.json` adds up the same
  figures as a run without a crash), the event/session/gate counters and the turns the crash cut
  (several in an `agents:` step). The run records `run.recovered { step_id, after_seq, gate,
  lost_turns }`, never a second `workflow.started`; in the reduction it closes the gates opened
  before it, so a second recovery never asks a gate the first one already asked again and the owner
  answered. The gate it waited at asks again with a new id (the recovery never answers
  it; `openIndex({ recovering })` does not close it as interrupted). Each cut turn is recorded as a
  `session.attempt_stopped` (#233: its stream's usage priced, else `cost_usd: null`,
  `cost_not_recorded`), its ephemeral session closes, and that agent's next turn of the step gets
  the `<previous_attempt>` block (factor 9) after its prompt. A persistent session continues on the
  account that opened it (#312); an account gone since leaves it behind and the agent starts from its
  handoff note. A run the Backlog queue started (`workflow.started.from_queue`) still pauses the
  queue when it fails after a recovery (#445). A run that cannot start again (a busy slot, low
  memory, the budget) gives `owner.json` back, stays `interrupted` and is reported at once. Never a second copy: a run another live
  process owns is left (#112); the process claims `owner.json` in the same tick as the check, so a
  second service started next sees it alive. Not recovered: real runs under
  `MULTIAGENT_SIMULATION_ONLY=1`, child runs (their parent's step runs them again), finished runs;
  they stay `interrupted` and are reported. Known gaps: `max_visits` counters and the step timing
  start from zero, and a mock run's simulated answers count from the first again.
  *Resume from step* stays the owner's path: a new run with a new id, refused while the run is live
  (a recovered one included), working once it ended.
