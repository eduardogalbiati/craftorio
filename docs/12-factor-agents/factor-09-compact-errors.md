# Factor 9: Compact errors into the context window

## The factor

When a step fails, do not dump the stack trace into the next prompt and hope. Put a short, dense
account of what went wrong where the model will see it, let it try again, and count the failures:
after a few in a row, stop looping and escalate to a human or a different path. ([factor 9](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-09-compact-errors.md))

## In this project

- **A failed attempt becomes a short block.** When a turn is retried, `attemptSummary` in
  `src/engine/run/turns.js` writes a `<previous_attempt>` section: why it stopped (one line), the
  last tool calls with their first output line, and the instruction to continue from there (keep the
  files and commits, do not re-run what is listed). Not the transcript.
- **A schema error is quoted, once.** `retryPrompt` (`src/engine/run/outputs.js`) sends the
  validation errors and the schema back and asks for the same content in a valid shape; a second
  failure fails the step and calls the supervisor.
- **A failed action travels as data.** When a transition's `action`, `merge: local` or `precheck`
  fails, the run goes to `on_error` with `action_error: { step, message, at, check, head, supervisor,
  diagnosis }` in the template context; the step's prompt shows the supervisor's explanation and
  instruction, not the raw error.
- **Tool output is cut to what matters.** A check step shows the command's last lines (the log keeps
  all of it, `src/engine/check-step.js`); the suite step gives the failing tests with their first
  three lines and the log's path; pre-existing failures on the base are moved out of the way
  (`preexisting`, #211) so the agent does not chase them.
- **Failures are counted and escalated.** The stall check (`checkStalls`,
  `src/engine/run/supervision.js`) spots the same decision 3 visits in a row, 5 refused tool calls
  in a row, a visit 3× slower than its usual, and a `/loop` blocked `max_blocked` times; each wakes
  the supervisor, which may `retry`, `resume` with an instruction or ask the owner. The retry policy
  per agent (`src/engine/run/turns.js`) and the fallback chain per provider (#262) bound how many
  times a turn is attempted; quota errors wait for credits instead of retrying.

## Gaps

None open. Two notes for workflow authors:

- `attemptSummary` shows the last `ATTEMPT_CALLS` tool calls; a turn that failed after a long
  exploration loses the early ones. The handoff note is the place where the agent keeps what it
  learned.
- The compaction is per failure kind (attempt, schema, action, suite). There is no single "error
  budget" per agent across kinds; the supervisor's `max_interventions` per step plays that role.

## References

- [12-Factor Agents, factor 9](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-09-compact-errors.md)
- `docs/agents/engine/providers.md`: retries, fallback chains, quota waits
- `docs/agents/engine/gates-and-run-end.md`: stalls, refused tool calls, `on_error` and `recover`
