# Factor 5: Unify execution state and business state

## The factor

Keep the agent's progress (which step, which attempt, what it is waiting for) and the application's
own data (the order, the ticket, the pull request) in one place, or at least derivable from one
place. Two stores drift; one event log that both read from does not. Simpler infrastructure, easier
debugging, easier resume. ([factor 5](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-05-unify-execution-state.md))

## In this project

- **Files are the source of truth.** A run is `runs/<id>/`: `events.jsonl` (every event),
  `summary.json`, `meta.json`, `sessions/`, `handoffs/`, `decisions.tsv`, `evidence/`,
  `attachments/`. Plain files the owner, the agents and the supervisor can read; portable between
  machines. The SQLite index only speeds up listings and is rebuilt from the files
  (`docs/agents/storage.md`, "Files are the source of truth"; rule: never make the database the only
  copy of something a run produced).
- **Old runs are upgraded on read, never rewritten.** `readRunRecord` returns a run in the current
  shape through a pure, idempotent `upgradeRunRecord` (`src/shared/run-record.js`, #350); readers
  never branch on an older shape. The file keeps the shape it was recorded in, forever.
- **Business state lives where the business is.** Issues belong to GitHub or GitLab; everything
  local is a read-only replica, and no issue change flows from local data to the platform (#168).
  A run's pull request, branch and commits are in git. A discovery card is a folder with its
  document, versions and thread (`discovery/<project>/cards/`).
- **Decisions are data.** Every gate answer is an `approval.resolved` event with who, what, how long
  it waited and from which device; every supervisor intervention is a `supervisor.decision` event
  and a row in `decisions.tsv`. The run chat, the timeline and Analytics are views over the same
  events.

## Gaps

- **The live run state is in memory.** While a run is going, its current step, its `vars`, the
  visit counters, the open gate and the `pausing` flag live in the `WorkflowRun` object
  (`src/engine/run/`). The events record what happened, and `summary.json` is written at the end, but
  the engine does not read its own state back from them. This is the same gap as factor 12, seen
  from the storage side: the run folder tells the story, but it is not what the engine runs on
  (#566).
- **Two time scales for the summary.** `summary.json` exists only when the run ends; a reader of a
  live run (the runs list, a resume dialog) rebuilds what it needs from the events. That works, but
  it is a second code path for the same facts.

## References

- [12-Factor Agents, factor 5](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-05-unify-execution-state.md)
- `docs/agents/storage.md`: files vs the index, the run record upgrades, issues as a replica
- `docs/agents/channels.md` (generated): the event and channel schemas
