# Engine: workflow YAML features

Read this before changing `src/engine/workflow.js` or a workflow YAML. The README documents the
same features for users; this is the implementer's summary.

## Agents and steps

- `agents.<name>.skills` (system prompt, 1st turn of a session) and `steps[].skills` (step prompt);
  names can be templates (`"unit-test-writer-{{ inputs.language }}"`).
- `agents: [a, b]` on a step = parallel fan-out → `{ results, succeeded, failed }`, `min_success`.
- `save_as` (string or list, relative to the run folder; `{ path, content }` saves one field), `on_error: <step>`.
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
- `wait: { probe, target, output?, grace? }` on a single-agent `/loop` step (`loadWorkflow`
  validates it): when the step loops back to itself without a delegation or supervisor note,
  `pollStep` runs the probe (`src/engine/probes.js`, `gh`/`glab`, no tokens) instead of the agent.
  `pending`/`unchanged` (and `none` within `grace`, default 10m after the agent's last turn) →
  `loopWait` again (never counted as blocked); `passed` + `output` → the agent's last output with
  `output` over it, validated, then `finishStep` (goal + transitions, `step.finished` with `probe`,
  an `orchestrator` row in `decisions.tsv`); anything else, or a probe error (`probe_error` warn) →
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

## Worktrees and template context

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: see [worktrees.md](worktrees.md).
- Template context: `inputs`, `steps.<id>.output/visits`, `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`,
  `skill_dir('<name>')` (a skill's folder, to run its script in an action).
- Transition `action:` is a shell command run in the worktree (skipped in simulation); one that
  renders empty runs nothing. Agent output reaching it goes through a validating filter
  (`github_repo`, `pr_url`). The PR screenshots cleanup on merge/close uses this.

## Providers

- Schema retries: ephemeral and handoff agents answer retries in a fresh session → the engine
  resends the task, the previous answer and the schema (`retryPrompt`).
- Claude local transcripts repeat each message while streaming: dedupe by message id + request id.
- The app still runs one workflow at a time; the CLI (`npm run run`) can run the same project
  concurrently thanks to worktrees.
