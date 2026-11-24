# Sessions and handoff notes

Session modes (persistent, ephemeral, handoff), handoff notes, context and request limits, the prompt cache, turn metrics and costs, idle agents.

- `session` (agent or `defaults`): `persistent` (default, one conversation per run), `ephemeral`
  (fresh session per turn, only the prompt) or `handoff` (fresh session per turn that starts from
  the agent's latest handoff note). `loadWorkflow` rejects other values.
- Persistent and handoff agents are asked, at the end of each step/delegation turn (not schema
  retries), for a ```` ```handoff ```` block (goal, state, done, left, decisions, key files, known
  problems). `invokeTurn` removes it from the answer (`takeHandoff`), so outputs, templates and
  chats never see it; `saveHandoff` writes `runs/<id>/handoffs/<step>-v<visit>-<agent>.md`
  (`:` in delegation step ids becomes `-`; a 2nd turn of the same visit gets `-2`) and emits
  `handoff.saved` (with the `note`).
- A fresh session of an agent that already has a note (handoff mode, a rotation, or a resumed run)
  gets `<system>…</system>`, then `<handoff_note>…</handoff_note>`, then the prompt.
- **The repository's instructions** (#45, `sessionInstructions`): an isolated Claude session of an
  agent in a repository gets `runs/<id>/instructions/<session>.md` on every turn; its record lists
  the files (`instructions`), with a `log` `kind: instructions` (capabilities.md, Project instructions).
- **The Language line** (#327, #328): `agentTurn` adds one `[Language]` line to every turn, for
  every CLI (`languageLine` in `packages/shared/language.js`, from the WorkflowRun `language` option,
  read at each turn: a change in Settings › Language applies from the next turn). It names the AI
  agents language (prose, notes, documents) and the issues language (issues, PR/MR descriptions,
  commit messages), and keeps JSON keys, enum values, paths, branches, labels and `Closes #n` as
  they are; when both are English it is one short line (the develop prompt's 40K budget). Its
  text only changes with the setting, so the prompt cache holds. It is not part of
  the step prompt, so retries and test requests that resend the prompt do not repeat it. The
  output instruction (`outputInstruction`), the schema retry (`retryLanguage`) and the handoff
  request name English when unset (today's text) and otherwise ask for prose in the agents
  language with keys and enum values exactly as the schema names them (#94).
- When the next turn needs the note (handoff mode, or a rotation) and the answer has none, one
  follow-up turn in the same provider conversation asks only for it (`HANDOFF_ONLY`); if that fails
  too, a fallback note is built from the answer.
- `max_context` (e.g. `150k`, agent or `defaults`): a persistent turn whose largest request went
  above it marks the agent; its next non-retry turn opens a new session (the old one is closed) and
  starts from the note. Logged as `log` `kind: context_rotation`. Never cuts a turn.
- `fresh_after_idle` (#247, a duration such as `55m`, agent or `defaults`): a persistent agent's
  non-retry turn that comes longer than that after its previous turn ended (a long gate wait, past
  the prompt cache's lifetime) opens a new session from its handoff note instead of resuming a cold
  conversation; without a note it resumes. Logged as `log` `kind: idle_rotation`. Since #320 every
  bundled workflow with a persistent agent sets `fresh_after_idle: 55m` in `defaults:` (Claude's
  hour minus a margin); an agent's own value wins.
- **The prompt cache's state** (#320, `packages/engine/domains/session/session-cache.js`, the same module as
  `packages/shared/session-cache.js`): `cacheLifetimeMs(provider, { auth, tier })` is the one lifetime
  (Claude 1 h on a subscription, 5 min with `ANTHROPIC_API_KEY`, a tier the usage reports in
  `cache_creation.ephemeral_1h/5m_input_tokens` wins; Codex and Grok `null`, unknown); the Oracle's
  `WARM_MS` is it minus `CACHE_MARGIN_MS`. A simulated run keeps the subscription's hour. Each
  session snapshot carries `last_turn_at`, `context_tokens` (the last request's context),
  `start_context_tokens` (its first turn's start: the estimate of a fresh start), `has_note`,
  `fresh_after_idle_ms`, `cache_lifetime_ms`, `cold_resume_usd` (writing the context again at the
  run's prices, when the model has one) and `next_turn` (`nextTurn`: `fresh` | `warm` with `until`
  | `cold` with `since` and `tokens` | `resume` (unknown lifetime) | `new`; null when closed). A
  persistent agent's turn ends with a `session.updated` event (the snapshot after its note was
  saved); `readRun` rebuilds the same state from the events, and `sessionView` adds `nextTurn`
  computed at read time.
- `max_requests` (#302, a whole number such as `40`, agent or `defaults`, may be templated): a
  request budget per turn, passed to Claude Code as `--max-turns <n>`; Codex and Grok cannot
  enforce it (noted in the `capabilities:` log line). A turn that ends on it (`error_max_turns`)
  produces no output: `session.message_received` carries `cut: true` and `requests`, a `log`
  `kind: context_budget` (agent, step, requests, context peak) is emitted, and one wrap-up request
  (`WRAP_UP`: commit what is consistent, then only the handoff block; `--max-turns 10`) resumes the
  same CLI session; its cost counts in the cut turn's record. The session is closed and the same
  step visit continues in a fresh session (the note, then "continued after N requests", then the
  step's prompt); the continuation's answer is the step's output. Not an attempt, a retry or a
  stall; the third cut of one visit (`MAX_CUTS`) fails the step with "the budget was reached 3
  times". Each session's note is its own handoff file (`-2`, `-3`…), each session a fresh session
  of the visit in `summary.context` (`per_turn` marks the cut ones). Simulation:
  `mockSequences.request_budget: { <step>: n }` cuts the first n turns of that step.
  ai-development-local-hero sets 40 for the developer.
- Metrics: every turn is a `turnLog` record (context at the first request, peak, tokens, waste:
  `refused` = every tool call refused, `blocked` = a blocked `/loop` iteration);
  `summary.context = { agents: { <name>: { turns, fresh_sessions, tokens, peak, waste_tokens, per_turn } }, waste_tokens }`.
  `session.message_received` carries `context: { start, peak }` and `handoff`.
- Costs (#233): a turn's `cost_usd` is its own: Claude's `total_cost_usd` is cumulative over a
  resumed CLI session, so `parseClaude` subtracts the session's previous total. An attempt stopped
  before its result (timeout, cancel, crash) keeps the tokens of its model calls (`err.partial`,
  summed from the stream), priced with the run's `prices` (`countStoppedAttempt`): a
  `session.attempt_stopped` event (`estimated: true`, or `cost_not_recorded` without a price), its
  cost in the session (`estimated_cost_usd`), the step's record, the run and `max_total_cost_usd`;
  the `attempt N/M failed` log line says what it cost. `workflow.started` and the summary carry
  `cost_accounting: 'per_turn'`; runs without it are read corrected by the run record's upgrades
  (`packages/shared/run-record.js`, #350).
- Several `result` events in one Claude turn (#277): a turn that used sub-agents (the `Agent` tool)
  ends with 2 to 4 `result` events one ms apart, all with the same (or a growing) session
  `total_cost_usd`. `parseClaude` records the turn's cost once: the highest total seen in the turn
  minus the session's total before the turn (a later event never lowers it; `--resume` and forked
  sessions as above). Their usages overlap (the total does not grow with the later, smaller ones), so
  the main conversation's tokens (`usage_main`) are the largest of each field. The raw `result`
  events of such a turn are kept as `raw` items of `session.stream`. The summary carries
  `turn_cost: 'max_result'`; a per-turn run without it is read (upgrade `#277 multi-result turn` in
  `packages/shared/run-record.js`) with each turn
  at the highest cost among its `usage` stream items when that is more than its recorded `cost_usd`
  (the files are never rewritten).
- A turn's tokens (#308): `session.message_received.usage` is everything the turn paid for, as its
  `cost_usd`. Per provider:
  - Claude: the sum of the stream's distinct model calls (the main conversation's and the
    sub-agents', messages with `parent_tool_use_id`), never below the `result`'s figures field by
    field (a stream that lost messages falls back to them; `reasoning` 0). `usage_main` = the
    `result`'s figures (the main conversation, the #277 rule above); `subagents` = `{ calls, usage }`
    of the sub-agents' calls, absent when the turn started none; `model_calls` = the turn's distinct
    model calls. The `context` stream items stay the main conversation's (a sub-agent's window is not
    the agent's).
  - Codex and Grok: `usage` is what their CLIs report for the turn; they give no sub-agent figures,
    so `usage_main`, `subagents` and `model_calls` are absent (never zero).
  Events recorded before #308 have `usage` = the main conversation only and none of the new fields;
  readers (Analytics, the 3D view, the run report) read `usage` either way. `subagent_calls`
  (capabilities.md) is a different field: the sub-agent tool calls counted from the stream.
- Idle agents (`packages/engine/engine/idle.js`, #46): an agent with no stream item for `idleWarnMs` (setting
  `idleWarningMinutes`, default 5, 0 = off) while a tool call is open → one `log` warn
  `kind: agent_idle` per silence, with `step_id`, `agent`, `tool`, `command`, `idle_ms` (run log,
  run chat, supervisor timeline). Each turn is split into `active_ms` (the model) / `waiting_ms` (a
  tool call open) / `stalled_ms` (silent waiting past the threshold) on `session.message_received`,
  summed per step in `summary.timing = { steps: { <id>: { turns, duration_ms, active_ms, waiting_ms, stalled_ms } }, ...totals }`.
  Codex reports a command only when it ends, so its waits count as active. On a step's turn, with
  `orchestrator.supervisor` on, the warning also wakes the supervisor (`superviseIdle`,
  `supervisor.IDLE_SCHEMA`, `idlePrompt` with the command): `supervisor.started`/`supervisor.decision`
  with `kind: idle`, action `wait` (nothing happens) or `interrupt` (the turn's own AbortController
  stops it, `log kind: agent_interrupted`, and the step runs again with the instruction as the
  supervisor note, without a second supervisor call). Idle checks count against `max_total` only.
  Simulate with `mockSequences.slow_tools: { step: ms }` and `action: ['interrupt', 'wait']`.
- Servers in the foreground (#853, `stopForegroundServer` in `run/turns.js`): a `Bash` tool call
  without `run_in_background` whose command is a dev server or watcher (`isServerCommand`,
  `packages/engine/engine/server-commands.js`: `next dev`, `vite`, `pnpm dev`, `--watch`...) and that
  has no `tool_result` after `serverForegroundMs` (`SERVER_FOREGROUND_MS` = 90 s, next to
  `IDLE_WARN_MS`; 0 = off) has only that server's process tree stopped: `stopServerTree`
  (`processes.js`) looks under the agent CLI's pid (`onSpawn`) for the highest descendant whose command
  line holds the command (or is a server), never the CLI itself nor anything outside its tree. The
  Bash call returns with an error and the agent goes on in the same turn: no interrupt, no step
  retry, no supervisor call, so it fires well before the idle watch. Each stop is a `log` warn
  `kind: server_in_foreground` (`step_id`, `agent`, `command`, `after_ms`, `stopped: true`; run log
  and run chat) counted in `summary.servers_in_foreground`. Without the CLI's pid or a process list
  (or with no such process found) the same warning says it could not stop it (`stopped: false`, not
  counted) and the idle watch keeps its behaviour. A server started with `run_in_background` is left
  to the end-of-step `stopWorktreeProcesses`. Codex reports a command only when it ends: not guarded.
- The supervisor's decision prompt and `runReport` include the latest note per agent;
  `resumeSpec` returns `handoffs` and the resumed run starts from them.
