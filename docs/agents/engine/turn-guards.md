# Guards around a turn

Tool timeouts, test inputs, the environment allowlist, the base worktree, dependencies, the memory guard and self-healing.

- **`tool_timeout` (#178)**: a tool result cut by the tool's own timeout (`isToolTimeout` in
  providers.js: "Command timed out after …", Claude Code's Bash default is 120 s without a
  `timeout`) is a `log` warn `kind: tool_timeout` with the command and `timeout_ms` (null = the
  default), counted in `summary.tool_timeouts`. Simulation: `mockSequences.tool_timeouts: { <step>: n }`
  (the first n answers of that step have one test command cut at the default).

- **Ask for changes through the test writer (#247)**: in ai-development-local-hero, `developer_check`'s
  `changes` goes to `acceptance_tests` (`vars.criteria_triage`), whose prompt quotes the owner's request
  and asks for a triage: `criteria_changed: false` → develop; `true` → `red_check` on `tests_changed`
  only, then develop. The developer's prompt gets the request and the test writer's `criteria_note`.
- **Test inputs (#203)**: the development workflows' `unit_tests` (write_and_run | run_existing |
  off) and `e2e_tests` (off | write | write_and_run) route the transitions (code_review/human_review
  → test, suite or build; test → suite or build; suite failures → test writer or developer) and
  the test writer's skills and prompt. `testsPlan` (workflow.js) turns them into `ctx.tests_plan`
  ("Unit tests: Off (workflow default). E2E tests: Write (chosen for this run).": a value differs
  from the workflow's `default` = chosen for this run), and `tests_plan: [{ input, label, value,
  value_label, source }]` in `workflow.started` and the summary (runs.js `testsPlan`, the Run
  screen's badges). The gates and the verifier's prompt show it; nothing off is reported as tested.
  `test-backfill.yaml` writes the skipped tests later, for a range of local commits, in one session.
- **`env: { passthrough: [NAME, …] }`** (#470, workflow level): child processes get an allowlisted
  environment (`packages/engine/engine/child-env.js`, [capabilities.md](../capabilities.md) "Child
  environment"); these exact variable names are added to the agents', the transition actions' and
  the suite's environment (a project whose tests need `DATABASE_URL`). The loader refuses an empty
  or non-name list. Per-project passthrough does not exist yet.
- **`base_worktree: true`** on an agent step (#198; needs `orchestrator.worktree`): before each visit the engine prepares the run's checkout of the base (`<worktreesDir>/<run_id>-base`, detached at the current base, dependencies linked from the shared cache) and gives it as `base_worktree_dir` (empty without a worktree), for the test writer's pre-existing-failure check. See [worktrees.md](../worktrees.md).
- **`deps.ready`** (#198): the run's dependencies from the shared cache, after `worktree.ready`, for the base checkout and after an agent step that changed the lockfile (`{ for: worktree|base, after, status, hit, lockfile, manager, key, entry, seconds, waited, reason }`; nothing when the folder already links its key). Agents with commands get a line about it in their command guide (`depsGuide`). See [worktrees.md](../worktrees.md).
- **Memory guard** (#276, `packages/engine/engine/memory-guard.js`; Settings › Execution, `settings.memoryGuard`
  `{ enabled, limitPercent: 25, floorPercent: 10 }`; **off by default** since #129: the owner turns it
  on, and a saved old default `{ enabled: true, 25, 10 }` without the `chosen` mark reads as off): a
  deterministic watcher, no AI call. Off, no run waits for memory, no process is stopped, no stray
  check runs and Concurrent runs gets no suggestion from its history. While a
  real run's agent turn, `suite` / `e2e` execution or screenshot capture runs, its process tree is
  sampled every 5 s (Windows: committed bytes through one long-lived PowerShell helper; Linux:
  /proc; macOS: one `sh` loop around `ps`) and a descendant over the limit is stopped with its
  children: a `process.killed` event `{ pid, command_line (300 chars), bytes, limit_bytes, step_id,
  session }`, the agent's next prompt says "The orchestrator stopped `<command>` at <n> GB for
  passing the memory limit", a suite's `message` names it, and the second stop of the same command
  in a step carries `notify: true` (one notification). Never stopped: the app, the agent CLI's root
  process (a `memory_over_limit` log instead), anything outside the run's tree. A sampler that fails
  logs `memory_guard_off` once and the run goes on. Before each suite / e2e execution the step waits
  while free memory (Windows: free commit; Linux: `MemAvailable`; macOS, #128: free + inactive +
  speculative pages of `vm_stat`, through the same `sh` helper) is under the floor, at most 10 min (`memory_hold` log,
  `memory.hold` event); a new real run is refused meanwhile (`memoryHold` in
  `packages/engine/service/areas/runs.js`; the roadmap and the queue hold the item and a 30 s timer dispatches
  again when memory recovers). #128: a held roadmap start shows why on the Roadmap's header
  (`memoryHold` in the view: "Waiting for memory: X GB free, under the floor of Y GB (Settings ›
  Execution › Memory guard)") with one notification per wait. A round that fails while the guard recorded a stop or a low-memory
  period in its time window reruns in the same visit (`<log>-env.log`, output
  `environment_reruns`, at most 2): only the last result is routed, so it uses no visit of the
  suite → test transition. A simulation has no guard (`run.memoryGuard` null) unless one is given
  (`new WorkflowRun({ memoryGuard })`); `mockSequences.suite.<step>` is indexed by execution (a visit
  plus its environment reruns). The Night watch records `process.killed` and a hold over 5 min as a
  `memory` incident and takes no action.
- **Self-healing** (#278, `settings.oracle.selfHealing`, default off): the Oracle's watch stays on day
  and night with no end time (`oracle-actions.watchState`: `{ active: true, until: null,
  selfHealing: true }`; off, it is the Night watch as before). Under it an action whose permission
  is checked runs alone by day as at night (`nightDecision`: the permission, the kind's `night`,
  `LOOP_CAP` per item, counted per UTC day: `watchSince`); the others stay cards in their owner's
  inbox. In the inboxes (`agent-inbox.waitReason`) that rule applies to what the Oracle's model
  asks: a kind no permission covers, and the owner's own requests, keep the daytime rules. Detectors in code (`night-watch.detectSelfHealing`, pure functions over run events, no
  model call until one fires): `memory` (`process.killed`, or a `memory.hold` over 5 min),
  `cost-gap` (a `session.message_received` with `cost_usd` 0 and tokens, or below a `usage` stream
  item of the same turn; never a simulated run, nor a CLI that reports no cost: `cost_usd` null),
  `environment` (a test file in the `failures` of a
  suite `step.finished` whose base check ran, in two runs of different issues within one hour) and
  `repeat` (the same command failing, a `tool_call` whose `tool_result` has `is_error`, or stopped
  by the memory guard, three times in one step). The service (`channels/nightwatch.js`) keeps a
  small per-run buffer of the events they read, logs each finding once per run and kind
  (`oracle.detected` with `evidence`) and wakes the Oracle with it (`wake({ findings })`, batched
  over 30 s; in the wake-ups' scope only: not when `wakeScope` is `off`, nor for a muted run): the Oracle asks the Product Owner to file an issue in
  the run's project and append it to the roadmap (`issue.file`, `roadmap.add`: the `file-issue` and
  `append` permissions), never edits code, and only reports a cause in this app when the app's
  repository is not a project of the workspace. Those turns count in the Oracle's daily budget;
  while it is paused the findings are still logged and the owner gets one notification. A human
  gate is logged `oracle.escalated`, never answered; nothing in `NEVER_ALLOWED` gains a permission.
  The report has one window per Self-healing day (`selfHealingDays`, `selfHealingMetrics`).
