# Factor 12: Make your agent a stateless reducer

## The factor

An agent is a function: `(state, event) → new state`. Keep the state outside the process (a
database row, an event log), feed it the next event (a model answer, a tool result, a human's reply,
a timer), and write the new state back. A process that holds the state in memory cannot be
restarted, moved or replayed; a reducer can. ([factor 12](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-12-stateless-reducer.md))

## In this project

- **The event log exists.** The recorder (`src/engine/recorder.js`) writes every event of a run to
  `runs/<id>/events.jsonl` synchronously, so a reader that sees `workflow.finished` finds every event
  before it. Step outputs, visits, gate requests and answers, supervisor decisions, session starts
  and costs are all events.
- **Readers already reduce.** `upgradeRunRecord` (`src/shared/run-record.js`, #350) is a pure,
  idempotent function over `{ summary, events }` that the run list, Analytics and the renderer use
  to show a run in the current shape, old files included. `resumeOptions` rebuilds where a run
  stopped from its files.
- **Resume seeds a run from recorded facts.** A resumed run takes the previous steps' outputs and
  visits, the sessions and the handoff notes from the files (`seedResume` in
  `src/engine/run/resume.js`).
- **The resume state is a function of the log** (#606). `runStateFromEvents(events, summary)`
  (`packages/engine/engine/run/resume.js`) is pure and gives the step to run next, the visits,
  `vars` (recorded as `step.transition.set`), the sessions, the handoff notes and the open gate; a
  replay of each bundled workflow's mock run gives the state the in-memory run held.
- **A restart continues live runs by itself** (#607). At start-up the service reduces the log of
  each run the app died in (`recoveryStateFromEvents`, the same function plus each step's output,
  each session's last snapshot and the turn the crash cut) and continues it in its own folder with
  its own id at its last finished turn, with no dialog: the gate it waited at asks again, the cut
  turn is recorded as a stopped attempt and its agent's next turn gets `<previous_attempt>`. A run
  another live app owns is never taken over (#112). See `docs/agents/engine/resume.md`.

## Gaps

- **The state is read back at start-up only.** `WorkflowRun` still holds the current step, `vars`,
  visit counters, the open gate and the live turns in memory while it runs; the log is reduced once,
  when a restart recovers the run. A per-step reducer (the engine derives each next move from the
  log) would also let a run move to another machine with its folder and turn the resume-from-step
  dialog into "truncate the log here and continue". It is a follow-up: the recovery gives the
  owner-facing gain (no lost night) with the smaller change.
- **What the recovery does not rebuild.** The `max_visits` loop counters and the step timing start
  from zero in the recovered process; a mock run's simulated answers count from the first again.
- **What stays as it is.** A turn in progress is still lost on a crash: the CLI session is the
  provider's, and the engine cannot replay half a turn. It is reported, not hidden: a stopped
  attempt with what its stream reported, and the files and commits on the branch for the next turn.

Covered by #607 (recovery at start-up), after #606 (the state from the log), under the epic #565.

## References

- [12-Factor Agents, factor 12](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-12-stateless-reducer.md)
- `docs/agents/storage/files.md`: "Old runs: the run record upgrades them on read"
- `docs/agents/engine/resume.md`, `docs/agents/decisions.md` 2026-10-13 (#368, pause)
