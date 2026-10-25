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

## Gaps

This is the one factor the app does not follow, and the gap behind factors 5 and 6.

- **The run runs in an object.** `WorkflowRun` holds the current step, `vars`, visit counters, the
  open gate, the live turns and the `pausing` flag in memory for the whole run. The events are a
  faithful record of what it did, but the engine never derives its next move from them. A crash
  leaves the run `interrupted`; the owner picks a step in the Resume dialog; the resumed run is a new
  one (factor 6).
- **What a reducer would change.** If the engine rebuilt the run state from `events.jsonl` before
  each step (the step to run, its visit count, `vars`, the sessions to continue, the gate to reopen),
  then: a restart of the app would continue every live run at its last finished turn with no
  dialog; a run could move to another machine with its folder; a test could replay a real run's
  events against a new engine version; the resume-from-step dialog would become "truncate the log
  here and continue". The pieces exist: the pure `upgradeRunRecord` shows the style, the pause
  logic already knows that a turn is the unit nothing cuts, and `seedResume` already maps recorded
  facts to engine state.
- **What stays as it is.** A turn in progress is still lost on a crash: the CLI session is the
  provider's, and the engine cannot replay half a turn. The reducer resumes at the last `step.finished`
  or `turn.finished` event, which is what the pause does today.

Tracked as #566 under the epic #565; the highest-value gap in this guide, because the Night watch runs unattended and a sleeping laptop should not cost a night's work.

## References

- [12-Factor Agents, factor 12](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-12-stateless-reducer.md)
- `docs/agents/storage.md`: "Old runs: the run record upgrades them on read"
- `docs/agents/engine/resume.md`, `docs/agents/decisions.md` 2026-10-13 (#368, pause)
