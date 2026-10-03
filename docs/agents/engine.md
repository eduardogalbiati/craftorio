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
- A **screenshots step** (`type: screenshots`, no agent, #144; `runScreenshots` → `src/engine/screenshot-step.js`): `from: <step>` (whose output lists `screenshots: [{ name, caption, args }]`, `args` = the options of the project's screenshot command), `folder` (default the step id), `base` (template, the ref of the "original" side; default the worktree's base ref), `timeout` per shot (default 3m). It runs `npm run screenshot -- <args> --out <run_dir>/evidence/<folder>/round-<visit> --name <name> --side modified`, then the same with `--side original --ref <base>`, with the agents' environment (simulation only, scratch workspace); at most 8 entries, `--out/--name/--side/--ref/--caption` in `args` are refused. It never fails and never calls the supervisor: an empty list, a simulated run (`mock`: nothing is launched), no worktree, no `screenshot` script in the worktree's package.json, an invalid entry, a timeout or a crash end up in its output `{ kind: 'screenshots', folder, round, dir, taken, screens, screenshots: [{ path, caption, side }], errors: [{ name, side?, error }], reason, message }` (`message`: "N screenshots of M screens taken in round n" or "No screenshots: <reason>"). software-development and local-hero run `developer_screenshots` (from `develop`, folder `developer`) on every way into `developer_check`, whose message shows `message`; the gate's Artifacts panel shows that round only (`lastCapture` in gate-panel.js).
  - **The screenshot slot (#199)**: at most one Electron screenshot process at a time on the machine, across all runs and apps. Each capture of the step takes the machine-wide slot (`src/engine/machine-slot.js`, `acquireSlot('screenshot')`: a file `<os tmp>/multiagent-orchestrator/locks/screenshot.slot` with pid, host and token, or under `MULTIAGENT_LOCKS_DIR`) and passes its token to `npm run screenshot` (`MULTIAGENT_SCREENSHOT_SLOT`), which then does not wait for it. While another run holds it the step emits `screenshots.waiting` (`holder_pid`) and a log line "waiting for the screenshot slot". `scripts/screenshot.js` takes the same slot itself (`acquireSlotSync`), so an agent's `npm run screenshot` (evidence, test writer, E2E runner) waits too and prints the same line. A slot whose process is gone, or held over 15 minutes, is freed; a wait over 20 minutes fails that capture.
- A **suite step** (`type: suite`, no agent, #177; `runSuiteStep` → `src/engine/suite-step.js`): the
  project's whole test suite, once per visit, run by the orchestrator instead of an agent (an agent
  running it kept its turn and its 100k+ context open for minutes, several times per run).
  `command` (template; empty → `detectTestCommand` from the worktree's files: package.json's test
  script → `npm test`, go.mod, pom.xml/mvnw, build.gradle/gradlew, *.sln/*.csproj, pyproject.toml…),
  `timeout` (default 30m). It runs in the worktree with the agents' environment, its whole output in
  `<run_dir>/logs/suite-<visit>.log` (`file.saved`), and reads the failing tests from it
  (`parseFailures`: node:test spec/TAP, Jest, pytest, go test, dotnet test, Maven). Output `{ kind:
  'suite', status: pass | fail | blocked, round, command, log, exit_code, duration_ms, timed_out,
  failures: [{ test, file, error }], preexisting, reason, message }`; the run's known pre-existing
  failures (`notePreexistingFailures`) are moved to `preexisting` and never fail it; `blocked` = it
  could not run (no worktree, no command). It never throws and never calls the supervisor: the
  transitions route it. The other failures are checked on the base by the step itself (#211): their
  test files run in the base checkout (`suiteBase`, prepared on demand, so `run_existing`/`off` runs
  get it too), cached per base commit + file in `cache/base-tests/`; those failing there too become
  `preexisting_failures` (the run's list, the summary, the workspace's `failing-on-main.json`). The
  suite gets a shell-like env (`suiteEnv`: no Electron/npm/inspector variables, no scratch
  workspace, its own `MULTIAGENT_LOCKS_DIR`, #210); without a step `timeout`, the timeout is 3× the
  median of the project's recent durations (`cache/suite-durations.json`, min 10 min, 30 min with no
  history), and a timeout names the test files still running. Filter `suite_failures`
  (`{{ steps.suite.output | suite_failures }}`): the message plus one line per failing test, for a
  prompt or a gate. Simulation: `mockSequences.suite: { <step>: ['fail', 'pass'] }` per visit
  (default pass; `preexisting` = only the run's pre-existing failures fail, so it passes; `base` =
  the failures fail on the simulated base too, a pass; `mixed` = 2 failures, one on the base, a
  fail; `blocked`), a simulated log is written.
  - **`full_suite: warn`** on an agent step: a tool call of its agent that starts the whole suite
    (`isFullSuiteCommand`: `npm test`, `pytest`, `go test ./...`, `dotnet test`, `mvn test`, the
    suite step's own command…) is noted, not refused: a `log` warn `kind: full_suite_by_agent`.
  - `summary.suite_runs: { engine, agents }`: whole-suite runs by suite steps and by agents (the
    measure of #177).
  - software-development and local-hero: `test` (test writer, focused tests) → `suite` → build; a
    failing suite goes back to the test writer (its prompt gets the failures and the log path when
    `previous_step == 'suite'`), 2 rounds, then `test_failed`.
  - **`commit_tests: true`** on a single-agent step (the test writer's `test` step in both
    development workflows and test-batch, #209): after the turn (before the suite, the build and the
    local merge) `commitLeftoverTests` lists the run worktree's local changes (`localChanges` in
    test-paths.js; no worktree = nothing to do). `committed: false` in the answer → a `log` warn
    `kind: tests_uncommitted`. All of them test files (`tests_paths`) → the engine stages and
    commits them (`Tests for #<issues> (committed by the orchestrator)`), event
    `tests.autocommitted { files, commit }`, a `log` warn `kind: tests_autocommitted`, the output
    gets `committed: true, autocommitted`, `summary.tests_autocommitted`. Other files changed too →
    never committed: the step goes back to its agent once with both lists (`retry`, no new note),
    then, if non-test files are still changed, a gate (Continue / Stop the run); test files left
    after it are committed as above.
- **`tool_timeout` (#178)**: a tool result cut by the tool's own timeout (`isToolTimeout` in
  providers.js: "Command timed out after …", Claude Code's Bash default is 120 s without a
  `timeout`) is a `log` warn `kind: tool_timeout` with the command and `timeout_ms` (null = the
  default), counted in `summary.tool_timeouts`. Simulation: `mockSequences.tool_timeouts: { <step>: n }`
  (the first n answers of that step have one test command cut at the default).
- **Test inputs (#203)**: the development workflows' `unit_tests` (write_and_run | run_existing |
  off) and `e2e_tests` (off | write | write_and_run) route the transitions (code_review/human_review
  → test, suite or build; test → suite or build; suite failures → test writer or developer) and
  the test writer's skills and prompt. `testsPlan` (workflow.js) turns them into `ctx.tests_plan`
  ("Unit tests: Off (workflow default). E2E tests: Write (chosen for this run).": a value differs
  from the workflow's `default` = chosen for this run), and `tests_plan: [{ input, label, value,
  value_label, source }]` in `workflow.started` and the summary (runs.js `testsPlan`, the Run
  screen's badges). The gates and the verifier's prompt show it; nothing off is reported as tested.
  `test-batch.yaml` writes the skipped tests later, for a range of local commits, in one session.
- **`base_worktree: true`** on an agent step (#198; needs `orchestrator.worktree`): before each visit the engine prepares the run's checkout of the base (`<worktreesDir>/<run_id>-base`, detached at the current base, dependencies linked from the shared cache) and gives it as `base_worktree_dir` (empty without a worktree), for the test writer's pre-existing-failure check. See [worktrees.md](worktrees.md).
- **`deps.ready`** (#198): the run's dependencies from the shared cache, after `worktree.ready`, for the base checkout and after an agent step that changed the lockfile (`{ for: worktree|base, after, status, hit, lockfile, manager, key, entry, seconds, waited, reason }`; nothing when the folder already links its key). Agents with commands get a line about it in their command guide (`depsGuide`). See [worktrees.md](worktrees.md).
- `orchestrator.limits.max_total_context` (e.g. `20M`): the context the run's agents read (input + cache, summed over every turn). Past it, `contextGate` pauses the run before the next agent turn with a `<step>:context_limit` gate (choices `continue` = allow another block of the same size, `stop` = cancel; the worktree is kept). A turn is never cut; `limit.exceeded` is emitted with `paused: true`.
- `groups: [{ name, steps }]` (optional, top level): progress views only, the graph ignores it;
  `validateGroups` in `loadWorkflow`. Recorded in `workflow.started` and `summary.groups`, with
  `summary.progress` = the engine's `StepTrail` (`src/renderer/run-progress-model.js`).
- Inputs with `type: run` take another run's id: empty/`latest` → the most recent run of another
  workflow; an id with no `runs/<id>/events.jsonl` is refused when the run is created (the UI shows
  it before anything starts). Used by `run-retrospective`.
- Inputs with `type: boolean` take true/false; `resolveInputs` also accepts their text ("true",
  "false", "yes", "no", "1", "0", "": saved inputs, the CLI's `--input`), so a condition reads
  `inputs.x`, not `inputs.x == 'true'`. UI-only keys the engine ignores (#116, rendered by
  `src/renderer/workflow-inputs.js`): `label` (else derived from the key), `options` (`{ value:
  label }` for an enum), `show_if` (`"mode == 'validated'"`: hidden while false, value kept).
- Images attached to inputs (#129): `attachments: { <input>: [path | { path, name }] }` on
  `run:start` / `WorkflowRun` (`--attach task=<file>` in `scripts/run.js`). Checked in the
  constructor (limits in capabilities.md, "Images"), copied into `<run_dir>/attachments/<input>/`
  at start, recorded in `workflow.started.attachments` (a resume copies them again). Every turn of a
  step whose prompt template uses `inputs.<input>` gets them (`stepAttachments`, delegations
  included); `session.message_sent` lists them. Simulations: the mock provider lists them in a
  thinking item and never opens them.
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
  ran before. Gates are answered inside their run: the run chats inline, or the gate card on the Run screen (no dialog).
  `approval:resolve` also takes `images` (#129): copied into `<run_dir>/attachments/<gate>-feedback/`,
  recorded in `approval.resolved.attachments`, and given to the next agent step only (all agents of
  a fan-out). They never decide anything: the answer stays the owner's choice.
  `runs:resume` takes `images` too (#130, pasted into the instruction): `resume.images`, checked in
  the constructor, copied into `<run_dir>/attachments/<step>-instruction/` at start and given to
  the first agent step like gate feedback images.
- A gate choice with `feedback_required: true` (needs the step's `feedback`) is refused without a
  text: `resolveApproval` returns false and the gate stays open. `local_preview: true` on a gate
  offers Run locally (see worktrees.md); `diff_base: <ref>` (a template) offers Show the diff
  (`git diff <ref>...HEAD` in the worktree, read-only terminal). `approval.resolved` carries `wait_ms`; the summary's
  `timing.gates` / `timing.gate_wait_ms` hold the owner's time at gates, apart from agent time.
- `save_to_issue: <choice id>` on a gate (#125, writer-reviewer's `decide` / `out_of_rounds`): when the
  run has an issue, the gate's event carries `save_to_issue: { choice, issue }` and the UI adds
  "Accept and save to issue #n". It answers that choice (transitions unchanged) with `intent:
  'save_to_issue'` (`approval:resolve` takes `intent`; `approval.resolved` records it). When the run
  ends with success the UI opens the Save to issue preview: nothing is written before it is confirmed.
- Validated mode (`inputs.mode == 'validated'` in both software-development workflows):
  `develop` → `developer_check` while `vars.owner_validated != 'yes'` (set by the gate's
  approve/changes transitions) or `inputs.validate_every_round` (a boolean); the developer's
  prompt shows the change request when `previous_step == 'developer_check'`. Template filter
  `git_commits(base)` lists a folder's commits for a gate message (empty without a folder).
- `orchestrator.supervisor: { enabled, max_interventions }` — per step 2, per run 6.
- Supervisor on call (#41): `orchestrator.supervisor.on_call` (default true), `max_cost_usd`
  (default 5, the supervisor sessions' cost per run), `effort`, `model` (default Opus 5.5 on
  Claude), `stall: { same_output: 3, slow_factor: 3 }` (0 = off). A gate's `kind` is `decision`
  (default: the person's choice, never answered by the supervisor) or `escalation` (failure gates,
  `on_exhausted` targets; not with `check:`). Before an escalation gate opens, `superviseEscalation`
  asks it (`onCallPrompt`, `onCallSchema`): `retry` the step before the gate / `resume` an agent
  step already visited (instruction → `supervisorNote`), `route` one of the gate's answers
  (output `by: 'supervisor'`), `user_action` / `escalate` → the gate opens with its diagnosis
  under the message and in `approval.requested.supervisor`. Over its limits the gate opens with
  its last diagnosis. Stalls (`checkStalls` after an agent step, `watchSlowStep` while it runs):
  same `repeatKey` N visits in a row (not /loop iterations; #121: the decision fields plus the
  findings and, for an author step, `commit_sha` (else the worktree head), `summary`, `notes`,
  `files_changed`; a step's `stall: { same_output_fields: [...] }` replaces that list, as `develop`
  does; the findings of the step it came from are part of the key, so a fix round answering new
  review findings never repeats), 5+ refused calls in a row, a visit
  `slow_factor`× the median of its earlier visits (min 10 min), a blocked /loop. Each is a `log`
  warn `kind: stall` (blocked loops keep their `loop_blocked` warn); `superviseStall` decides
  `continue` / `retry` / `resume` / `user_action` (a raw gate: retry, continue, stop), except when
  the next step is `end`/`fail` or an escalation gate. A slow visit wakes it at the threshold
  (`superviseSlow`, `SLOW_ACTIONS`): `wait` (checked again at twice the run time), `interrupt`
  (stops the step's running turns via `liveTurns`, the step runs again with the instruction;
  not on parallel steps) or `user_action` (a warn `kind: user_action`, the step keeps running).
  Exhausted loops (`noteExhausted` in `applyCounters`/`loopWait`): before an `on_exhausted`
  target that is a step, `end` or `fail`, `superviseExhausted` (stall signal `loop_exhausted`);
  at any gate target, `superviseEscalation`, where a decision gate gets no `route` (only
  retry/resume/user_action/escalate). Sending the run back grants one more round (`refund`).
  Every intervention: `supervisor.decision` (`kind: escalation | stall`) and a `supervisor` row
  in `decisions.tsv`.
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
- Backlog dispatch (service, not the engine): `dispatchQueue` starts the plain queue's items whenever a
  slot is free; `dispatchRoadmaps` (src/roadmap.js `advance`) runs a started roadmap stage by stage,
  first after every `workflow.finished` (before the queue) and when a workspace opens. An item is done when
  its run succeeded and merged: `summary.local_merge`, an `action.executed` with `gh pr merge`/`glab mr merge`
  and exit 0 (`mergedPullRequest`), or `mock`. A workflow that never merges declares `metadata.merges: false`
  (backlog-refresh, #161): its item is done when its run succeeds (service `roadmapRun` reads the run's
  workflow file). Any other end pauses the roadmap (`pausedBy`); a resumed run
  (`resume.runId` = the item's run) takes the item's place (`adoptResumed`).
- Inputs with `type: array` take a list; text from a form becomes one item per line or comma.
- software-development (0.15.0) for several issues: the developer answers `issues: [{ issue, done, summary }]`;
  one with `done: false` goes to the `issue_not_done` gate (continue without it / stop), asked once per
  run; the review sets `issue` on its findings, the verifier answers a verdict per issue, and the CI
  Pusher's PR/MR body closes each issue that was done.
- software-development (0.19.0) and local-hero (0.6.0), declared gaps (#98): `develop` answers
  `left_out: [{ requirement, reason }]` (required, `[]` when nothing is missing; single issue or
  group). Not empty → back to `develop` with the list, once (`set: { gaps_returned: yes }`), without
  calling the reviewer; not empty on any later visit (also after the owner continued) → the
  `requirements_left_out` gate (continue without them / stop as failed), so a gap never reaches the
  review. Continue appends to `vars.accepted_gaps` (shown to the developer and the reviewer, not
  blocking) and goes on as `issue_not_done` would. Mock: `mockSequences.left_out: [1, 0]` = gaps declared per develop visit
  (default none). Only the developer's own gaps count (#173): the `developer_gaps` filter drops
  entries led by "Tests" or "Measure" (the test writer's and the owner's tasks), so they trigger
  neither the return nor the gate and stay in the develop output of `summary.json`. Mock:
  `mockSequences.left_out_not_mine: true` adds one Tests and one Measure entry on every visit.
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

## Chaining: declared outputs and `then` (#134)

- `outputs:` (top level, `validateOutputs`): `{ <name>: { type, description, value } }`, type one of
  string, number, integer, boolean, array, object. `value` is a template over the run's context plus
  `run` (`run.issues`, `run.local_merge`); a type other than string is rendered as JSON (`| to_json`) and
  parsed. `computeOutputs` fills them in `finish()`: `workflow.finished.outputs` and `summary.outputs`.
  Empty or unparsable → `null` (a `log` warn, never a failed run). Filter `filed_issues(analysis)`: the
  issue tracker's created issues with complexity and grouping advice (`grouping`, `group_with`).
  The visual builder flags `outputs` (it would drop it on save): such a workflow is edited as YAML.
- Bundled contracts: issue-tracker `issues`; writer-reviewer `document`, `issue`; ai-arena `document`;
  software-development(-local-hero) `branch`, `merged_commit`, `issues`, `pr_url`; run-retrospective `findings`.
- `WorkflowRun` options `then` (what follows, `src/renderer/chain-model.js normalizeThen`: `{ action:
  'workflow', workflow, map: { <next input>: <output name> | '@run' }, inputs }`, `{ action:
  'product_owner' }`, `{ action: 'queue', workflow, inputs }`) and `from: { run_id, workflow }`, both in
  `workflow.started` and `summary.json`. A gate choice with `then:` (issue-tracker's `create_assign`:
  `{ action: queue, workflow: "{{ inputs.assign_workflow }}" }`) sets it when picked (`thenFromChoice`);
  the owner edits it with `setThen` (Run screen). Each change is a `run.then` event.
- The service acts on it (`src/service/areas/chain.js`), never the engine: on `workflow.finished`
  with `success` (and, when the workflow declares `merged_commit`, a non-empty one; simulated runs are
  exempt) it starts the next run (`nextInputs`: the then's values, the mapped outputs, the previous
  run's path/branch/language/platform inputs; the produced issues linked), queues the produced issues
  (`queueBatches`, like the old "Create and queue"; a simulated run queues nothing), or asks the
  Product Owner and adds its plan as planned roadmap stages (`roadmaps.propose`, never started by
  itself). Anything else pauses the chain (`runs/<id>/chain.json`: `then`, `state` waiting | started |
  paused | dropped | done, `reason`, `nextRunId`) with a notification; channels `chain:get`,
  `chain:set`, `chain:resume`, `chain:drop`, `chain:estimate`. Chaining never answers a gate: the
  next run's gates wait for the owner. A simulated run only chains simulated runs.

## Saved pipelines (#135)

- `src/pipelines.js`: `<workspace>/pipelines/*.yaml` (bundled `pipelines/`, seeded and restorable like
  the workflows). `parsePipeline` checks the shape (≥ 2 stages, the first a workflow, a `product_owner` /
  `queue` target only last, `on: success` only); `validatePipeline` checks each stage against its
  workflows: fixed `inputs` and `map` keys are inputs of the stage's workflow, `map` values are outputs
  the previous workflow declares (or `'@run'`), a target follows a workflow with an `issues`/`issue`
  output. No `map` → chain-model `defaultMap`. The error names the pipeline, the stage, the workflow and
  the missing name; `listPipelines` returns it per file.
- It runs as a phase-1 chain (no engine change but `from.pipeline`): `pipelineThen(p)` is the first run's
  `then`, stage 2 with the rest nested in `then.then`, each with `pipeline: { id, file, name, stage,
  stages }`. `startNext` (areas/chain.js) hands the nested `then` to the run it starts and records
  `from.pipeline` there, stamping the pipeline run's id (the first run's id) on the rest
  (`withPipelineId`). `chain-model pipelineOf(chain, runId)` says which pipeline and stage a run is.
  Pauses, Resume / Edit / Drop are the chain's; an Edit that keeps the next workflow keeps the stages
  after it.
- Service `src/service/areas/pipelines.js`, channels `workflows:pipelines` (list), `pipelines:run`,
  `pipelines:estimate`, `pipelines:get-run` (a pipeline run's stages and runs), `pipelines:save` (a run's
  chain → `fromChain` → a new file, never over an existing one), `pipelines:restore`; `backlog:assign`
  takes `pipeline` (its first workflow, fixed inputs and chain for each queued issue).

## A workflow as a step: `type: workflow` (#174)

- `{ type: workflow, workflow: <file>, inputs: {...}, foreach?, max_parallel?, on_error?, transitions? }`
  (src/engine/workflow-step.js, `runChildWorkflows` in workflow.js). `inputs` are templates over the
  run, plus `item` / `index` with `foreach`; a whole `{{ expr }}` keeps its type (a list stays a list).
  `foreach` (a list or a template giving one) starts one child per item, at most `max_parallel`
  (default 1) at a time, and never two items whose `files` overlap.
- Output: once `{ kind: 'workflow', workflow, status, run_id, outputs, error }`; foreach `{ ..., status,
  runs: [{ index, item, run_id, status, error, outputs }], outputs: [per item], succeeded, failed }`.
  `status` is success when every child succeeded. Not a success: `on_error` (a route or a gate) when
  set, else the transitions (they see `output.status`), else the run fails. Children run to the end
  even when one fails.
- Children are normal runs, started through the `startChild` option: the service starts them with
  `startWorkflowRun({ parent, onFinished, signal })`; without it (CLI, engine tests) `startChildRun`
  builds a `WorkflowRun` and emits it as `'child'` (record its events, answer its gates). Their gates
  wait for the owner, the parent waits too (orchestrator session `waiting`) and never answers them.
- Limits (#175): a child takes a Settings › Execution slot like any run (`slotProblem`), and its
  parent lends it its own: a waiting parent counts neither for its descendants nor, while one of its
  children holds the slot, for anyone. With no slot free a child waits (`waitForSlot`, a log line on
  the parent) instead of failing; a limit of 1 runs the children one at a time. Children count in the
  monthly budgets like any run (peers, then their summary). Each child has its own
  `max_total_context` (the parent's counts only its own sessions); the parent's `max_total_cost_usd`
  includes its children's cost (checked between steps). `workflow.child_finished` carries the child's
  `cost_usd` (its own children included, `childRunCost`); the parent records it in `child_runs` and
  `summary.children_cost_usd` (readRun `childrenCostUsd`, not in `costUsd`), shown in the run lists
  and the Run screen.
- Stop and resume (#175): stopping the parent stops its children (the Run screen's Stop asks first
  when children are running); a child still waiting for a slot ends `cancelled`. Resuming the parent
  from the `type: workflow` step (`resume.childRuns`, from `supervisor.resumeSpec`) hands each item
  its previous child (`previous`, matched by index and label, first visit only): the service reuses
  one that succeeded (its outputs, event `reused: true`) and resumes any other one from the step
  Resume from step… suggests (its gate instead when that step lies past a decided gate: the gate asks
  again), event `resumed_from`; a child that cannot be resumed starts afresh. The default
  `startChildRun` only reuses successes.
- Links: `parent_run: { run_id, workflow, step_id, index?, depth }` in the child's workflow.started and
  summary; the parent's `workflow.child_started` / `workflow.child_finished` events and
  `summary.child_runs: [{ run_id, step_id, visit, index?, label?, workflow, status, cost_usd,
  resumed_from?, reused? }]` (readRun `parentRun` / `childRuns`). Run lists nest children under their
  parent; the Run screen's chain banner links both ways. Children nest at most 3 deep; a workflow
  cannot name itself.

## Worktrees and template context

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: see [worktrees.md](worktrees.md).
- Template context: `inputs`, `steps.<id>.output/visits`, `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`,
  `skill_dir('<name>')` (a skill's folder, to run its script in an action), and in an agent step's
  prompt `evidence_dir` (`<run_dir>/evidence/<step>/round-<visit>`, where its screenshots go).
- Transition `action:` is a shell command run in the worktree (skipped in simulation); one that
  renders empty runs nothing. Agent output reaching it goes through a validating filter
  (`github_repo`, `pr_url`). The PR screenshots cleanup on merge/close uses this.

## Evidence: screenshots per step and round (#146)

- Every screenshot of a run goes to `<run_dir>/evidence/<step>/round-<n>/` (the step that captured
  it, its visit: one folder per "Ask for changes" round, per UI fix round), never flat in the run
  folder. Names: `<issue>-<screen>-<state>.original.png` (the app on the base branch) and
  `.modified.png` (the app with the run's change); a new screen has only `modified`, a removed one
  only `original`. The engine gives the folder as `evidence_dir` and in the command guide, and
  `evidence` is one of the `RUN_DIRS` (`--add-dir`).
- `src/evidence.js` keeps one index, `<run_dir>/evidence/manifest.json`: every image with `step`,
  `round`, `commit` (captured), `issue`, `screen`, `state`, `side`, `caption` and `pair` (the other
  side, the same round first, else the newest earlier one), the run's `base` and `branch`, and the
  **final set** (`final`, images marked `final: true`): the round that captured last, i.e. the last
  round of the last step that captured. The folders are the source of truth: the engine rebuilds
  the manifest after every step (`recordEvidence`: commits from the worktree, captions from a
  step output's `screenshots: [{ path, caption }]`), and `scripts/screenshot.js --caption` records a
  shot as it saves it. `orphanImages` lists images the manifest misses.
- Readers use the final set: the Artifacts panel (gate and Run tab) and screen through
  `artifacts:evidence`, the verifier's prompt, `pr-screenshots`'s `publish.js --dir <run_dir>/evidence`.
  Exception: the gate right after a screenshots step (developer_check) shows that step's round
  (`evidence/developer/round-<n>`, #144) and puts every other round in History.
- Runs recorded before: a flat `screenshots/` with `screenshots.json` (`{ path, caption, before }`)
  reads as one legacy set (`legacyManifest`); old folders are not migrated.

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
