# Factor 6: Launch, pause, resume with simple APIs

## The factor

An agent should be startable by a program, pausable when it needs something slow or a human, and
resumable from where it stopped, through plain APIs. The point of a pause is that no process waits:
the state is saved, and an event later brings it back. ([factor 6](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-06-launch-pause-resume.md))

## In this project

- **Launch.** A run starts from the app, from the CLI (`npm run run -- --file <wf> --input ...`),
  from the engine server in a browser (`npm run serve`), from a roadmap stage, from another run's
  `then:` (chaining, #134) or from a repository's `.multiagent/project.yaml`. All go through the same
  service channels (`src/service/channels/`).
- **Pause after the current turn** (#368, `decisions.md` 2026-10-13). `run:pause` sets `pausing`;
  nothing is aborted. The turns in progress and any running command finish, the step loop ends the
  run `paused`, the worktree is kept as it is (uncommitted work included), sessions and handoff
  notes are recorded. A run waiting at a gate pauses at once and the gate asks again on resume. A
  pause never answers a gate.
- **Resume** (`runs:resume`, `src/engine/run/resume.js`). A paused run continues where it paused:
  every visited step is seeded from the summary, no finished turn runs again, and the outputs end as
  an uninterrupted run's. A stopped or failed run can be resumed **from any step** (#100): the new
  run keeps the previous steps' outputs and visits, the agents' provider sessions and handoff notes,
  and the worktree or branch. `runs:resumeOptions` feeds the dialog (steps, where it stopped, the
  suggested step, the cold-cache cost of each agent's next turn, #320).
- **Human gates always ask again.** A resume never reuses a gate's decision; a step after a decided
  gate is refused, resume from the gate instead (`supervisor.skippedGate`). Only the owner resumes a
  paused run: the Oracle, the Night watch and the supervisor are refused (`refusePausedResume`).
- **No process blocks on a human.** A gate is an event (`approval.requested`) plus a row the
  phone page, the app and the notifications read; the answer comes back as `approval:resolve` from
  the app or `answerPhoneGate` from a paired phone, minutes or hours later.

## Gaps

- **A crash is not a pause.** If the app dies mid-turn (the machine sleeps, the process is killed),
  the run owner's heartbeat goes stale (`src/domains/run/run-owner.js`, 30 s) and the run is marked
  `interrupted`; its gates are closed as `interrupted` at startup. Resuming is the owner's action
  (#288 made it reachable from the run chat), and the turn that was in progress is lost. The factor
  wants the run to come back by itself at the last finished turn; that needs factor 12 (#566).
- **Resume is a new run.** A resumed run gets a new id and seeds itself from the old one. Analytics
  and the runs list link them, but a run's story is spread over two folders. Acceptable today;
  a reducer over one event log would make it one.

## References

- [12-Factor Agents, factor 6](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-06-launch-pause-resume.md)
- `docs/agents/engine/resume.md`: what a resume keeps, the channels, why gates ask again
- `docs/agents/engine/gates-and-run-end.md`: "Paused"
- `docs/agents/decisions.md`, 2026-10-13 (#368)
