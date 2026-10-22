# Providers

Turn timeouts, per-run agent overrides, fallback chains, limits per model, retries and other provider details.

- **The provider registry (#348)**: what differs per CLI lives in one adapter each, in
  `src/shared/providers/` (`claude.js`, `codex.js`, `grok.js`, and `mock.js` for the simulation), listed
  by `src/shared/providers/index.js`. The registry is the only place that maps the CLI names / adapter
  ids (`claude`) to the provider types of the workflow YAML (`providers.<name>.type`): `resolve(key)`
  finds an adapter by id, type, CLI name or model name (its `modelPrefixes`), `byId` / `byType` by
  exactly one of them, `clis()` lists the CLIs. An adapter carries its id, type, label, short name,
  robot, models and model prefixes; for a CLI also its workflow provider `definition` (what the
  Builder writes), `resumeArgs`, `imageInput` (`read`, `flag`, `record` for the mock, or none),
  `isolationArgs` (the flags per capability set, called by `capabilities.providerArgs` with its
  helpers), the stream parser `parse(event, emit, acc)` (`parse.flush` when it buffers deltas), the
  usage-limit `quotaPattern` and `usageLimitMessage` (`isQuotaError`, the simulation's
  `usage_limits`), feature flags (`requestLimit`: max_requests enforced per turn; `enforcesDenyRules`;
  `costReported`), where its conversations are (`sessionsDir`, `modelsCache`), how a folder is
  trusted (`trust`) and its interactive arguments for the Sessions screen. `runTurn` runs a CLI with
  its adapter's parser, or the simulation. The adapters are dual-load modules: the renderer gets
  `window.Providers` (`window.ChatModels` and `RunChatModel.providerType` read it). The workflow
  YAML's `providers:` and `agents.<name>.provider` formats did not change, and
  `test/provider-args-snapshot-348.test.js` holds every command line built per provider, capability
  set and session mode. Adding a provider: the code map's "A provider".
- **Where a turn's cost comes from (#369)**: the CLI's own figure when it reports one (Claude Code's
  `total_cost_usd`, the difference with the session's previous total, #233; Grok), else the tokens ×
  the model's price (`src/usage.js` `sessionCost`: input, output, cache read, and cache write at the
  model's `cache_write` price, else 1.25× input for a 5-minute cache and 2× for an hour). A model's
  price is `settings.prices[model]`, else the adapter's `prices` table (`priceOf`; Claude:
  `claude-haiku-5-5`). One exception: when Claude Code does not know the model it runs, it writes
  `[claude-code:unrecognized_model] {"model":...}` to stderr (the adapter's `parse.stderr`) and prices
  the turn at another model's rates. Such a turn is priced by the app from its tokens at the session's
  cache tier (`priceUnrecognizedTurn`, `src/engine/run/costs.js`): its `session.message_received`
  carries `cost_source: 'tokens'` and the CLI's figure as `cli_cost_usd`, the session snapshot a
  `cost_estimate` `{ source, model, cli_version, cli_cost_usd }`. With no price for the model its cost
  is unknown (`cost_usd: null`, `cost_source: 'unknown'`, `cost_note: 'no price for <model>'`) and the
  run's `max_total_cost_usd` and the budgets count the CLI's figure, so a limit is never skipped. The
  run log warns once per model (`kind: unrecognized_model`, with `claude update`). Turns of models the
  CLI knows keep its cost exactly; past run records are not rewritten.
- `timeout` (agent or `defaults`): the limit of one turn, default `30m`; the process is killed
  when it runs out. It may be a template rendered with the run's context (`turnTimeout`), e.g. the
  software-development workflows give grouped runs more time:
  `timeout: "{{ (30 + 10 * ((inputs.issues | length) - 1)) | clamp(30, 60) }}m"` (30m for one
  issue, +10m per extra issue, at most 60m). `clamp(lo, hi)` is an engine filter. The value used
  is in `session.message_sent.timeout_ms`. It is multiplied by the agent's model's
  `timeout_factor` (`models`, below).
- **Per-run agent overrides (#262)**: WorkflowRun's `agentOverrides: { <agent>: { provider?, model?,
  effort? } }` (run:start's, the Start drawer / Assign dialog / roadmap item Edit "Agents" section,
  `src/renderer/agent-overrides.js`; a Backlog queue item and a roadmap item keep theirs) replace the
  workflow's resolved values for that run only (`applyAgentOverrides`, after the templates; an unknown
  agent or provider throws; `effort: ''` clears it). workflow.started records `agents` (what each agent
  runs on) and `agent_overrides` (what differs); a resume applies them again, plus the fallbacks taken
  (`resumeSpec`). No workflow needs its own `*_model` inputs: ai-development-local-hero's
  `developer_model` stays as one case of it, its 3x timeout now from `models`.
- **Fallback chains (#262)**: `fallbacks: ["<provider>:<model>", ...]` on an agent or in `defaults`
  (the agent's wins; `loadWorkflow` refuses an entry that is not `provider:model` or names an undefined
  provider), else Settings' `providers.<provider>.fallbacks` (WorkflowRun's `fallbacks` option) for the
  provider the agent runs on. A turn that fails with a quota / credit / usage-limit error
  (`isQuotaError(type, message)` in providers.js, per CLI: Claude "usage limit reached", "Credit balance
  is too low"; Codex "You've hit your usage limit", "Quota exceeded"; Grok "used all available credits",
  "spending limit") is not retried on the same provider: `agentTurn` closes the session, moves the agent
  to the next entry (`nextFallback`; an entry with an undefined provider is skipped with a warning) and
  reruns the turn in a fresh session (system prompt + the agent's handoff note), emitting
  `agent.fallback { agent, step_id, from, to, reason }` (a `run` notice, event `fallback`). The agent
  stays there for the rest of the run (`wf.agents` and `ctx.agents` updated); the new session records
  `fallback_from: { from, reason }`. Other errors keep the retry below. No entry left: the step fails
  with the provider's message, as before; a fallback reruns the same turn, so no step or gate is ever
  skipped. Simulation: `mockSequences.usage_limits: ['<provider>' | '<provider>:<model>', ...]` makes
  every turn on a listed entry fail with that CLI's usage-limit message (the hint carries the agent's
  own provider; a simulated session records it as `simulates`, shown instead of `mock`).
- **Accounts per provider (#312)**: Settings' `providers.<provider>.accounts: [{ name, dir, enabled }]`
  (WorkflowRun's `accounts`, from `settingsAccounts` in `src/service/areas/runs.js`; an account without
  `enabled` counts as enabled) are config folders of the same CLI, in order (`src/engine/run/accounts.js`).
  A new session runs on the first enabled account that is not out and records it (`session.account`,
  shown in the run's cost breakdown); the folder reaches the CLI as described in capabilities.md. A
  quota error on an account comes **before** the fallback chain: the account is out until the reset
  time the message gives (the adapter's `quotaReset`, read by `quotaResetAt`; a time already past
  counts as none) or for Settings' `accountCooldownMinutes` (60 by default), the session closes and the
  same turn reruns at once in a fresh session (handoff note) on the next account of the **same**
  provider, emitting `agent.account_switch { agent, step_id, provider, from, to, reason, until }`. The
  agent stays on that account for its later turns. Only after the provider's last account does the
  chain above apply (owner, 2026-10-13); with no chain the step waits for credits (gates-and-run-end.md).
  The app never switches provider by itself (owner, 2026-10-08). A resumed run continues a session
  only on the account that opened it. Simulation: a `usage_limits` entry `'<provider>@<account name>'`
  limits only that account.
- **Limits per model (#262)**: a top-level `models: { <model id>: { timeout_factor?, max_total_cost_usd? } }`
  (and Settings' `models`, the WorkflowRun option; the workflow's entry wins per model). `turnTimeout`
  multiplies by the agent's model's `timeout_factor`; the run's cost limit (`maxTotalCost`) is the
  largest of `orchestrator.limits.max_total_cost_usd` and the `max_total_cost_usd` of the models its
  agents run on now (a workflow without a cost limit keeps none).
- `retry.max_attempts` (+ `backoff`, `initial_delay`): a failed turn (timeout, crash, retryable
  error) runs again. A killed process writes no handoff note, so the next attempt starts with a
  `<previous_attempt>` block: the failed attempt's tool calls with the first line of each result
  (`attemptSummary`, last 60 calls; log kind `attempt_summary`), so it continues instead of
  re-orienting. The mock's `sequences.timeouts: { step: n }` kills the first n attempts.
- A step output's `preexisting_failures` (`[{ test, file, reason }]`, the test step of the
  software-development workflows): tests that also fail on the base. They don't block the step;
  the engine logs them (kind `preexisting_failures`, warn) and lists them in
  `summary.preexisting_failures` for the owner (follow-up issues). Mock: `sequences.preexisting_failures: true`.
- Schema retries: ephemeral and handoff agents answer retries in a fresh session → the engine
  resends the task, the previous answer and the schema (`retryPrompt`).
- Claude local transcripts repeat each message while streaming: dedupe by message id + request id.
- The app still runs one workflow at a time; the CLI (`npm run run`) can run the same project
  concurrently thanks to worktrees.
