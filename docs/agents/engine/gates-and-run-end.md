# Gates, loops and how a run ends

Human gates (feedback, choices, summaries), the supervisor, refused tool calls, waits, how a run ends and ships, and the bundled workflows' rules for several issues.

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
- Gate summaries (#213): every gate's card shows a short summary first, the message collapsed in
  its Details. A workflow declares it per gate, all templates rendered with the run's context:
  `summary:` (Markdown; its first line is "What happened", the next lines the status per issue,
  at most 6), `recommend:` (`"<answer>: <reason>"`, answer `approve` / `reject` or a choice id; any
  other text is a reason without an answer), `approve_label` / `reject_label` / `approve_help` /
  `reject_help` (an Approve / Reject gate's buttons: what they say and what they do) and `help` on
  each choice. Filters for summaries: `issue_lines` (one ✔ / ✖ line per issue of a developer's
  `done` or a verifier's `verdict` output; `issue_lines('not_done')` keeps the failed ones),
  `suite_lines` (a suite output's failing tests, its pre-existing failures as a count, #211) and
  `one_line(n)`. The engine stores `brief: { headline, body, recommendation: { answer, label,
  reason, source }, options, user_action? }` on the gate record and its `approval.requested` event,
  plus `approve` / `reject: { label, help }` on an Approve / Reject gate and `help` on choices
  (src/engine/gate-summary.js). Without `summary:` (and on engine-made gates) the headline is the
  first two sentences of the message; a summary that fails to render is logged and left out. The
  supervisor on call's `recommend` (one of the gate's answers), `recommendation` (one line) and
  `options` (up to 3) win over the workflow's `recommend:`; its full note stays under the message.
  In the UI, an answer opposite to the recommendation asks once to confirm. The notification, the
  toast, the roadmap's waiting badge and the Oracle's wake line use the headline.
- `save_to_issue: <choice id>` on a gate (#125, writer-reviewer's `decide` / `out_of_rounds`): when the
  run has an issue, the gate's event carries `save_to_issue: { choice, issue }` and the UI adds
  "Accept and save to issue #n". It answers that choice (transitions unchanged) with `intent:
  'save_to_issue'` (`approval:resolve` takes `intent`; `approval.resolved` records it). When the run
  ends with success the UI opens the Save to issue preview: nothing is written before it is confirmed.
- Validated mode (`inputs.mode == 'validated'` in both software-development workflows):
  `develop` → `developer_check` while `vars.owner_validated != 'yes'` (set by the gate's
  approve/changes transitions) or `inputs.validate_every_round` (a boolean); the developer's
  prompt shows the change request when `previous_step == 'developer_check'`. Template filter
  `git_commits(base)` lists a folder's commits for a gate message (empty without a folder);
  `git_log_stat(base)`, `git_tags(n)` and `project_version` (package.json / pyproject.toml) give a
  folder's `git log --stat`, its last tags and its own version (#290, release.yaml's `review`; '' on failure).
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
  review findings never repeats; a fan-out step, e.g. `code_review` (#151), is keyed per agent
  from `output.results`, `ui_findings` included), 5+ refused calls in a row, a visit
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
- `ship: { tag, build? }` on a transition (#260, release.yaml's `ship` and `ship_failed` gates; both
  templates): after the transition's `action` and `merge: local`, `shipRelease` (src/releases.js)
  pushes the local base to origin (never forced; a rejected push throws) and tags that commit, then
  runs `build` when it renders non-empty. `loadWorkflow` only accepts it on a `human_approval` step
  without `kind: escalation` and without `timeout`, with `orchestrator.worktree`. `shipGuard` runs
  before anything else of the transition (its merge included): the gate must have been answered by
  `'user'` (`st.answeredBy`: not the supervisor, a timeout, or scripts/run.js `--auto-approve`,
  which answers as `'auto'`), else the run fails (`fatal`: no `on_error` retry) with nothing merged
  or pushed; and the local base must still be an ancestor of the worktree's HEAD (it did not move
  since the suites ran), else the transition fails. `shipRelease` gets the worktree's HEAD as
  `expect` and pushes nothing when the base is another commit. A failure goes to the transition's
  `on_error` like a failed merge. `base_check: false` on a `type: suite` step (release.yaml's
  suites, whose worktree is the base itself) skips the "fails on the base too" check (#211), so
  every failing test fails the step. Event
  `release.shipped`; `summary.release` = `{ tag, base, commit, pushed, issues }`. A simulation pushes
  nothing (`action.executed` skipped, `summary.release.simulated`); `mockSequences.action_errors`
  counts it like an action.
- Cut lines (#260, service): a roadmap stage with `release: { name }` holds every stage after it.
  `advance` returns `release: { stage, name }` once the stages up to the line are finished; the
  service (`roadmapRelease`, src/service/areas/releases.js) starts release.yaml with the project's
  folder, base and the history since the last release, and records `runId` / `status` on the line
  (`takeRelease`: `running` → `shipped`, or `held` / `failed` through `holdRelease`, which pauses a
  running roadmap with `releaseHold`; Resume starts a new release run; a resumed release run, or
  one of the line's name started from the Releases screen, takes the line and undoes that pause).
  A shipped real run is recorded in
  `<workspace>/releases/<project id>.json` (`afterRelease`); a simulated roadmap's release run is a
  simulation whose Ship only opens the line.
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
  The stage a dispatch runs is `currentStage`: the first **enabled** stage with an item not done or
  skipped. A stage with `disabled: true` (#284, the owner's switch in the stage's ⋮ menu) is skipped
  whatever starts the dispatch: nothing of it starts, its cut line holds nothing (`pendingRelease`),
  the stage after it runs as if it were not there, and a roadmap whose enabled stages are all
  finished is `done` while the disabled ones stay planned. Enabling a stage makes it eligible at the
  next dispatch, in its place; enabling one on a `done` roadmap starts nothing (the owner starts it).
  "Run this stage" on a disabled stage is refused (`setState`). The Night watch (`unfinished`) and
  the Live roadmap's refill (`applyRefill`) do not count a disabled stage's items as work left.
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
