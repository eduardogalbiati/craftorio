# Engine: workflow YAML features

Read this before changing `src/engine/workflow.js` or a workflow YAML. The README documents the
same features for users; this is the implementer's summary.

## Agents and steps

- `agents.<name>.skills` (system prompt, 1st turn of a session) and `steps[].skills` (step prompt);
  names can be templates (`"unit-test-writer-{{ inputs.language }}"`).
- `agents: [a, b]` on a step = parallel fan-out → `{ results, succeeded, failed }`, `min_success`.
- `save_as` (string or list, relative to the run folder; `{ path, content }` saves one field), `on_error: <step>`.
- A **transition** can also take `on_error: <step>`: when its `action`, `merge: local` or `precheck` fails, the run goes there instead of failing, with the error in the template context as `action_error` (`{ step, message, at, check?, head?, supervisor?, diagnosis? }`; `head` = the worktree's HEAD after the failure, which a failed local merge leaves as it was: the last checked commit). `recoverFromActionError` in workflow.js.
  - `recover: [steps]` (needs `on_error`; agent steps only): the supervisor decides first (`superviseActionError`, `supervisor.actionSchema(recover)`: `goto` one of them | `escalate`; `goto` first = the mock's default). `goto` → that step, `action_error.supervisor = { goto, explanation, instruction, record }` (the step's prompt includes it); `escalate`, an invalid goto, no supervisor or no `max_total` left → `on_error` with `action_error.diagnosis`. Event `supervisor.decision` with `kind: action_error` and `record` ("went back to X at HH:MM UTC because …"), a `supervisor` row in `decisions.tsv`; `runs.js` exposes the latest record as `recovery` (Backlog card badge).
  - `precheck: { probe, target }` (or `true` = the step's `check`): `runCheck` runs the probe right before the action; anything but `passed` throws (the merge is not attempted). `pr_mergeable` (probes.js `mergeableState`): passed | conflict | failed | pending | blocked | behind | merged | closed; a probe that cannot run = `error`.
  - A transition with `precheck` or `merge: local` runs check + action + merge inside `merge-queue.js` `serialize(key)` (key = the PR/MR's `host/repo`, else the worktree's repo): one merge at a time per repository across the process's runs; then `notifyMerged`.
  - `set: { name: value }` (values rendered against the step's scope) → run variables `vars.<name>` (not restored on resume). software-development and local-hero use `vars.recheck == 'resolution'` to scope code_review/test/verify after a conflict.
  - Simulation: `mockSequences.action_errors: { step: n }` fails the first n actions/merges of that step; probe states per check with `mockSequences.probes: { '<step>:check': [...], '<step>:precheck': [...] }` (default `pr_mergeable: ['passed']`).
- A **human gate** can take `check: { probe, target, on_fail?, recover? }` (`openGate`): the probe runs right before it opens (`check` in the message's template context: `{ state, detail, target, checked_at }`), and again on every `merged` notification of another run for the same key while it is open. Not `passed`/`error` with `on_fail` → the gate is not opened / is withdrawn (`approval.resolved` with `withdrawn: true, by: 'check', reason`) and the run takes `recoverFromActionError` with `{ on_error: on_fail, recover }`. Nothing ever approves a gate for the person.
- `orchestrator.limits.max_total_context` (e.g. `20M`): the context the run's agents read (input + cache, summed over every turn). Past it, `contextGate` pauses the run before the next agent turn with a `<step>:context_limit` gate (choices `continue` = allow another block of the same size, `stop` = cancel; the worktree is kept). A turn is never cut; `limit.exceeded` is emitted with `paused: true`.
- `groups: [{ name, steps }]` (optional, top level): progress views only, the graph ignores it;
  `validateGroups` in `loadWorkflow`. Recorded in `workflow.started` and `summary.groups`, with
  `summary.progress` = the engine's `StepTrail` (`src/renderer/run-progress-model.js`).
- Inputs with `type: run` take another run's id: empty/`latest` → the most recent run of another
  workflow; an id with no `runs/<id>/events.jsonl` is refused when the run is created (the UI shows
  it before anything starts). Used by `run-retrospective`.
- Agent `provider`/`model`/`effort` can be templates over the inputs (resolved once in the constructor);
  `cli_args` can be a map keyed by provider; providers' `effort_args` get `{{ effort }}`.
  `max_visits` / `loop.max_iterations` accept templates. `agents.<name>.enabled` (bool or template)
  drops an agent from the run (`dropDisabledAgents`: removed from fan-outs, `min_success` capped;
  a single-agent step on it throws). ai-arena's five contender slots use it (`provider: none`).
- `persona: random` (agent): one of the user's agents (Agents menu, `personas` option from the service)
  is picked when the run starts; its prompt goes before the agent's `system_prompt`, its skills are added
  (missing ones left out with a warn). Recorded as `personas` in `workflow.started`; `resumeSpec` keeps the pick.
  Written by the visual builder's "random agent" desk.
- `capabilities` (agent, overridable per step) and `isolation: false`: see [capabilities.md](capabilities.md).
- `edits_tests: false` (agent or `defaults`, overridable per step, e.g. `resolve_merge: true`) + workflow-level
  `tests_paths` (globs; default `TESTS_PATHS` in `src/engine/test-paths.js`): `sendToAgent` snapshots the
  working dir before every turn of that agent (steps and delegations) and, after it, lists the test files the
  turn changed (new non-merge commits not on `refs/heads/<base>` / `origin/<base>`, uncommitted and new
  untracked files, only those still different from the snapshot). Any → `tests.refused` event + warn, the turn
  is sent back with the list (`testsRefusedPrompt`), twice at most, then it throws (supervisor / `on_error`).
  Not a git work tree → no check. Claude also gets `--disallowedTools Edit(<glob>)`.
- `providers.<p>.skill_args` (claude `--add-dir {{ skill_dir }}`), `prompt_file_arg` (grok).

## Sessions and handoff notes

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
- When the next turn needs the note (handoff mode, or a rotation) and the answer has none, one
  follow-up turn in the same provider conversation asks only for it (`HANDOFF_ONLY`); if that fails
  too, a fallback note is built from the answer.
- `max_context` (e.g. `150k`, agent or `defaults`): a persistent turn whose largest request went
  above it marks the agent; its next non-retry turn opens a new session (the old one is closed) and
  starts from the note. Logged as `log` `kind: context_rotation`. Never cuts a turn.
- Metrics: every turn is a `turnLog` record (context at the first request, peak, tokens, waste:
  `refused` = every tool call refused, `blocked` = a blocked `/loop` iteration);
  `summary.context = { agents: { <name>: { turns, fresh_sessions, tokens, peak, waste_tokens, per_turn } }, waste_tokens }`.
  `session.message_received` carries `context: { start, peak }` and `handoff`.
- Idle agents (`src/engine/idle.js`, #46): an agent with no stream item for `idleWarnMs` (setting
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
- The supervisor's decision prompt and `runReport` include the latest note per agent;
  `resumeSpec` returns `handoffs` and the resumed run starts from them.

## Resume from a step

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
- **Gates**: a resume never reuses a human gate's decision. A step after (in the workflow's order) a
  `human_approval` step the previous run decided is refused (`supervisor.skippedGate`): resume from
  the gate, which asks again. Gate outputs are dropped from the kept outputs
  (`supervisor.withoutGateDecisions`), so every gate reached again opens again.

## Gates, loops and how a run ends

- Human gates can ask for free text (`feedback: true | { label, placeholder }`): `output.feedback` and the
  run-wide `feedback` list in templates (`approval:resolve` takes `feedback`). `previous_step` = the step that
  ran before. The Write & Review chat answers its run's gates inline (the approval dialog stays hidden there).
- `orchestrator.supervisor: { enabled, max_interventions }` — per step 2, per run 6.
- Refused tool calls: `isPermissionDenial` (providers.js) spots allowlist refusals in the stream
  ("requires approval"); 5+ in a row in one turn → `log` warn with `kind: permission_denials`
  (supervisor timeline, run chat). A `/loop` stops after `loop.max_blocked` (default 3, 0 = off)
  blocked iterations in a row → `goal.on_exhausted`, with a `loop_blocked` warn and an
  `orchestrator` row in `decisions.tsv`. Blocked = no tool call ran, or calls were refused and the
  enum/number/boolean fields of the answer (`decisionKey`) repeat. A delegation resets the count.
  Simulate with `mockSequences.permission_denials: { step: n }`.
- `wait: { probe, target, output?, infra_output?, grace? }` on a single-agent `/loop` step (`loadWorkflow`
  validates it): when the step loops back to itself without a delegation or supervisor note,
  `pollStep` runs the probe (`src/engine/probes.js`, `gh`/`glab`, no tokens) instead of the agent.
  `pending`/`unchanged` (and `none` within `grace`, default 10m after the agent's last turn) →
  `loopWait` again (never counted as blocked); `passed` + `output` → the agent's last output with
  `output` over it, validated, then `finishStep` (goal + transitions, `step.finished` with `probe`,
  an `orchestrator` row in `decisions.tsv`); `quota_exhausted` (pr_checks on github.com with no
  check or failed checks, when the `actionsQuota` constructor option says the owner's Actions
  minutes ran out) + `infra_output` → the same, with `infra_output` (its templates see
  `probe.detail`; `software-development` routes it to `ci_failed` as `failure_class: infra`);
  anything else, or a probe error (`probe_error` warn) →
  the agent turn, whose prompt says why (`st.probeNews`). `pr_changes` compares a fingerprint
  taken right after each agent turn (`afterAgentTurn`). Probe polls do not count as visits
  (mock sequences stay per agent visit). Events `step.probe`; `summary.probes`. The `probe`
  constructor option replaces the real one (tests); simulations use `MOCK_PROBES` or
  `mockSequences.probes: { step: [states] }`.
- How a run ends: a transition with `goto: end` may carry `status: success | failed | cancelled`
  (default success; also valid with `on_exhausted: end`; `loadWorkflow` rejects other values).
  Rejecting a failure gate → `failed`; rejecting `human_review`/`approve_merge` → `cancelled`.
  Non-success keeps the worktree. When `max_visits`/`loop.max_iterations` runs out, the transition
  goes to `on_exhausted` WITHOUT its `delegate` (no unchecked "one more fix").
- Human gates can offer `choices` (each with its own transition); failure gates use them so every
  option does something different (e.g. `preview_failed`: publish again / send to developer / stop).
  software-development (0.12.0): the deployer returns `failure_class: code | infra | unknown`; a
  preview `code` failure goes to the developer → `ci` → `pr_babysitter` → `deploy_test` (2
  automatic rounds, then the gate).
- `WorkflowRun` option `issues: [{ number, url, title }]` (Backlog assignments; several when a group of
  issues goes as one run, one issue is a list of one) is recorded in `workflow.started`/`summary.json`
  like `projectId` and carried over on resume (`resumeSpec`). The old option `issue` is still accepted;
  runs recorded with `issue` load as `issues: [issue]` (`runs.readRun`, `resumeSpec`, the run chat).
  The Backlog fills the `issue` (first URL) and `issues` (every URL) inputs when a workflow declares them.
- Inputs with `type: array` take a list; text from a form becomes one item per line or comma.
- software-development (0.15.0) for several issues: the developer answers `issues: [{ issue, done, summary }]`;
  one with `done: false` goes to the `issue_not_done` gate (continue without it / stop), asked once per
  run; the review sets `issue` on its findings, the verifier answers a verdict per issue, and the CI
  Pusher's PR/MR body closes each issue that was done.
- software-development (0.17.0), merge conflicts (#69): `approve_merge` has `check` (pr_mergeable,
  `on_fail: merge_failed`, `recover: [resolve_conflict]`) and its approved transition `precheck: true`
  with the same routes. `resolve_conflict` (developer, `edits_tests: true`, merges `origin/<base>`,
  pushes; `merge_commit`, `behaviour_changed`) → `code_review` with `set: { recheck: resolution }`
  (review of `git show --remerge-diff <merge_commit>`), `max_visits: 2` → `merge_failed`; `test` then
  runs the full suite and goes straight to `ci` (build and verify already passed), then
  `pr_babysitter` → `deploy_test` (a fresh entry always triggers a new preview: `previous_step`) →
  `approve_merge` again. `deploy_failed` → develop resets `recheck`.
- local-hero (0.4.0), scoped re-check after a conflict (#99): `resolve_merge` answers `previous_head`,
  `head`, `files_changed` (the resolved files only) and `behaviour_changed`; its transition sets
  `vars.recheck` (`resolution`, or empty when behaviour changed). With `resolution`: `code_review` gets
  `git range-diff <base> <approved> <branch>` (approved = `action_error.head`, else `previous_head`),
  findings outside it non-blocking; `test` runs the related tests + a smoke check (full suite past 5
  files); `build` unchanged; `evidence` is skipped (its earlier evidence is kept); `verify_change`
  re-checks only the claims whose files were touched.

## Worktrees and template context

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: see [worktrees.md](worktrees.md).
- Template context: `inputs`, `steps.<id>.output/visits`, `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`,
  `skill_dir('<name>')` (a skill's folder, to run its script in an action).
- Transition `action:` is a shell command run in the worktree (skipped in simulation); one that
  renders empty runs nothing. Agent output reaching it goes through a validating filter
  (`github_repo`, `pr_url`). The PR screenshots cleanup on merge/close uses this.

## Providers

- `timeout` (agent or `defaults`): the limit of one turn, default `30m`; the process is killed
  when it runs out. It may be a template rendered with the run's context (`turnTimeout`), e.g. the
  software-development workflows give grouped runs more time:
  `timeout: "{{ (30 + 10 * ((inputs.issues | length) - 1)) | clamp(30, 60) }}m"` (30m for one
  issue, +10m per extra issue, at most 60m). `clamp(lo, hi)` is an engine filter. The value used
  is in `session.message_sent.timeout_ms`.
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
