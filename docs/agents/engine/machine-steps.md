# Machine steps: screenshots, release version, test ids, check, record docs

The steps without an agent besides the suite (the SDLC post-flow's `record_docs` of sdlc-record and sdlc-test included), and the test requests, coverage and file guards around the test steps.

- A **screenshots step** (`type: screenshots`, no agent, #144; `runScreenshots` → `packages/engine/engine/screenshot-step.js`): `from: <step>` (whose output lists `screenshots: [{ name, caption, args }]`, `args` = the options of the project's screenshot command), `folder` (default the step id), `base` (template, the ref of the "original" side; default the worktree's base ref), `timeout` per shot (default 3m). It runs `npm run screenshot -- <args> --out <run_dir>/evidence/<folder>/round-<visit> --name <name> --side modified`, then the same with `--side original --ref <base>`, with the agents' environment (simulation only, scratch workspace); at most 8 entries, `--out/--name/--side/--ref/--caption` in `args` are refused. It never fails and never calls the supervisor: an empty list, a simulated run (`mock`: nothing is launched), no worktree, no `screenshot` script in the worktree's package.json, an invalid entry, a timeout or a crash end up in its output `{ kind: 'screenshots', folder, round, dir, taken, screens, screenshots: [{ path, caption, side }], errors: [{ name, side?, error }], reason, message }` (`message`: "N screenshots of M screens taken in round n" or "No screenshots: <reason>"). software-development and local-hero run `developer_screenshots` (from `develop`, folder `developer`) on every way into `developer_check`, whose message shows `message`; the gate's Artifacts panel shows that round only (`lastCapture` in gate-panel.js).
  - **The screenshot slot (#199)**: at most one Electron screenshot process at a time on the machine, across all runs and apps. Each capture of the step takes the machine-wide slot (`packages/engine/engine/machine-slot.js`, `acquireSlot('screenshot')`: a file `<os tmp>/craftorio/locks/screenshot.slot` with pid, host and token, or under `CRAFTORIO_LOCKS_DIR`) and passes its token to `npm run screenshot` (`CRAFTORIO_SCREENSHOT_SLOT`), which then does not wait for it. While another run holds it the step emits `screenshots.waiting` (`holder_pid`) and a log line "waiting for the screenshot slot". `scripts/screenshot.js` takes the same slot itself (`acquireSlotSync`), so an agent's `npm run screenshot` (evidence, test writer, E2E runner) waits too and prints the same line. A slot whose process is gone, or held over 15 minutes, is freed; a wait over 20 minutes fails that capture.

- **`type: push_base`** (#861, `push_main` of a Local feature/fix run, `fragments/local-merge-pipeline.yaml`):
  no agent, no model call. After `merge: local` the engine pushes the local base
  (`packages/engine/engine/run/machine-steps.js` `runPushBaseStep` → the machine adapter's `pushBase`,
  `packages/engine/engine/machine-actions.js` → `packages/engine/domains/local/local-push.js` `pushBase`; an origin that is the person's own folder is synced as in [worktrees.md](../worktrees.md), Local
  workflows). Never fails the run. Output `{ kind: 'push_base', pushed, summary, target, how: push | fast-forward,
  reason, commands }` (`steps.push_main.output.pushed` / `summary` as the agent's output had), `ctx.local_push`,
  and a log line (warn when nothing moved, with the commands, shown in the run's chat). A simulated run merges
  nothing locally, so it pushes nothing (`pushed: false`).

- **`type: release_version`** (#325, release.yaml's first step): no agent; the rendered `version`
  (a semver, a leading `v` dropped) into the package.json of `dir` (default `{{ worktree_dir }}`)
  and the root `version` / `packages[""].version` of its package-lock.json or npm-shrinkwrap.json,
  formatting and line endings kept, one commit on `branch` (created when the worktree is detached)
  (`packages/engine/domains/releases/releases.js` `writeReleaseVersion`). Nothing written, with the reason in the output and the
  run log, for a name that is not a semver, no package.json, the same or a lower version, a run
  without its own worktree, or a git error: it never fails the run. Output: { status: written |
  unchanged, from, to, files, commit, change: "package.json 0.3.0 → 1.2.0", message }. Simulation:
  nothing written, `change` says what a real run would set. **Products** (#46): when the manifest of
  `dir` declares `products` ([repository-workflows.md](repository-workflows.md)), the step releases the
  one its `product` template names (empty: the only one; `productOf`): `runProductVersion` (run/release-steps.js) → the machine
  adapter's `writeProductVersion` (releases.js) runs its `version_command` through the adapter's
  `runAction` environment and commits every file it changed, or releases it as it is when it has the
  version. What cannot be released **throws** (the run fails before the suites, the worktree as it was).
  Output adds `product`, `tag`, `tag_prefix`, `folder`, `issues`, `missing_changesets` (a warn log
  too), `history` and the product's own `previous_version`. The service records another product's
  release with `product` (`packages/engine/service/areas/releases.js` `otherRelease`).
  - **Test requests** (#212, `serveTestRequests`): an agent turn that ends with a ```` ```run-tests ````
    block (`parseTestRequest`: test files, or `affected`) has them run by the engine in the agent's
    working folder (log `logs/tests-<step>-<n>.log`), then the agent resumes in the same step with a
    summary only (`testResultsPrompt`: counts, failures with their first 3 lines, the log's path), at
    most 3 per turn; `summary.suite_runs.requests` counts them.
  - **`full_suite: warn`** on an agent step: a tool call of its agent that starts the whole suite
    (`isFullSuiteCommand`: `npm test`, `pytest`, `go test ./...`, `dotnet test`, `mvn test`, the
    suite step's own command…) is noted, not refused: a `log` warn `kind: full_suite_by_agent`.
  - `summary.suite_runs: { engine, agents }`: whole-suite runs by suite steps and by agents (the
    measure of #177).
  - **`files` / `expect: red`** on a suite step (#220): only the listed test files (a template such
    as `"{{ steps.acceptance_tests.output.tests_added }}"`; missing files are left out, log
    `logs/<step>-<visit>.log`), never the whole suite after them. `expect: red` makes it a red check
    (`redCheckOutput`, `suiteStep.redCheck`): `red_check { red, green, partly_green, broken }`,
    status `broken` when a file cannot run (else `pass`), no base check, `affected_tests` /
    `affected_reasons` from `relatedTests` (the existing tests reaching the sources the new tests
    import) and a `message` for the next prompt. Simulation: default red; `mockSequences.suite`
    `pass` = all green, `broken` = all broken.
  - **`expect: green`** (#355, `workflows/refactor.yaml`'s `green_check`): the listed tests pin the
    current behaviour and must pass on the unchanged code: a plain `pass | fail | blocked` status,
    no base check (a pinned test that fails is never waved through as failing on the base).
    Simulation: default `pass`.
  - **`coverage: true`** on a suite step (#225; set on the bundled development workflows' `suite`):
    a `node --test` command runs with `--experimental-test-coverage` (`suiteStep.coverageCommand`);
    an npm script (`npm test`, `npm run <name>`, with `-- <files>`) runs its `<name>:coverage`
    script when package.json has one (this project: `npm run test:coverage`), else a script that is
    a plain `node --test …` runs inlined with the flag; any other command runs without coverage. Whenever the output (or the #219
    human log) has node's coverage table, `coverage/coverage-summary.md` (totals and the changed
    files' coverage, `packages/engine/domains/evidence/coverage-summary.js`) is saved as a Tests artifact and the output gets
    `coverage { lines, branches, functions, files, path }`. No model call.
  - **`result.md`** (#225): `finish` writes the run's result summary (`packages/engine/domains/evidence/result-summary.js`: status,
    issues, commits, suite results, coverage, screenshots, key artifacts) before `workflow.finished`;
    it is the run's first artifact (category `result`, `packages/engine/domains/evidence/artifact-categories.js`).
  - **New elements** (#185): a screenshots step's original side that failed only with
    `screenshot: nothing matches <selector>` while its modified side was taken goes to
    `new_elements`, not `errors`; the message counts them (`2 new elements (no original)`) and
    `recordEvidence` keeps the step's outcome in the evidence manifest (`captures`).
  - **`protect_files`** on an agent or an agent step (#220, the step's wins): a file list template
    rendered before each turn; `sendToAgent` snapshots exactly those files (`testPaths.snapshot`
    with the paths as patterns) and refuses a turn that changes one, like `edits_tests: false`
    (`protectedRefusedPrompt`, event `tests.refused` with `protected: true`, log `kind:
    protected_refused`, the turn fails after 2 retries), whatever `edits_tests` says.
  - **`test_map: true`** on an agent step (#219): `writeTestMap` writes the code → tests map of the
    agent's checkout to `<run_dir>/test-map.md` before each turn and passes its path as
    `{{ test_map }}`.
  - Agent mode (#219): `suiteEnv` sets `CRAFTORIO_AGENT_MODE=1`, and each run gets
    `CRAFTORIO_TEST_HUMAN_LOG=<log>.human.log`; a runner that knows them (this project's
    `scripts/test.js`) prints one failures-only JSON line, read first by `parseFailures` /
    `parseCounts` (output `human_log`, `file_counts`, failures with `line` and `kind`).
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

- A **test id step** (`type: test_ids`, no agent, no model call, #246; `runTestIdsStep` →
  `packages/engine/engine/test-ids.js`): the static `getByTestId('…')` ids of the E2E step definitions (`steps`,
  default `features/steps`) that the renderer's source (`renderer`, default `src/renderer`) does not
  contain; both are repository-relative templates that render to one folder or several (one per line
  or comma-separated, #588), and the output lists them. Output `{ kind: 'test_ids', status: pass |
  missing | skipped, missing: [{ id, files }], steps, renderer, round, message }`; `skipped` when the
  project has no step definitions. The same rule backs the `missing_test_ids` filter
  (`{{ worktree_dir | missing_test_ids(steps, renderer) }}`, one line per id) and test/e2e-playwright.test.js.
  ai-development-local-hero passes its `steps_folders` / `ui_folders` inputs (#588; defaults
  `features/steps`, `src/renderer/`); the `ui_files(folders)` filter keeps the files of a list under
  the UI folders, so a change there routes to `developer_screenshots` and the UI reviewer.
  ai-development-local-hero runs it as `testid_check` after each develop commit when the scenarios
  were written first (`e2e_scope: scenarios`): missing ids go back to develop at most twice
  (`vars.testid_returns`), then develop's own routes follow.
- A **visual baseline step** (`type: visual_baselines`, no agent, #696; `runVisualBaselinesStep` →
  `packages/engine/engine/visual-baselines.js`): the `toHaveScreenshot` names of the `@issue-<n>`
  scenarios (`issues`, comma- or space-separated; a quoted `…png` in the step text, `<placeholder>`s
  expanded from `Examples`, or the static name of the step definition it matches under `steps`)
  with no `features/__screenshots__/<name>-<platform>.png`. Output `{ kind: 'visual_baselines',
  status: pass | missing | skipped, missing: [{ name, file, feature, scenario, command }], round,
  message }`; the message names each file and its `npm run test:e2e:update -- --grep @issue-<n>`.
  ai-development-local-hero runs it as `baseline_check` right after a passing `testid_check`
  (scenarios written first): a missing baseline goes back to develop at most twice
  (`vars.baseline_returns`).
- A **check step** (`type: check`, no agent, no model call, #404; `runCheckStep` →
  `packages/engine/engine/check-step.js`): the project's rule checks in the run's checkout, `command` (a
  template; empty: `npm run check` when the project's package.json has a `check` script) through the
  suite's `runCommand`, `timeout` optional (default 10m), the log in `logs/check-<visit>.log`. `dir` (a
  template, #63) runs it in another folder, for a workflow without a worktree (backlog-refresh's
  `repository` step); the processes of that folder are never swept. It runs
  in a mock run too (a local, free check, like the test id step). Output `{ kind: 'check', status:
  pass | fail | skipped, command, findings, message, round }`: `findings` are the command's last 40
  lines, `skipped` when there is no checkout or no command. ai-development-local-hero runs it as
  `rule_check` after each develop commit (input `check_command`), the last agent-less step before
  the owner's gate or the review; the routes into it test `worktree_dir | check_command(...)` (the
  template filter), so a project without a check command never visits it. A failure goes back to
  develop with the findings at most twice per review round (`vars.check_returns`), then to the
  `check_failed` gate; a pass goes to `docs_check` (#757).
- A **docs check step** (`type: docs_check`, no agent, no model call, #757; `runDocsCheckStep` →
  `packages/engine/engine/expected-files.js`): the paths the run's issues list under `## Expected
  files` (in `inputs.task`: the first backticked path of each item, `(new)` dropped, directories
  with their slash), only the docs among them (under `docs/`, `README.md`, any `*.md`), against the
  run's diff since `base` (a template; the `changedFiles` of affected-tests.js). Output `{ kind:
  'docs_check', status: pass | missing | skipped, expected, touched, declared, missing, message,
  round }`; the message starts with the counts the timeline shows (`docs expected: 2, touched: 0`).
  `pass` when one expected doc is touched (a directory entry: any file under it) or every untouched
  one is in the `left_out` of the step named by `from` (default develop) with a reason (the
  reviewer still judges it); `skipped` without docs to expect or without a checkout. feature and
  the AI Development heroes run it as `docs_check` right after `rule_check` (or in its place
  without a check command): `missing` goes back to develop with the list at most once per review
  round (`vars.docs_returns`, reset when it goes on), then `developer_check` (validated mode) or
  the review.
- A **record docs step** (`type: record_docs`, no agent, no model call, #702; `runRecordDocsStep` →
  `packages/engine/engine/record-docs-step.js`): the SDLC post-flow's record of a successful Code &
  Build run in its work item's documents (`docs/work/<item>/`), in the run's own worktree. It reads
  only the step's inputs: `item`, `run`, the run's declared `evidence` output, `merged_commit`,
  `pr_url`, `issues`. It writes plan.md's `## Progress` row (done, the run, the commit or the PR; every
  row done → `status: built`, the reader then shows the item in Test) and one test.md row (EN and
  pt-BR: run, unit and E2E counts, screenshots taken or the run's reason for none, axe findings, never
  an empty cell; `status: collecting`; an item without test.md gets it from the skeleton), copies the
  screenshots to `images/` (a name an earlier run's image has becomes `<run>-<name>`), runs DocModel's
  lint (`lintDoc`, `lintTranslation`) on every document first (a problem writes nothing: `status:
  invalid`), then makes one docs commit (a docs commit runs no tests, #695). With `stage:` (in review
  | passed | failed) it records the Test stage instead: test.md's status and the run's summary.
  `sdlc-record` merges `local` only: a project that works with PRs pauses the chain (no
  `merged_commit`) and its record stays a local commit until the owner pushes it.
  Output `{ kind: 'record_docs', status: recorded | invalid, commit, files, problems, built, message }`.
  Used by `sdlc-record` (one step, then the merge the project works with) and `sdlc-test` (the full
  suite with coverage, the full E2E with `@visual` baselines, the ui_reviewer against the spec's
  mockups, evals, then `in review` and the code owner's `human_approval` gate: approve → `passed`,
  reject → `failed` and fix issues). sdlc-test is started from the Roadmap on a built item only
  ("Start Test"), never by a chain.
