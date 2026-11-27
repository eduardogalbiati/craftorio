# The suite step

The orchestrator runs the project's whole test suite (`type: suite`, #177): command, scopes, waits, failures.

- A **suite step** (`type: suite`, no agent, #177; `runSuiteStep` → `packages/engine/engine/suite-step.js`): the
  project's whole test suite, once per visit, run by the orchestrator instead of an agent (an agent
  running it kept its turn and its 100k+ context open for minutes, several times per run).
  `command` (template; empty → `detectTestCommand` from the worktree's files: package.json's test
  script → `npm test`, go.mod, pom.xml/mvnw, build.gradle/gradlew, *.sln/*.csproj, pyproject.toml…),
  `timeout` (default 30m). It runs in the worktree with the agents' environment, its whole output in
  `<run_dir>/logs/suite-<visit>.log` (`file.saved`), announced before the first line by a
  `step.log { step_id, path, command }` event (#465: path relative to the run folder; `base: true`
  for the base check's `-base.log`; the `check` and `screenshots` steps emit it too, for
  `logs/check-<visit>.log` and `logs/screenshots-<visit>.log`, and a suite waiting for the machine
  writes that line to its log first), which the Run screen's live terminal follows, and reads the failing tests from it
  (`parseFailures` in `suite-failures.js`: node:test spec/TAP, Jest, pytest, go test, cargo test,
  dotnet test, Maven, Playwright; a cargo failure carries its test binary, `bin`). Output `{ kind:
  'suite', status: pass | fail | blocked, round, command, log, exit_code, duration_ms, timed_out,
  failures: [{ test, file, error }], preexisting, reason, message }`; the run's known pre-existing
  failures (`notePreexistingFailures`) are moved to `preexisting` and never fail it; `blocked` = it
  could not run (no worktree, no command). It never throws and never calls the supervisor: the
  transitions route it. The other failures are checked on the base by the step itself (#211): their
  test files run in the base checkout (`suiteBase`, prepared on demand, so `run_existing`/`off` runs
  get it too), cached per base commit + file in `cache/base-tests/`. cargo test (#109) names tests,
  not files: they run by name (`cargo test --no-fail-fast -- <names>`; the whole `cargo test
  --no-fail-fast` for a doctest or a line too long), cached per commit + `cargo:<bin>::<name>`; every
  cargo round (and the service's base check, `cargoNoFailFast`) runs with `--no-fail-fast`, so a binary red on the base never hides the others. Those failing there too become
  `preexisting_failures` (the run's list, the summary, the project's base-health store below).
  **Main stays green (#405, `packages/engine/domains/project/base-health.js`, wired in `packages/engine/service/areas/base-health.js`)**: a
  real run's `preexisting_failures` are recorded per project in `backlog/base-health/<project>.json`
  (test, file, first/last seen, runs; the engine records them, the service files); seen by 2 runs, a
  failure files one bug issue, updated (a comment) by every later sighting, never a second one.
  #749: the base check runs once per roadmap stage (`afterStageEnded`, when the dispatch sees the
  stage's last item finished, `roadmaps.endedStages`, with the stages open at the previous dispatch
  so a stage a skip or a Move on finished counts too; a roadmap run's `worktree.merged` only records
  the base), after a `worktree.merged` of a real run outside the roadmap (merges until that check
  holds the suite slot share it, on the latest tip), and at once for `tested: 'not green'` (trigger
  `not-green`). It is `skipped` (no suite, the Roadmap's card reads green at that commit) when the
  tip is the store's `lastGreen.commit` or the commits since it touch only `docs/**` and `*.md`
  (`UNTESTED` in `domains/project/base-health.js`), never for `not-green`. The docs skip trusts the
  run's own suite (#736) for the tests that read docs (`test/docs-*.test.js`, `test/agents-md-331.test.js`). Otherwise the base check runs the whole suite on a
  clean detached checkout of the local base tip (`worktrees/base-check-<project>`), with no agent,
  `CRAFTORIO_SIMULATION_ONLY=1`, its own lock folder, the suite timeout from the project's recent
  durations, one check at a time. While a release run holds the base it is deferred, and runs when
  that release run ends. The check takes the machine-wide `suite` slot (#527, like a run's
  whole-suite round, #455) before its `npm test` and frees it on every exit (green, red, error);
  while a run holds it the check waits, logs "base check waiting for the suite slot" in the server
  log and shows `waiting` on the Roadmap's base-check card. Before the suite the checkout gets its
  dependencies (#598, `depsFor` in `packages/engine/service/areas/base-health.js`): the shared cache
  when it serves the project (a workspaces monorepo included, #599), else the project's own install
  (`npm ci --no-audit --no-fund` for npm), its time and output in the check's log
  (`worktrees/base-check-<project>-suite.log`). A check that could not run (`status: 'error'`: the
  install failed, test files but no test command, the runner crashed; a project with no test file
  either ends `no_tests`, #71, no notice) writes one engine log line with the reason and
  the log file and notifies "Base check could not run: <reason>", with no issue and no fix item
  (nothing is known about the tests). The store records the last check as
  `lastCheck: { commit, at, status }` (`green`, `red`, `error`, `no_tests`); `lastGreen` stays the last green
  commit. Two rounds (#613, widening #527's timing-only re-run): when the whole suite has failures,
  a second round runs only the failed tests' files, one command (the list file of #553/#597 when
  they do not fit the command line), in the same base checkout while the check still holds the
  suite slot, its log in `worktrees/base-check-<project>-rerun.log`; a green check runs no second
  round and no test runs a third time (a timing failure goes through the same round). Only a test
  red in both rounds is stored with `confirmed_at` and filed. A test red then green is logged "red
  in the whole suite, green on the re-run" with the runs active at the time and kept as a flaky
  sighting in the store (`flaky: [{ test, file, commit, at }]`), nothing filed or reopened; when
  every failure was green on the re-run the check is `green` (`lastGreen` unchanged). #78: a second
  round that throws, times out or does not start confirms nothing: its tests stay in the store as
  sightings without `confirmed_at`, nothing is filed and, with nothing else red, the check is `error`
  (inconclusive, shown on the Roadmap like any check error); a failure without a file is filed after
  the first round. A test the runner cancelled or never finished is not red either (node:test's
  "Promise resolution is still pending…", or a `fail 0` / `cancelled N` summary,
  `suite-counts.js splitCancelled`): a round with only cancelled tests is an `error` ("the suite was
  cut short: N file(s) cancelled, 0 failed"). A `gh issue create` that answers an error looks the
  issue up by its title before recording none. The red tests file (or update) one issue per cause (#695):
  the failures of one test file red since the same first red commit are one group, titled by the
  file (`Red on the base: test/doc-editor-646.test.js (19 tests)`) and listing every test, with the
  commit range (the last green check, the first red commit) and the log; a group whose entry has an
  issue comments on it (the newly red tests, last seen) instead of opening another, and the "Fix
  the base" item holds one issue per group. A test red again after a green check reopens its
  issue. Settings › Execution `baseCheck.onRed` (`off` | `issue` | `fix`, default `off` since #85: no check runs until it is turned on) set to `fix`
  adds a fix item, mode auto, in a new stage before the roadmap's current one (`insertFrontStage`;
  none while the roadmap plans that issue already, nor for an issue a live run works on, #527; the
  item is marked `source: 'base-health'`, and the dispatcher skips it with a log line instead of
  pausing the roadmap when its issue "already has a live run"). The fix item runs the project's default
  development workflow (`projects.projectDefaultWorkflow(p)`, #413, #790: the project's own, then its
  manifest's `default`, then its first build workflow, then `feature`; no global setting). A red or failed check notifies the owner.
  It never pushes, never answers a gate and never changes a running item. The Roadmap bar shows
  "N known failures on the base" (`backlog:get` `baseFailures`). The
  suite gets a shell-like env (`suiteEnv`: no Electron/npm/inspector variables, no scratch
  workspace, its own `CRAFTORIO_LOCKS_DIR`, #210); without a step `timeout`, the timeout is 3× the
  median of the project's recent durations (`cache/suite-durations.json`, min 10 min, 30 min with no
  history), and a timeout names the test files still running. A timed-out round is checked like a
  failure (#396, `rerunAlone`): each file still running reruns alone on the branch and, when it hangs
  there too, alone on the base, each with its own timeout (3× its recent alone runs, at least 2 min;
  logs `suite-<visit>-alone-<n>[-base].log`, `output.alone`); one that finishes alone, or hangs or
  fails on the base too, is a failure outside the change with its reason, instead of "(the whole
  suite)"; the finished files' failures are kept. Every counted failure gets `class` (`in the
  change` | `outside the change`) and `class_reason` (`classifyFailures` in affected-tests.js: its
  test file is changed or reaches a changed file through the import graph; when it cannot be told,
  in the change), and the output counts `in_change` / `outside_change`. AI Development (local hero)
  routes `output.in_change == 0` with the input `suite_red_outside_change: continue` to the build (or
  e2e) without `test_failed`, with `set: { tested: "not green" }` (so does Continue at the gate);
  `summary.json` then has `tested` and `tested_failures`. #71 (`suite-no-command.js`): with no command
  and no test file (`tests_paths`) the status is `not_run`, routed on by feature and fix with
  `set: { tested: "no tests" }` unless `no_tests: ask`; a step whose transitions do not name `not_run`
  gets it as `blocked`. #81: test files with no command found end `not_run` with `no_command: true`,
  routed on by feature and fix with `set: { tested: "no test command" }` whatever `no_tests` says.
  Before that, at the run's start, `checkout.js logRepoCommands` sets `no_test_command` in the
  templates' context (no command given or found; never in a mock run): the test writer writes no test
  file, and code_review (feature, fix) skips the test steps straight to the build / verification with
  the same `tested` (unless `no_tests: ask` or test files were written anyway). Filter `suite_failures`
  (`{{ steps.suite.output | suite_failures }}`): the message plus one line per failing test (with
  its class), for a prompt or a gate. Simulation: `mockSequences.suite: { <step>: ['fail', 'pass'] }` per visit
  (default pass; `preexisting` = only the run's pre-existing failures fail, so it passes; `base` =
  the failures fail on the simulated base too, a pass; `mixed` = 2 failures, one on the base, a
  fail; `outside` = a failure outside the change, a fail; `blocked`), a simulated log is written.
  - **`scope: affected`** (#212, default `full`): each visit runs only the affected test files
    (`affectedSelection` → `packages/engine/engine/affected-tests.js`, plus the files that failed in an earlier
    round, `suiteFailedFiles`), the command filtered to them (`filteredCommand`); when they pass and
    the whole suite has not passed yet in the run (`fullSuitePassed`), the whole suite runs right after
    (log `suite-<visit>-full.log`, the affected run in `output.affected`). Output adds `scope` (full |
    files), `selection` ({ mode, files, reasons, why }: "imports packages/engine/domains/roadmap/roadmap.js"), `passed`, `failed`;
    `summary.suite_runs.affected` counts the affected runs. Simulation: two simulated files.
  - **`scope: failed`** (#324, release.yaml's `e2e`): the first visit runs the whole suite; a later
    visit runs only the files that failed in the step's previous round (its `failures[].file`) plus
    the `.feature` files changed since the base (the fixes), `selection.reasons` "failed in round 1",
    then, when they pass, the whole suite in the same visit (log `<step>-<visit>-full.log`, the
    focused run in `output.affected`): only a green whole run is a `pass`. A red focused run is the
    visit's result (`scope: files`, no whole run). A previous round without failed files, or a
    command `filteredCommand` cannot filter, runs the whole suite (`selection.why` says so).
    #364: every suite round records `commit` (the worktree's HEAD) and `clean` (no uncommitted or
    untracked change) as it starts. When the tree is clean at the commit of the step's last round
    that ran the whole suite to the end (clean too; not blocked, not timed out), a green focused run
    completes the visit with no whole rerun, a whole `pass` as the Ship gate shows it (`scope: full`,
    the focused run in `affected`, `whole_run: { round, commit, passed, failed }`, log "no commit
    since round 2's whole run (abc1234): the failed files passed, the whole suite is not rerun"):
    that whole run's result stands for the other files. A commit or an uncommitted change
    since, or a whole round without a recorded commit, keeps the whole rerun; a red focused run
    still fails the visit. Applies to any step with this scope (unit or e2e).
    `filteredCommand` filters `npm|pnpm|yarn test`, a package script with no arguments of its own
    (`npm run test:e2e -- <files>`, `pnpm run e2e <files>`, `yarn e2e <files>`), pytest and
    `node --test`. The command line has a limit (#400, `COMMAND_LINE_LIMITS` in
    suite-command-line.js: Windows `cmd.exe` 8,191 characters, Linux 128 KiB, macOS 256 KiB, minus
    a 100-character margin; the platform is `runSuite`'s `platform`): a filtered command over it,
    coverage and workers wrappers included, gives its files through a list file named by
    `CRAFTORIO_TEST_FILES` (#553, one path per line, `files_list` in the output) when the npm
    script is `node <file>` and that file reads the variable (scripts/test.js), and stays
    `scope: files`; any other runner runs the whole suite instead, `selection.why` and the message
    saying "319 test files would put the command over the Windows command-line limit of 8,191
    characters, and `npm test` cannot read the list of CRAFTORIO_TEST_FILES: the whole suite ran".
    The same holds for every caller: the base check of more files than fit is
    skipped with that reason, and a timed-out file reruns alone (always short). A round the shell
    refused ("The command line is too long.", "Argument list too long": the log's last line, no test
    result) is `blocked`, not `fail`: the test writer is not sent to fix it, the gate says the suite
    could not run. So is a round whose command was not found: exit code 127 (9009 on Windows) without
    a failing test or, on Windows in any language, no test ran and the program exists nowhere (#67,
    command-missing.js). Filter `suite_scope` (`{{ o | suite_scope('scenario') }}`): a round as "focused on
    2 files: …, 1.5 min; then whole: …" or "whole: …", for the release summary.

## The whole round's own command (`whole_command`, T6)

A `scope: affected` step may name the command of its whole round (the one run per run, after the
affected test files pass): `whole_command: "{{ inputs.whole_test_command }}"`. Empty, the step's
`command` runs whole, as before. This repository's hero workflows set it to `npm run test:affected`
(`scripts/turbo-affected.js`): every test of the workspaces the change reaches, through Turborepo,
from the cache where nothing they read changed. The round gets `TURBO_SCM_BASE` (the run's base)
and `TURBO_CACHE_DIR` (`<workspace>/cache/turbo`, shared by the runs), both added to the suite's
passthrough (#470). Such a runner prints one agent report per workspace, each behind the task's
prefix; `parseAgentReport` (`packages/engine/engine/agent-test-report.js`) reads them as one report,
adding the counts and the failures. The base check of each roadmap stage still runs the whole suite.
