# Factor 3: Own your context window

## The factor

Everything the model sees is context engineering: the prompt, the history, the tool results, the
errors. Do not accept the chat-message format a framework hands you; decide what goes in, in what
shape, and how much. A context window that is small, dense and well-ordered beats a long transcript.
([factor 3](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-03-own-your-context-window.md))

## In this project

- **Session modes decide what an agent remembers.** An agent is `persistent` (one conversation for
  the whole run, with `defaults.max_context`), `ephemeral` (a fresh session every turn) or `handoff`
  (a fresh session per turn, started from the agent's own handoff note). `SESSION_MODES` in
  `src/engine/run/field-rules.js`; the choice per role is in `workflows/software-development.yaml`
  (the developer is `handoff`, the deployer `persistent`, the evidence writer `ephemeral`).
- **Handoff notes are the compressed history.** At the end of a turn an agent that comes back
  writes a `handoff` block of at most 250 words (Goal, State, Done, Left, Decisions, Key files,
  Known problems), pointing to files and commits instead of pasting code. The engine removes it from
  the answer, saves it in `runs/<id>/handoffs/` and opens the next fresh session from it
  (`HANDOFF_INSTRUCTIONS`, `saveHandoff`, `requestHandoffNote` in `src/engine/run/sessions.js`).
- **Budgets on context, not just on money.** `orchestrator.limits.max_total_context` pauses the run
  at a gate once its agents have read that many tokens (`contextGate` in `src/engine/run/costs.js`);
  `max_requests` cuts a turn and asks for one wrap-up request, then continues in a fresh session
  from the note (#302). `max_context` on a persistent agent restarts its session from the note when
  the conversation grows past it.
- **Tool results are summarised before they reach the next prompt.** Test results go in as counts,
  the failures with their first three lines and the log's path (`testResultsPrompt`); a check step
  shows the command's last lines (`src/engine/check-step.js`); a failed attempt becomes a short
  `<previous_attempt>` block (factor 9).
- **Exploration is delegated.** The developer runs with `subagents: true` so code mapping happens in
  sub-agents and the main context stays small; the `context-economy` skill tells agents how to read
  a codebase without filling their window.
- **What is kept on disk is redacted first.** Every string the recorder writes goes through the
  redaction baseline (`src/engine/redact-baseline.js`, #475) and the workflow's
  `observability.capture.redact` rules, so a handoff note or an event re-read into a later context
  never carries a token.

## Gaps

None open. Two things to keep in mind when writing a workflow:

- A `persistent` agent accumulates every tool result of the run until `max_context`; prefer
  `handoff` for a role that comes back many times (the developer, the CI pusher).
- Templates can pull a lot into a prompt (`git_log_stat`, the whole `steps.*.output`); the `one_line`
  and `issue_lines` filters exist to keep gate messages and prompts short.

## References

- [12-Factor Agents, factor 3](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-03-own-your-context-window.md)
- `docs/agents/engine/agents-and-steps.md`: sessions, `max_context`, `max_requests`
- `skills/context-economy/SKILL.md`
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
