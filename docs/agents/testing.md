# Testing

Read this before writing or changing tests, and before any check that could start a real CLI.

## Running and CI

- `npm test` = node:test unit tests (`test/*.test.js`, `test/<area>/*.test.js` and every workspace's
  `<workspace>/test/` (`packages/shared/test/`, phase 2 of the reorganisation study; `npm test -w
  packages/shared` runs one workspace's), listed by
  `scripts/test.js`) + a full mock run of software-development.

## Where a new test goes

- Into the existing file of its area, never appended to a catch-all file. The service's tests are
  one file per area in `packages/engine/test/service/<area>.test.js`, matching `packages/engine/service/areas/<area>.js` (and the
  channel files in `packages/engine/service/channels/`), with the shared scratch workspace and fake host in
  `packages/engine/test/service/helpers.js`.
- A new area (a new `packages/engine/service/areas/<area>.js`, a new module) gets a new test file; no list to
  edit: `scripts/test.js` finds it.
- A domain module's tests (`packages/engine/domains/<domain>/<module>.js`) live in `packages/engine/test/<domain>/`, the Electron
  host's (`apps/desktop/host/`) in `test/host/`; a workspace package's tests in its own `test/` folder, required
  relative to it (`../<module>`), and from another package through the package name
  (`@multiagent/shared/test/i18n-sandbox`, `@multiagent/engine/test/contract/harness`):
  `packages/engine/test/` holds the engine's, the service's (`service/`), the domains' (`<domain>/`),
  the contract suite (`contract/`), the slow runs (`slow/`), the fixtures (`fixtures/`) and the helpers
  `engine-helpers.js`, `worktree-helpers.js`; `packages/shared/test/` the shared modules'. The root
  `test/` keeps the repository's own tests (scripts, docs, packaging, the test runner), the renderer's
  and the host's until phase 2's desktop package, and their helpers (`mini-dom.js`, …), required as
  `../<helper>`.
- Node 24's test reporter is "spec", not TAP: look for `ℹ pass N` / `✖`, not `# pass`.
- `npm test` must pass on Windows, Linux and macOS: `ci.yml` runs a matrix (checks `test (<os>)`)
  plus a combined `test` check that is green only when every planned OS is. PRs run Ubuntu +
  Windows; macOS only for platform-sensitive paths or the `ci:macos` label, weekly and on manual
  runs (`scripts/ci-plan.js`, Actions minutes: macOS counts ×10). `preview.yml`/`deploy.yml` build
  on each OS (see [environment.md](environment.md)) and skip `npm test` when CI already passed on the same code (the `ci/tested`
  status CI records on the PR head, with the tree it tested: pending at the start of each run, then
  its result, so only the latest run counts). Tests that pass
  locally can still fail on another OS: CI is the judge.
- The Electron part of `test/screenshot.test.js` (every view of `scripts/screenshot.js` opens and
  quits by itself, ~1 min, ~25 windows) only runs with `MULTIAGENT_UI_TESTS=1`: CI's Windows and
  Ubuntu jobs have a step for it, with the E2E smoke (after `node node_modules/electron/install.js`;
  the matrix sets `ELECTRON_SKIP_BINARY_DOWNLOAD`; Ubuntu under `xvfb-run`, with unprivileged user
  namespaces allowed for Chromium's sandbox). Run it locally when you change the script or add a view.
- **The app's E2E suite (#222)**: Playwright + playwright-bdd, `npm run test:e2e` (`scripts/e2e.js`:
  `bddgen`, then `playwright test`; `-- --grep @smoke`: the 6 critical journeys, ~30 s; `-- --grep
  @issue-<n>`: one issue; `-w fronts/<id>`: one front's features, phase 3 of the reorganisation
  study). Feature files with their packages (the shell's in `features/` and `packages/ui-kit/features/`,
  a front's in `fronts/<id>/features/`; one per area, every scenario `@issue-<n>`), steps next to them
  (`<folder>/steps/`, every steps folder loaded whatever runs), the launch in
  `features/support/app.js` (`_electron` on a fresh demo workspace seeded with scripts/screenshot.js's
  data, simulation only, window off-screen; `MULTIAGENT_E2E_SHOW=1` shows it). Steps assert through
  `getByRole` / `getByTestId` (the renderer's `data-testid`s). Visual baselines:
  `features/__screenshots__/<name>-<platform>.png`, committed, `maxDiffPixelRatio` in
  `playwright.config.js`; rewrite one on purpose only (`npm run test:e2e:update -- --grep @visual`).
  Results: `.test-output/e2e/results.json`; a failed scenario keeps `trace.zip` (with the window's
  screencast: Playwright's recordVideo stalls Electron 44) and `failure.png` under
  `.test-output/e2e/artifacts/` (`npx playwright show-trace <zip>`). CI's Windows job runs `@smoke`.
  Two lanes (#365, Playwright projects in `playwright.config.js`): `behaviour` runs every scenario
  that is neither `@visual` nor `@serial` in `MULTIAGENT_E2E_WORKERS` workers, fully
  parallel, without the machine's screenshot slot; `visual` runs the `@visual` (and `@serial`)
  scenarios one at a time, each launch holding the screenshot slot (#199), so a run capturing
  screenshots elsewhere still makes it wait. A scenario that shares state with another one (a fixed
  file, port or the clipboard) gets `@serial` with the reason in a comment; `MULTIAGENT_E2E_WORKERS=1`
  is the old serial suite. One lane only: `npm run test:e2e -- --project behaviour`.
  Workers (#366): unset or `auto` sizes the behaviour lane from the machine,
  `clamp(1, 4, min(floor(threads / 8), floor((freeGB - 4) / 1.5)))` (20 threads and 11 GB free give 2,
  a 4-vCPU runner 1; constants and measurements in `scripts/e2e-workers.js`); a number forces it, an
  invalid value falls back to auto with a warning. The suite's first line says the choice
  ("E2E: 2 workers (auto: 20 threads, 11.2 GB free)"). On a slow machine, or when scenarios time out
  while other work runs, set `MULTIAGENT_E2E_WORKERS=1`; on a big idle one, a number above auto.
  The app is dark-only today: the light and dark baselines guard `prefers-color-scheme` both ways.
  E2E visual scenarios render at a fixed clock, never the real one (#362): `the app is open in the
  <theme> theme` seeds the workspace and starts the app's main process at `VISUAL_NOW`
  (`features/support/fixed-clock.js`, MULTIAGENT_E2E_NOW), so a baseline with days or hours (the
  hours heatmap) passes at any hour; never fix a clock-dependent diff by raising the limit. A step
  that searches or filters waits for the filtered list itself (no row left from before), never for a
  row that was already there or a fixed sleep (`I search the runs for`).

## Affected tests, the slow suite, who runs what (#212)

- **Affected tests**: `packages/engine/engine/affected-tests.js` (no model) builds the import graph from
  `require` / `import` and lists the test files that import, directly or transitively, a file
  changed since the base (merge-base, uncommitted and untracked files included), plus the test
  files changed themselves. A changed file nothing imports (a workflow YAML, a renderer script a
  test reads with `fs`) reaches the test files whose code names its path. A shared root
  (`package.json`, a lockfile, `scripts/test.js`) or a project without a JS/TS graph selects the
  whole suite. `node scripts/affected-tests.js --base main` prints the files and why each was
  chosen (`imports packages/engine/domains/roadmap/roadmap.js`); `--files` prints only the paths, for `npm test -- <files>`.
- **Slow tests**: files under `packages/engine/test/slow/` or named `*.slow.test.js` (whole simulated runs) never
  join the affected set; they run with the full suite only. Put a test that simulates a whole run
  there, and keep big files split by area so `node --test` runs them in parallel (one file's tests
  run in sequence). See "Whole simulated runs" below.
- **Who runs what**: the suite step with `scope: affected` (software-development and the local
  hero) runs the affected files every round, and the whole suite at most once per run, when the
  affected files first pass (log `suite-<round>-full.log`); the files that failed in a round join
  the next rounds' set. After that whole suite, pass or fail, the next rounds select the files
  affected by the changes since its commit (slow ones included) plus the files that failed, never
  the whole suite again (#553); only a round whose changes touch a shared root runs a second whole
  suite, and its `selection.why` says so. A whole suite that timed out or failed outside a known
  file does not count: the next round runs it again. A selection too long for the command line
  (#400) reaches `scripts/test.js` as a list file named by `MULTIAGENT_TEST_FILES` (one path per
  line) and still runs filtered (`scope: files`, no suite slot); a runner that cannot read the list
  (its npm script is not `node <file>` naming the variable) runs the whole suite, and the message
  says why; a runner whose own counts show it ignored the list (files outside it, or as many tests
  as the run's whole suite) is reported as a whole run (`list_ignored`). Without `scope` (test-batch, E2E release) a suite step runs the whole suite.
  Agents never run suites in their turn: they end a turn with a ```` ```run-tests ```` block (one
  test file per line, or `affected`), the engine runs them like the suite step (log
  `logs/tests-<step>-<n>.log`) and resumes the agent with a summary only (counts, each failure's
  test, file and first 3 lines, the log's path), at most 3 times per turn. One focused test file
  inside a turn stays allowed, with a timeout.
- **One whole suite at a time per machine** (#455): the per-test budgets (#402) were measured
  with one suite on the machine, so a whole-suite round (not a focused list of files, not the
  simulated suite) takes the machine-wide `suite` slot (`packages/engine/engine/machine-slot.js`,
  `<os tmp>/multiagent-orchestrator/locks/suite.slot`) before its command, and frees it when the
  command ends, however it ends. An agent's own whole `npm test` (agent mode, no file list) takes
  the same slot (agents get `MULTIAGENT_LOCKS_DIR` set to that folder); the suite step's child
  inherits it through `MULTIAGENT_SUITE_SLOT`. While another run holds it, the round waits and
  the run logs `kind: suite_slot` "suite: waiting for the suite slot (run …, pid …)"; the wait is
  not counted in the round's timeout or duration. A holder whose process is gone, or a hold older
  than `SUITE_MAX_HOLD_MS` (the largest suite timeout plus a margin), is taken over. The base
  check (#405) takes the same slot for its whole suite (#527) and waits for it the same way.
- **Agent mode** (#219): `npm test` detects an agent (`isAgentMode` in
  `packages/engine/engine/agent-test-report.js`: `MULTIAGENT_AGENT_MODE=1/0` wins, then CI or a terminal stays
  human, then `MULTIAGENT_SIMULATION_ONLY` or an agent CLI's variable) and prints one failures-only
  JSON line (`scripts/test-reporter-agent.js`: counts, per failure the test, file, line, 3 lines of
  error, expected/actual; `kind: file` for a file that could not run; per-file counts on focused
  runs) plus the full flow's result; the spec report goes to `MULTIAGENT_TEST_HUMAN_LOG` (default
  `.test-output/human.log`). The suite step and test requests set both variables and read the JSON
  first (`parseFailures`, `parseCounts`), the human report next to the log (`<log>.human.log`).
- **Code → tests map** (#219): `docs/agents/test-map.md` (derived, gitignored, `npm run docs`)
  lists for every source file its direct tests, then those reaching it through other files (the
  affected-tests graph, `testMap`). A step with `test_map: true` gets the same map of its checkout
  as `{{ test_map }}` (`<run_dir>/test-map.md`).
- **Tests first** (AI Development, local hero, #220): the test writer writes acceptance tests before
  the code; the suite step `red_check` (`files` + `expect: red`) runs them once; the developer has
  `protect_files` on them. There the rule of #47 reads: **the developer never edits the acceptance
  tests written before it, and may add internal tests**. Every other workflow keeps "the developer
  never writes tests" (`edits_tests: false`).
- **Mock runs in tests**: a test that runs the mock provider sets `MULTIAGENT_MOCK_DELAY_SCALE`
  (0.05 or less) and waits on events (`workflow.finished`, `approval.requested`), not on timers.

## Whole simulated runs (#305, #306)

`npm test` runs one process per file, `cpus - 1` at a time: its wall time is bounded below by its
longest file, and every file pays for what its helpers do at load. A whole simulated run of a
bundled workflow takes 4 to 8 s (more under the suite's load); two thirds of the files finish in
under 1.5 s.

- **When a change needs a whole-run test**: a new transition between steps, a new step type, a new
  gate (or a new answer of one), a new loop or round cap, a new way a run ends. Assert every
  transition the change adds in one run where possible, and add to an existing run's assertions
  when it already walks that path (the inventory below says which run walks which transitions).
- **When a cheaper test is enough** (in a non-slow file): an output schema (`validateSchema`), a
  rendered prompt (`render`, a `WorkflowRun` built and never started), a transition condition
  (`evalExpr` on the `when:`), a loaded definition (`loadWorkflow`: steps, choices, skills), a
  single function. A tiny workflow written for the test (`tempWorkflow`, `packages/engine/test/fixtures/*.yaml`)
  exercising one engine mechanism stays in its area's file when it runs in about a second.
- **Where whole runs live**: `packages/engine/test/slow/`, one workflow and theme per file, each under about 60 s
  on the suite (`engine-software-development-<theme>.slow.test.js`; a mixed file keeps its
  definition/prompt tests in `test/` and its runs in `packages/engine/test/slow/<same name>.slow.test.js`). A
  non-slow file never starts a run with the engine helpers (`runSoftwareDevelopment`, `runWith`,
  ..., guarded by `test/test-suite-layout-305-306.test.js`).
- **Helpers never register tests**: a file under `test/` that is not `*.test.js` (`engine-helpers.js`,
  `worktree-helpers.js`, `service/helpers.js`) exports functions and constants only. A `test()` or
  `describe()` it calls at load runs again in every file requiring it (the nine `unit_tests x
  e2e_tests` runs once ran in 15 files); the same test loads every helper with recording stand-ins
  and names the file and line of any registration.
- **The slowest files**: `scripts/test.js` ends the unit report with the five slowest files and
  their wall time (`scripts/test-reporter-slowest.js`, from node's per-file entry): the next
  critical path shows in every `npm test`, and in the human log in agent mode. A file over about
  60 s there is split by theme.

### Inventory of the whole runs (2026-10-12)

Wall time: the 44 engine/run files together, 19 workers (the suite's shape), this machine. A
bundled workflow's runs, per file and theme (`sd` = software-development, `lh` = its local hero,
`aid` = ai-development-local-hero):

| File (`packages/engine/test/slow/`) | Workflow | Runs | Transitions and steps asserted | Wall |
|---|---|---|---|---|
| `engine-software-development-previews` | sd | 5 | preview code/infra failure → developer / gate "retry"; build code/infra failure; 2 fix rounds → gate | 35 s |
| `engine-software-development-merge` | sd | 4 | reject at approve_merge → cancelled; `merged_commit` from deploy; several issues → issue_not_done gate | 32 s |
| `engine-software-development-gaps` | sd, lh | 10 | develop ⇄ requirements_left_out ⇄ code_review: no gap, one round, "stop", "continue", again on a fix round | 37 s |
| `engine-software-development-gaps-tests-measure` | sd, lh | 6 | Tests/Measure tasks never send develop back nor open the gate (#173) | 26 s |
| `engine-software-development-validated` | sd | 5 | validated mode: developer_check stop / changes / fix round / Stop; approve_merge message; developer_screenshots | 43 s |
| `engine-software-development-suite` | sd | 7 | suite → test writer once, pre-existing, blocked → test_failed, 2 retries, run_existing → developer; skills and tests_plan | 40 s |
| `engine-software-development-test-inputs` | sd | 9 | `unit_tests` × `e2e_tests`: test and suite steps visited or not (#203) | 41 s |
| `merge-recovery-runs` | fixture, lh | 9 | `check:`/`precheck:` recovery, max_visits cap, two runs racing; lh resolve_merge re-check (#99) | 24 s |
| `merge-recovery-approve-merge` | sd | 4 | approve_merge PR state; conflict → resolve_conflict → ask again; merge action failing; merge_failed gate (#69) | 41 s |
| `ai-development-local-hero` | aid | 20 | normal path (full list), acceptance send-back, protected tests, screenshots/ui_reviewer fan-out, #247 change request | 38 s |
| `ai-development-e2e` | aid | 10 | e2e scope, scenarios first, healer loop, product bug → develop, test_failed gate (#223) | 20 s |
| `ai-development-warm-up-301-304` | aid | 8 | warm_up once (fix rounds and change requests skip it), mapper failure, affected then whole suite | 16 s |
| `testid-check-246` | aid | 6 | testid_check → develop with the ids, at most 2 returns, review-fix round, no scenarios skips | 14 s |
| `develop-prompt-300` | aid | 2 | develop prompt: self-review checklist; role-addressed skill sections | 4 s |
| `release-summary-290`, `release-workflow-260` | release | 12, 3 | review after the last fix round, before ship; red unit suite → developer → ship gate; Hold | 12 s, 2 s |
| `issue-tracker`, `engine-test-batch` | issue-tracker, test-batch | 6, 4 | validated/auto filing, duplicate, revise loop; production failure → developer once, max_rounds | 4 s, 3 s |
| `image-attachments`, `run-chat` | issue-tracker; writer-reviewer, sd | 2, 2 | attachments copied and routed, resume images; chat replay equals live (loops, gates, tool calls) | 2 s, 14 s |
| `worktree-engine` | fixture | 7 | run worktree per path spelling, cancel/resume WIP, `goto: end` status, processes stopped | 26 s |
| `engine-local-hero`, `engine-writer-arena` | lh, e2e-release; writer-reviewer, ai-arena, backlog-refresh | 4, 13 | merge after verify_change, developer_check; notes loop, rounds → human, arena synthesis, scope gate | 11 s, 6 s |
| `engine`, `engine-child-workflows`, `engine-transitions` | fixtures, inline | 15, 7, 6 | outputs, `/goal`/`/loop`, fan-out, on_error, schema retries; child runs; transition on_error, max_total_context | 3 s, 2 s, 1 s |

Non-slow files that still start runs use a fixture or an inline workflow of a few steps, about a
second each: `agent-fallbacks-262`, `agent-overrides-262`, `agent-overrides-internals-262`,
`context-budget-302`, `engine-fanout-agent-when`, `handoff`, `idle`, `image-attachments` (inline,
loop-goal), `memory-guard-suite-276`, `probes`, `protect-files`, `releases-internals-260`,
`result-summary`, `run-chat` (fanout, handoff), `run-costs*`, `run-progress`, `run-script`,
`session-cache-320`, `subagent-tokens-engine-308`, `supervisor`, `supervisor-on-call`,
`test-budget`, `test-paths`, `testid-check-246` (inline), `workflow-builder`, `workflow-display-245`,
`workflows`.

**Folded**: the #301 normal-path run (same inputs and mock answers as the ai-development normal
path, whose full transition list includes its four) is now that run's assertion; its title is a
comment there. The other overlaps walk the same steps with different inputs or answers (each sd
theme reaches approve_merge on the default path; the matrix's `write_and_run x off` is close to
the default inputs but asserts only the visits), so they stay separate runs.

**Measure** (#305, #306): baseline 2026-10-06 at `d7bcfa2`: 3,770 tests, 268 s wall, 1,345 CPU-s
(sum of the files' wall times), the longest file 231 s. Whole runs per suite: the nine
`unit_tests x e2e_tests` runs registered in 15 files (135 runs, now 9) and one folded run: 127
fewer runs, 127 fewer tests. Before/after `npm test` on the same machine and the suite step's time
in the next 5 real runs (baseline 5.5 min per visit) are the owner's to record here.

### Production files no test reaches (#306)

`docs/agents/test-map.md` lists 122 (2026-10-12). Most are not gaps:

- **Map blind spot** (covered, the map cannot see it): `packages/engine/service/index.js` loads every area
  and channel with `readdirSync` + a computed `require`, which the import graph of
  `packages/engine/engine/affected-tests.js` does not follow. Areas app-update, artifacts, backlog, chain,
  discovery-automations, gates, insights, keep-awake, live-roadmap, local-preview, local-push,
  pipelines, resume, roadmap, run-lists, run-meta, runs, sessions, usage, workflows, workspace and
  channels app, backlog, nightwatch, product-owner, roadmap, runs, skills have their
  `packages/engine/test/service/<area>*.test.js`. Follow-up: teach the map (and `scope: affected`) that loader.
- **Not worth a unit test**: the 28 E2E step files, `features/support/*`, `playwright.config.js`
  (they are the tests); `poc/embed-run.js`; scripts run by hand or that are checks themselves
  (`count-refusals`, `simulated-strays`, `serve`, `smoke`, `smoke-package`, `affected-tests` CLI);
  the channel tables that only forward to an area (agents, analytics, app-update, artifacts, chain,
  chat, diff, local-preview, notify, pasted-images, phonegates, pipelines, projects, releases,
  sessions, usage, workflows); `apps/desktop/host/main.js` (Electron main, E2E app.feature), `packages/engine/domains/account/auth-config.js`
  and `packages/ui-kit/chat-models.js` (constants), `areas/chat-turns.js` (12-line wrapper); renderer
  glue over a tested model or covered by a feature (account, chain-picker, code-banner,
  diff-viewer, image-viewer, keep-awake, kept-work-dialog, run3d/*, setup, usage-widget,
  discovery, discovery-commit, inbox, project, projects, releases, settings-phone, skills).
- **Follow-ups** (a test is worth it; one issue each): areas `budget` (budgetNow against the caps,
  live runs and Night watch), `index-db` (open/close with the workspace, recovery),
  `notifications` (which events notify, the history), `phone-gates` (pairing, answering a gate);
  channels `discovery` (card move, clarity, commit), `oracle` (conversation, memory, tools: the
  largest), `storage` (notification history, unread, mark-read), `supervisor` (on-demand analysis,
  watch start/stop/ask), `voice` (status, error path); `packages/engine/domains/supervisor/supervisor-watch.js` (batching window,
  `FLAG:` → notification, stop at run end); `packages/ui-kit/run-meta.js` (issuesOfRun, issueRefs,
  display title); `packages/ui-kit/toast.js` (countdown and action timing); `views/arena/arena.js`
  (no feature of its own: an E2E scenario or a model to extract); `scripts/lint-lists.js`.

## File size ratchet (#334)

- **The rule**: every source `.js` file (`packages/`, `apps/`, `scripts/`: `scripts/source-tree.js`) has at most 1,000 lines (counted the
  same on every OS, CRLF normalized). `scripts/file-size-ratchet.js` checks it
  (`test/file-size-ratchet-334.test.js`; `node scripts/file-size-ratchet.js` reports by hand).
- **Exceptions only shrink**: the files over the cap when the rule came are in its `EXCEPTIONS`,
  each with its line count then. A listed file that grows past its count fails: split it, never
  raise the count. A lower count may replace the recorded one. A listed file at 1,000 lines or
  fewer (or gone) fails until it leaves the list.
- **No new exception by default**: adding a file to `EXCEPTIONS` needs the owner's ok written in
  its issue; code review checks it.
- **How to split** a file near the cap, the usual ways: a screen into its view's folder
  (`apps/desktop/renderer/views/<view>/`, one file per part, #154); the service into one file per area
  (`packages/engine/service/areas/`, `packages/engine/service/channels/`, #155); the run into its modules
  (`packages/engine/engine/run/`, methods on `WorkflowRun.prototype`, #250). Each new file documents itself
  in its header comment (the code map is built from it).

## Code health (#344)

`scripts/code-health.js` measures every function of the sources (`packages/`, `apps/`, `scripts/`) with a real parser
(`acorn`, a pinned dependency: the app measures JavaScript with it too, #385): lines, cyclomatic complexity (1 + each `if`, `else if`,
ternary, `&&`, `||`, `??`, `case`, `catch` and loop; a nested function counts on its own), max
nesting and parameter count. `test/code-health-344.test.js` holds both ratchets; the line ratchet
above stays as it is.

- **Complexity limit 25**: a function above 25 fails. The functions above it when the rule came
  are in `COMPLEXITY_EXCEPTIONS` as `'<file>:<function name>': value`: a listed function may not
  grow (lower the value when it shrinks), and one at 25 or below (or gone) fails until it leaves
  the list. A callback is named after its call and its enclosing function
  (`startWorkflowRun/on(event) callback`); a name repeated in a file gets ` #2`. No new exception
  without the owner's ok in its issue.
- **Duplication**: a block of 8 or more lines (trimmed, blank lines dropped) found in two places is
  a duplicated block; `DUPLICATION_BASELINE` holds the count per file. A new duplicate fails: call
  the existing code or move it to a shared helper. A file with fewer than its baseline fails until
  the baseline is lowered. `node scripts/code-health.js --duplicates` shows where each block sits.
- **Reading the report**: `node scripts/code-health.js` prints the distribution (median, p90,
  p99, max per area) and the top 20 functions; `--json` prints every function. `--check` runs both
  ratchets. `--hotspots` ranks by complexity x churn (#356, after ToolSeeds' `turbulence`): churn
  is the commits that touched a file, without merges, the commit that created it and the commits
  of `.git-blame-ignore-revs` (mass moves and reformats: add one there), following renames. Each
  file has its total complexity and its worst function; files sit in four quadrants on `log1p`
  axes split at the medians: **Danger Zone** (complex and often changed: refactor these first),
  Cowboy Code (complex, rarely changed), Fertile Ground (simple, often changed), Healthy Closure.
  The Danger Zone comes first, ranked by `sqrt(u² + v²)`, u and v each axis's `log1p` divided by
  its maximum (files against files, functions against functions; the pure core shared with the
  Architecture tab, `packages/shared/architecture-model.js`, #356); a function's churn is its file's. The
  output is deterministic (sorted keys, dates from the commits); churn git cannot read (a shallow
  clone) is `null` and listed under `missing`, never 0.
- **How to split a function** that is over the limit or grew: pull each branch body that does its
  own job into a named function (one per `case` or per kind of event, often a lookup table of
  handlers instead of a long `switch`/`if` chain); return early instead of nesting; move a derived
  value (a label, a status, a cost) into a small helper next to the data it reads, and call the
  existing helper when one already computes it (#347). Keep the new functions in the same file or
  module unless the file nears the line cap.
- **Literal defaults count as branches** (`x || []`, `x ?? {}`): in a file that is type checked
  (below), drop the default of a field the types say is always present (e.g. `roadmap.stages`), and
  keep the ones for what can really be missing (an old file, an optional field, a caller outside
  the checked files). Each removal needs a test that reaches it.

## Type checking (#346)

TypeScript's checker on the JavaScript, with JSDoc types, file by file: no file is converted.
`typescript` is a dev dependency; `jsconfig.json` keeps `checkJs` off (strict null checks on;
implicit `any`, `this` and catch variables allowed, so a file opts in without a rewrite).

- **Opt a file in**: put `// @ts-check` in its leading comments (first line), annotate what the
  checker cannot infer (`/** @param {...} */`, a `/** @type {...} */ (x)` cast for a local set in a
  callback), and add the file to `CHECKED` in `scripts/typecheck.js` (removing it from `NEXT` when
  it was there). Change code only where the checker finds a real bug, and say so in the PR.
- **The types** live in `packages/shared/types.js`: `RunSummary`, `RunEvent` (a union by `type`),
  `Roadmap`, `RoadmapStage`, `RoadmapItem`, `Workflow`, `WorkflowStep`, `SessionRecord`, matching
  what the code writes (a field that can be missing is optional). Import them with
  `/** @param {import('./shared/types').Roadmap} roadmap */` (the path relative to the file). A
  shape changes: change its typedef in the same commit.
- **Run it**: `npm run typecheck` (`tsc --noEmit -p jsconfig.json`), or `node scripts/typecheck.js`
  for the checker plus the ratchet. `npm test` runs both through `test/typecheck-346.test.js` on
  every OS (a few seconds).
- **The ratchet** (`scripts/typecheck.js`): every opted-in file passes with no error; `CHECKED` is
  exactly the files that opted in, so a file that opted in cannot opt out (dropping its
  `// @ts-check` fails); `NEXT` is the owner's list of files to check next and only shrinks (a file
  of it that opted in fails until it leaves the list). Both lists are sorted, one file per line.

## The channel sweep (#333)

`packages/engine/test/slow/service-channel-sweep-333.slow.test.js` enumerates the service's manifest (no
hand-written list: a new channel is swept by itself) and calls every channel in a scratch
workspace, under `MULTIAGENT_SIMULATION_ONLY`, with hostile values: the whole argument, then each
named param on its own, missing, `null`, a number, a list, an object, `''`, `../../outside`, an
absolute path outside the workspace, a 1 MB string and an object with a `__proto__` key. Each call
has 4 s. It passes when every call answers or rejects with an `Error` that names the problem
(never a raw "Cannot read properties of undefined"), nothing outside the workspace is created,
changed or trashed, and nothing is left unhandled. The calls run in a child process
(`packages/engine/test/service/channel-sweep-runner.js`): a call that blocks it is killed and named.

- **A failing channel is fixed at its entry**, with the guards of `packages/engine/service/common.js`:
  `requireId` (an id is a file name inside its folder), `requireText` (a string of at most N
  characters), `requireObject` (an options object). The service checks every channel with named
  params once (`requireArgs`): the argument is an object, and a `runId`, `projectId` or `cardId`
  in it is an id. A refusal carries status 400, so `npm run serve` answers it with a 4xx. A
  try/catch that hides the error is not a fix.
- **Gates**: `packages/engine/test/service/gates-hostile-333.test.js` checks that hostile input to
  `approval:resolve` and `runs:resume` never opens a human gate.
- **How to add a skip**: only a channel with effects outside the process (the desktop shell, the
  network, `gh`/`glab`, a push, the machine's shared caches or its own files) is skipped. Add
  `{ channel, reason }` (or `<area>:*` for a whole area) to `packages/engine/test/service/channel-sweep-skips.js`;
  the sweep checks that every skip names a channel of the manifest and says why.

## The channel contract (#338)

Every manifest entry carries `schema: { params, result }` (JSON Schema; shared definitions in
`packages/engine/service/schemas.js`, the validator in `packages/engine/domains/workspace/json-schema.js`). The service checks the arguments
against `params` before the channel runs, in the app too (a refusal is a 400 naming the parameter
and the rule). **The result is checked only under the test runner** (`packages/engine/service/contract.js`:
`node --test` sets `NODE_TEST_CONTEXT` in each test file's process): every channel call any test
makes through `service.api` also checks what the channel answers against `schema.result`, and a
mismatch rejects the call (`<channel> answered outside its schema.result: …`), so the test fails.
A test that fails that way found a schema that says less than the channel answers (or a channel
that broke its contract): fix the schema or the channel, never the check. In the app no result is
validated (no runtime cost).

- **The ratchet**: `packages/engine/test/service/channel-schema-ratchet-338.test.js` fails on a channel without a
  schema unless `packages/engine/test/service/channels-without-schema.js` lists it with its reason (arguments
  free-form by design). The list only shrinks: a listed channel that gains a schema leaves it.
- **The reference**: `npm run docs` writes `docs/agents/channels.md` (gitignored), every channel
  with its arguments and result.

## Contract tests over HTTP and the version handshake (#339)

The same contract, seen from outside as a client sees it: `packages/engine/test/contract/contract.test.js` calls
each channel of `packages/engine/test/contract/fixtures.js` with `POST /api/<channel>` and checks the status, the
result against the engine's own `schema.result` (from `GET /api/manifest`) and a 400 for one invalid
argument. The JS engine's answers are the reference a second engine (the Rust phases) must match.

- **Which engine**: `ENGINE_URL` (+ `ENGINE_TOKEN`, the server's token) names one, e.g.
  `npm run serve -- --port 7300` with `MULTIAGENT_SERVER_TOKEN` set, then
  `ENGINE_URL=http://127.0.0.1:7300 ENGINE_TOKEN=<token> node --test packages/engine/test/contract/`. Without it the
  suite starts `node packages/engine/bin/multiagent-engine.js` itself on a scratch workspace in simulation, with no account,
  and stops it after; that is how it runs in `npm test` (about 10 s). Never point it at a workspace
  you use: fixtures create projects, cards, agents, skills and simulated runs.
- **Fixtures**: `{ arg, status?, invalid?, setup?, teardown? }`; `setup` makes the state the call
  needs through the API itself (a project, a card, a simulated run), under unique names, so the
  suite runs in any order and twice in a row against the same engine. Desktop-only channels are
  skipped, as the browser skips them.
- **Coverage ratchet**: the suite prints `contract tests: N of M channels with a schema`;
  `packages/engine/test/contract-harness-339.test.js` fails on a channel with a schema and no fixture unless
  `packages/engine/test/contract/channels-without-fixture.js` lists it with its reason. The list only shrinks.
- **The handshake**: `GET /api/version` (and the `app:version` channel over IPC) answers
  `{ app, contract }`, `contract` being `contractHash` of the manifest (`packages/engine/service/contract.js`):
  any change to a channel, its params or its schemas changes it. `GET /api/manifest` carries the
  same `contract`; the browser UI (`apps/desktop/renderer/api-http.js`) compares them on every WebSocket
  connection and shows a Reload banner when the engine speaks another contract.

## Machine-independent tests

Git tests run with an empty `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`, passing identity,
`init.defaultBranch=main` and `core.autocrlf=false` with `-c`. So any production git command that
creates a commit needs its own `-c user.name/email`.

## The mock provider

- Picks the first enum value unless `MOCK_SEQUENCES` has a fitting sequence (or the run's
  `mockSequences` option overrides it). The default sequence fails the preview once with
  `failure_class: code` and recovers. Numbers and booleans take sequences too (`score`, `ready`).
- `mockSequences.invalid_answers: { step: n }` makes the first n answers of a step miss its schema
  (exercises the retries and the supervisor); `permission_denials: { step: n }` refuses every tool
  call; `no_handoff: { step: n }` leaves out the handoff note (exercises the follow-up request);
  `slow_tools: { step: ms }` makes the step's tool call wait ms silently (exercises the idle warning);
  `request_budget: { step: n }` ends the first n turns of a step on the agent's `max_requests`
  (exercises the cut, the wrap-up, the continuation and the cap, #302).
- `wait:` probes are simulated too (`MOCK_PROBES` in `packages/engine/engine/machine-actions.js`: CI fails
  once, then passes with no agent turn); `mockSequences.probes: { step: [states] }` overrides them,
  and the `probe` option of `WorkflowRun` injects a fake (`test/probes.test.js`). A mock run never
  calls `gh`/`glab`.

## Simulated machine actions (#353)

Simulation is an adapter given to the run, not a flag the engine checks. `packages/engine/engine/machine-actions.js`
has `real()` and `simulated({ sequences })`, with the same operations: `git`, `mergeLocal`, `ship`
(and its guard), `runAction`, `probe`, `runSuite` (and the red check, related and affected tests),
`captureScreenshots`, `writeReleaseVersion` and `provider` (the provider an agent's turn starts:
the simulated adapter gives every agent `{ type: 'mock' }`, its session records the agent's own as
`simulates`). The simulated machine actions run nothing: actions, `merge: local` and `ship:` emit
`action.executed` with `skipped: true` and a `[mock] …` output, git answers empty, suites report
`mockResult`, screenshots capture nothing, probes follow `MOCK_PROBES`, and
`mockSequences.action_errors: { step: n }` fails a step's first n transitions.
- `WorkflowRun`'s `machine` option injects one (tests wrap or replace its methods, like `probe`);
  without it the run takes the one matching `mock` (the simulated one with the run's
  `mockSequences`). A mismatch is refused at construction: a real run never takes the simulated
  adapter, nor the reverse. The run modules call `this.machine.*` and read `this.machine.simulated`
  for what is not a machine action (retry delays, budgets, deps); no `this.mock` is left in
  `packages/engine/engine/run/` (`test/simulation-adapters-353.test.js` counts them).
- The safety rule is not in the adapter: under `MULTIAGENT_SIMULATION_ONLY=1` the real adapter's
  provider is still refused by `providers.runTurn` (see the guard below).
- A run built without its constructor (`Object.create(WorkflowRun.prototype)` or a plain object
  passed to a method) sets `machine` itself.
- The events of a whole simulated software-development run are a snapshot
  (`packages/engine/test/fixtures/events-software-development-353.json`, `packages/engine/test/slow/simulation-adapters-353.slow.test.js`).
- Its context grows 30k per turn of the same conversation (start 20k, peak +20k): `max_context`
  rotations are deterministic (`packages/engine/test/fixtures/handoff.yaml`).
- E2E scenarios (#143): an output schema's `scenarios` array (items with a `status`) gets sample
  scenarios (`mockScenarios` in `packages/engine/engine/providers.js`). A schema whose status enum has no
  `passed` (the development workflows' test step, #199) gets two `pending` ones (written, run at
  release). Otherwise (e2e-release's `heal` step): on a visit whose `tests_status` fails (the 1st by
  default) one passed, one failed and one skipped; on later visits the failed one passes. e2e-release's
  `e2e` is a suite step: `mockSequences: { suite: { e2e: ['fail', 'pass'] } }` takes it through
  heal → fix → review (default: green at once). The engine saves them in `<run_dir>/e2e/`
  (`packages/engine/engine/scenarios.js`) and the gates show them ("written, run at release" for pending);
  `npm run screenshot -- --view run --stop-at approve_merge` shows the gate with them. Local hero
  has no merge approval: the run's summary (`renderRunSummary`, views/run/run.js) shows them.
- **Where E2E runs (#199)**: development runs write the issue's scenarios (user-visible issues only,
  at most 3, `@issue-<n>`) and check that they parse (a dry run), never start the app or a browser
  for them; the whole suite runs once, at release, in the bundled `e2e-release.yaml` (its own
  worktree of the local base; the orchestrator runs `e2e_command` as a suite step, no agent, #222;
  a red scenario → the E2E runner sorts it (a stale scenario it updates, or the app) → developer →
  review → the suite again, at most `max_rounds`, then a human gate; a green pass records
  `refs/multiagent/e2e-last-green`). Development runs merge locally without
  waiting for it.
- **Who runs the suite (#177)**: in the software-development workflows and test-batch the
  orchestrator does, not the test writer: a `type: suite` step (`packages/engine/engine/suite-step.js`) runs the
  project's whole suite once per round after the test step, logs it to `logs/suite-<round>.log` and
  gives the test writer only the failing tests; the test writer runs focused tests (skill
  testing-principles), and a whole-suite command it starts is a warn (`full_suite: warn`). Tests of
  the step pass `mock` with `mockResult` or a fake `run`; `parseFailures` takes sample outputs.
  Mock runs: `mockSequences.suite: { suite: ['fail', 'pass'] }` (a failing suite goes back to the
  test writer once, then passes), `['preexisting']` with `preexisting_failures: true` (only
  pre-existing failures: no loop).
- **Pre-existing only when confirmed (#527)**: a failure that also fails on the base excuses the
  run only when the base check confirmed it red alone after its last green check
  (`confirmedFailures` of `packages/engine/engine/base-health-store.js`, passed as `runSuite({ confirmedOnBase })`
  by `machine.confirmedOnMain`); a store entry without that confirmation (a sighting, a timeout
  under load) stays the run's own failure. Without a project (`confirmedOnBase` null) the #211
  rule holds unchanged.
- **Unit / E2E test inputs (#203)**: `unit_tests` × `e2e_tests` of the development workflows take
  different paths (both off: no test step; run_existing + E2E off: suite only); mock runs cover each
  combination with `inputs: { unit_tests, e2e_tests }` and `tests_status: ['pass']`.
- **One Electron screenshot at a time (#199)**: `scripts/screenshot.js` and the screenshots step
  take the machine-wide slot of `packages/engine/engine/machine-slot.js` (`<os tmp>/multiagent-orchestrator/locks/screenshot.slot`,
  or `MULTIAGENT_LOCKS_DIR`): a second capture waits ("waiting for the screenshot slot"), a dead
  holder's slot is freed. Tests use their own `dir`.
- **Dependencies (#198)**: run worktrees get `node_modules` linked from `<workspace>/cache/deps`
  (`packages/engine/engine/deps-cache.js`); tests of it pass a fake `run` (the installer and `--version`) and
  temp folders, never a real install. Mock runs have no worktree, so nothing is installed.
- `run:start` takes `mockSequences` (simulation only): the Write & Review scenario picker uses it.
- The Backlog's Product Owner drawer has its own scenario picker (#148, `#po-scenario`, orange,
  shown only in developer or simulation-only mode): `po:ask`'s `scenario` forces the simulated
  answer (`MOCK_SCENARIOS` / `mockScenario` in `packages/engine/domains/po/product-owner.js`: a pending question, a draft,
  a duplicate, a large draft, a long attachments list, applied and partly applied groups, a large
  answer, an error). Ignored for a real call.
  Settings `developerMode` (replaces `mockByDefault`) shows the `.dev-only` Simulation checkboxes,
  checked by default; off = real runs. Simulated `/loop` waits scale with `MULTIAGENT_MOCK_DELAY_SCALE`.
- To check the flags a real turn gets without a model, point a provider at `node` +
  `packages/engine/test/fixtures/fake-claude.js` (it answers with its own arguments; `test/capabilities.test.js`).

## Real CLIs and money

- Never open real CLI terminals or start real runs in automated checks (they cost money).
- **Workflow agents never prefix it**: the engine starts every agent process with
  `MULTIAGENT_SIMULATION_ONLY=1` already set (`AGENT_ENV` in `packages/engine/engine/capabilities.js`), so
  `npm test` and `node --test …` run as they are; a `VAR=value` prefix makes Claude Code refuse
  the command headless (see [capabilities.md](capabilities.md)).
- **Simulation-only guard**: `MULTIAGENT_SIMULATION_ONLY=1` (`packages/engine/engine/simulation.js`) makes real
  runs impossible: `run:start`/`runs:resume` (and its alias `supervisor:resume`)/`backlog:assign` refuse `mock: false` (never
  downgraded to a simulation), CLI terminals (`term:open` cli/cli-new/cli-resume/supervisor, the
  external console) are refused, and `providers.runTurn` refuses every non-mock provider. The UI
  shows a "Simulation only" badge and behaves as Developer mode. It is set by `scripts/test.js`
  (`npm test`), `scripts/smoke.js` (which also uses a scratch temporary workspace and fails unless
  every session was `mock`), the CI workflows and the tests' `makeService`/server helpers. A test
  that drives a real provider type at a fake CLI (`fake-claude.js`) lifts it for its duration.
  On macOS a simulation also runs with Chromium's mock keychain (`--use-mock-keychain`, set by
  `apps/desktop/host/main.js` in a development checkout): safeStorage never asks for "Chromium Safe
  Storage", a dialog that blocked the smoke, the screenshots and each E2E scenario until dismissed.
- UI checks run through `scripts/smoke.js` (or a script built the same way), never through a
  hand-written script that launches `apps/desktop/host/main` directly. The remote engine (the app as a window onto
  `npm run serve`) has `scripts/smoke-remote.js <out-dir>`: a scratch server on 127.0.0.1, the app in
  remote mode on a scratch user data folder, its Settings, its connection page and the engine
  stopping (see [environment.md](environment.md), "Remote engine").
- In the UI, a checked Simulation box that can't apply (Developer mode off) fails the start with a
  message (`wantsSimulation` in app.js); it never silently starts a real run.
- Real-model calls cost the owner's money: say so and keep them minimal (one call to validate).
- In automated checks that go through `resolveCommand`, put a fake **`.exe`** first on PATH (it
  prefers any `.exe` over a `.cmd`) or a real CLI starts.
