# Testing

Read this before writing or changing tests, and before any check that could start a real CLI.

## Running and CI

- `npm test` = node:test unit tests (`test/*.test.js` and `test/<area>/*.test.js`, listed by
  `scripts/test.js`) + a full mock run of software-development.

## Where a new test goes

- Into the existing file of its area, never appended to a catch-all file. The service's tests are
  one file per area in `test/service/<area>.test.js`, matching `src/service/areas/<area>.js` (and the
  channel files in `src/service/channels/`), with the shared scratch workspace and fake host in
  `test/service/helpers.js`.
- A new area (a new `src/service/areas/<area>.js`, a new module) gets a new test file; no list to
  edit: `scripts/test.js` finds it.
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
- **The app's E2E suite (#222)**: Playwright + playwright-bdd, `npm run test:e2e` (`-- --grep
  @smoke`: the 6 critical journeys, ~30 s; `-- --grep @issue-<n>`: one issue). Feature files in
  `features/` (one per area, every scenario `@issue-<n>`), steps in `features/steps/`, the launch in
  `features/support/app.js` (`_electron` on a fresh demo workspace seeded with scripts/screenshot.js's
  data, simulation only, window off-screen; `MULTIAGENT_E2E_SHOW=1` shows it). Steps assert through
  `getByRole` / `getByTestId` (the renderer's `data-testid`s). Visual baselines:
  `features/__screenshots__/<name>-<platform>.png`, committed, `maxDiffPixelRatio` in
  `playwright.config.js`; rewrite one on purpose only (`npm run test:e2e:update -- --grep @visual`).
  Results: `.test-output/e2e/results.json`; a failed scenario keeps `trace.zip` (with the window's
  screencast: Playwright's recordVideo stalls Electron 44) and `failure.png` under
  `.test-output/e2e/artifacts/` (`npx playwright show-trace <zip>`). CI's Windows job runs `@smoke`.
  The app is dark-only today: the light and dark baselines guard `prefers-color-scheme` both ways.

## Affected tests, the slow suite, who runs what (#212)

- **Affected tests**: `src/engine/affected-tests.js` (no model) builds the import graph from
  `require` / `import` and lists the test files that import, directly or transitively, a file
  changed since the base (merge-base, uncommitted and untracked files included), plus the test
  files changed themselves. A changed file nothing imports (a workflow YAML, a renderer script a
  test reads with `fs`) reaches the test files whose code names its path. A shared root
  (`package.json`, a lockfile, `scripts/test.js`) or a project without a JS/TS graph selects the
  whole suite. `node scripts/affected-tests.js --base main` prints the files and why each was
  chosen (`imports src/roadmap.js`); `--files` prints only the paths, for `npm test -- <files>`.
- **Slow tests**: files under `test/slow/` or named `*.slow.test.js` (whole simulated runs) never
  join the affected set; they run with the full suite only. Put a test that simulates a whole run
  there, and keep big files split by area so `node --test` runs them in parallel (one file's tests
  run in sequence). See "Whole simulated runs" below.
- **Who runs what**: the suite step with `scope: affected` (software-development and the local
  hero) runs the affected files every round, and the whole suite once in the run, when the
  affected files first pass (log `suite-<round>-full.log`); the files that failed in a round join
  the next rounds' set. Without `scope` (test-batch, E2E release) a suite step runs the whole suite.
  Agents never run suites in their turn: they end a turn with a ```` ```run-tests ```` block (one
  test file per line, or `affected`), the engine runs them like the suite step (log
  `logs/tests-<step>-<n>.log`) and resumes the agent with a summary only (counts, each failure's
  test, file and first 3 lines, the log's path), at most 3 times per turn. One focused test file
  inside a turn stays allowed, with a timeout.
- **Agent mode** (#219): `npm test` detects an agent (`isAgentMode` in
  `src/engine/agent-test-report.js`: `MULTIAGENT_AGENT_MODE=1/0` wins, then CI or a terminal stays
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
  single function. A tiny workflow written for the test (`tempWorkflow`, `test/fixtures/*.yaml`)
  exercising one engine mechanism stays in its area's file when it runs in about a second.
- **Where whole runs live**: `test/slow/`, one workflow and theme per file, each under about 60 s
  on the suite (`engine-software-development-<theme>.slow.test.js`; a mixed file keeps its
  definition/prompt tests in `test/` and its runs in `test/slow/<same name>.slow.test.js`). A
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

| File (`test/slow/`) | Workflow | Runs | Transitions and steps asserted | Wall |
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

- **Map blind spot** (covered, the map cannot see it): `src/service/index.js` loads every area
  and channel with `readdirSync` + a computed `require`, which the import graph of
  `src/engine/affected-tests.js` does not follow. Areas app-update, artifacts, backlog, chain,
  discovery-automations, gates, insights, keep-awake, live-roadmap, local-preview, local-push,
  pipelines, resume, roadmap, run-lists, run-meta, runs, sessions, usage, workflows, workspace and
  channels app, backlog, nightwatch, product-owner, roadmap, runs, skills have their
  `test/service/<area>*.test.js`. Follow-up: teach the map (and `scope: affected`) that loader.
- **Not worth a unit test**: the 28 E2E step files, `features/support/*`, `playwright.config.js`
  (they are the tests); `poc/embed-run.js`; scripts run by hand or that are checks themselves
  (`count-refusals`, `simulated-strays`, `serve`, `smoke`, `smoke-package`, `affected-tests` CLI);
  the channel tables that only forward to an area (agents, analytics, app-update, artifacts, chain,
  chat, diff, local-preview, notify, pasted-images, phonegates, pipelines, projects, releases,
  sessions, usage, workflows); `src/main.js` (Electron main, E2E app.feature), `src/auth-config.js`
  and `src/renderer/chat-models.js` (constants), `areas/chat-turns.js` (12-line wrapper); renderer
  glue over a tested model or covered by a feature (account, chain-picker, code-banner,
  diff-viewer, image-viewer, keep-awake, kept-work-dialog, run3d/*, setup, usage-widget,
  discovery, discovery-commit, inbox, project, projects, releases, settings-phone, skills).
- **Follow-ups** (a test is worth it; one issue each): areas `budget` (budgetNow against the caps,
  live runs and Night watch), `index-db` (open/close with the workspace, recovery),
  `notifications` (which events notify, the history), `phone-gates` (pairing, answering a gate);
  channels `discovery` (card move, clarity, commit), `oracle` (conversation, memory, tools: the
  largest), `storage` (notification history, unread, mark-read), `supervisor` (on-demand analysis,
  watch start/stop/ask), `voice` (status, error path); `src/supervisor-watch.js` (batching window,
  `FLAG:` → notification, stop at run end); `src/renderer/run-meta.js` (issuesOfRun, issueRefs,
  display title); `src/renderer/toast.js` (countdown and action timing); `views/arena/arena.js`
  (no feature of its own: an E2E scenario or a model to extract); `scripts/lint-lists.js`.

## File size ratchet (#334)

- **The rule**: every `.js` file under `src/` and `scripts/` has at most 1,000 lines (counted the
  same on every OS, CRLF normalized). `scripts/file-size-ratchet.js` checks it
  (`test/file-size-ratchet-334.test.js`; `node scripts/file-size-ratchet.js` reports by hand).
- **Exceptions only shrink**: the files over the cap when the rule came are in its `EXCEPTIONS`,
  each with its line count then. A listed file that grows past its count fails: split it, never
  raise the count. A lower count may replace the recorded one. A listed file at 1,000 lines or
  fewer (or gone) fails until it leaves the list.
- **No new exception by default**: adding a file to `EXCEPTIONS` needs the owner's ok written in
  its issue; code review checks it.
- **How to split** a file near the cap, the usual ways: a screen into its view's folder
  (`src/renderer/views/<view>/`, one file per part, #154); the service into one file per area
  (`src/service/areas/`, `src/service/channels/`, #155); the run into its modules
  (`src/engine/run/`, methods on `WorkflowRun.prototype`, #250). Each new file documents itself
  in its header comment (the code map is built from it).

## The channel sweep (#333)

`test/slow/service-channel-sweep-333.slow.test.js` enumerates the service's manifest (no
hand-written list: a new channel is swept by itself) and calls every channel in a scratch
workspace, under `MULTIAGENT_SIMULATION_ONLY`, with hostile values: the whole argument, then each
named param on its own, missing, `null`, a number, a list, an object, `''`, `../../outside`, an
absolute path outside the workspace, a 1 MB string and an object with a `__proto__` key. Each call
has 4 s. It passes when every call answers or rejects with an `Error` that names the problem
(never a raw "Cannot read properties of undefined"), nothing outside the workspace is created,
changed or trashed, and nothing is left unhandled. The calls run in a child process
(`test/service/channel-sweep-runner.js`): a call that blocks it is killed and named.

- **A failing channel is fixed at its entry**, with the guards of `src/service/common.js`:
  `requireId` (an id is a file name inside its folder), `requireText` (a string of at most N
  characters), `requireObject` (an options object). The service checks every channel with named
  params once (`requireArgs`): the argument is an object, and a `runId`, `projectId` or `cardId`
  in it is an id. A refusal carries status 400, so `npm run serve` answers it with a 4xx. A
  try/catch that hides the error is not a fix.
- **Gates**: `test/service/gates-hostile-333.test.js` checks that hostile input to
  `approval:resolve` and `runs:resume` never opens a human gate.
- **How to add a skip**: only a channel with effects outside the process (the desktop shell, the
  network, `gh`/`glab`, a push, the machine's shared caches or its own files) is skipped. Add
  `{ channel, reason }` (or `<area>:*` for a whole area) to `test/service/channel-sweep-skips.js`;
  the sweep checks that every skip names a channel of the manifest and says why.

## The channel contract (#338)

Every manifest entry carries `schema: { params, result }` (JSON Schema; shared definitions in
`src/service/schemas.js`, the validator in `src/json-schema.js`). The service checks the arguments
against `params` before the channel runs, in the app too (a refusal is a 400 naming the parameter
and the rule). **The result is checked only under the test runner** (`src/service/contract.js`:
`node --test` sets `NODE_TEST_CONTEXT` in each test file's process): every channel call any test
makes through `service.api` also checks what the channel answers against `schema.result`, and a
mismatch rejects the call (`<channel> answered outside its schema.result: …`), so the test fails.
A test that fails that way found a schema that says less than the channel answers (or a channel
that broke its contract): fix the schema or the channel, never the check. In the app no result is
validated (no runtime cost).

- **The ratchet**: `test/service/channel-schema-ratchet-338.test.js` fails on a channel without a
  schema unless `test/service/channels-without-schema.js` lists it with its reason (arguments
  free-form by design). The list only shrinks: a listed channel that gains a schema leaves it.
- **The reference**: `npm run docs` writes `docs/agents/channels.md` (gitignored), every channel
  with its arguments and result.

## Contract tests over HTTP and the version handshake (#339)

The same contract, seen from outside as a client sees it: `test/contract/contract.test.js` calls
each channel of `test/contract/fixtures.js` with `POST /api/<channel>` and checks the status, the
result against the engine's own `schema.result` (from `GET /api/manifest`) and a 400 for one invalid
argument. The JS engine's answers are the reference a second engine (the Rust phases) must match.

- **Which engine**: `ENGINE_URL` (+ `ENGINE_TOKEN`, the server's token) names one, e.g.
  `npm run serve -- --port 7300` with `MULTIAGENT_SERVER_TOKEN` set, then
  `ENGINE_URL=http://127.0.0.1:7300 ENGINE_TOKEN=<token> node --test test/contract/`. Without it the
  suite starts `node scripts/serve.js` itself on a scratch workspace in simulation, with no account,
  and stops it after; that is how it runs in `npm test` (about 10 s). Never point it at a workspace
  you use: fixtures create projects, cards, agents, skills and simulated runs.
- **Fixtures**: `{ arg, status?, invalid?, setup?, teardown? }`; `setup` makes the state the call
  needs through the API itself (a project, a card, a simulated run), under unique names, so the
  suite runs in any order and twice in a row against the same engine. Desktop-only channels are
  skipped, as the browser skips them.
- **Coverage ratchet**: the suite prints `contract tests: N of M channels with a schema`;
  `test/contract-harness-339.test.js` fails on a channel with a schema and no fixture unless
  `test/contract/channels-without-fixture.js` lists it with its reason. The list only shrinks.
- **The handshake**: `GET /api/version` (and the `app:version` channel over IPC) answers
  `{ app, contract }`, `contract` being `contractHash` of the manifest (`src/service/contract.js`):
  any change to a channel, its params or its schemas changes it. `GET /api/manifest` carries the
  same `contract`; the browser UI (`src/renderer/api-http.js`) compares them on every WebSocket
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
- `wait:` probes are simulated too (`MOCK_PROBES` in workflow.js: CI fails once, then passes with
  no agent turn); `mockSequences.probes: { step: [states] }` overrides them, and the `probe` option
  of `WorkflowRun` injects a fake (`test/probes.test.js`). A mock run never calls `gh`/`glab`.
- Its context grows 30k per turn of the same conversation (start 20k, peak +20k): `max_context`
  rotations are deterministic (`test/fixtures/handoff.yaml`).
- E2E scenarios (#143): an output schema's `scenarios` array (items with a `status`) gets sample
  scenarios (`mockScenarios` in `src/engine/providers.js`). A schema whose status enum has no
  `passed` (the development workflows' test step, #199) gets two `pending` ones (written, run at
  release). Otherwise (e2e-release's `heal` step): on a visit whose `tests_status` fails (the 1st by
  default) one passed, one failed and one skipped; on later visits the failed one passes. e2e-release's
  `e2e` is a suite step: `mockSequences: { suite: { e2e: ['fail', 'pass'] } }` takes it through
  heal → fix → review (default: green at once). The engine saves them in `<run_dir>/e2e/`
  (`src/engine/scenarios.js`) and the gates show them ("written, run at release" for pending);
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
  orchestrator does, not the test writer: a `type: suite` step (`src/engine/suite-step.js`) runs the
  project's whole suite once per round after the test step, logs it to `logs/suite-<round>.log` and
  gives the test writer only the failing tests; the test writer runs focused tests (skill
  testing-principles), and a whole-suite command it starts is a warn (`full_suite: warn`). Tests of
  the step pass `mock` with `mockResult` or a fake `run`; `parseFailures` takes sample outputs.
  Mock runs: `mockSequences.suite: { suite: ['fail', 'pass'] }` (a failing suite goes back to the
  test writer once, then passes), `['preexisting']` with `preexisting_failures: true` (only
  pre-existing failures: no loop).
- **Unit / E2E test inputs (#203)**: `unit_tests` × `e2e_tests` of the development workflows take
  different paths (both off: no test step; run_existing + E2E off: suite only); mock runs cover each
  combination with `inputs: { unit_tests, e2e_tests }` and `tests_status: ['pass']`.
- **One Electron screenshot at a time (#199)**: `scripts/screenshot.js` and the screenshots step
  take the machine-wide slot of `src/engine/machine-slot.js` (`<os tmp>/multiagent-orchestrator/locks/screenshot.slot`,
  or `MULTIAGENT_LOCKS_DIR`): a second capture waits ("waiting for the screenshot slot"), a dead
  holder's slot is freed. Tests use their own `dir`.
- **Dependencies (#198)**: run worktrees get `node_modules` linked from `<workspace>/cache/deps`
  (`src/engine/deps-cache.js`); tests of it pass a fake `run` (the installer and `--version`) and
  temp folders, never a real install. Mock runs have no worktree, so nothing is installed.
- `run:start` takes `mockSequences` (simulation only): the Write & Review scenario picker uses it.
- The Backlog's Product Owner drawer has its own scenario picker (#148, `#po-scenario`, orange,
  shown only in developer or simulation-only mode): `po:ask`'s `scenario` forces the simulated
  answer (`MOCK_SCENARIOS` / `mockScenario` in `src/product-owner.js`: a pending question, a draft,
  a duplicate, a large draft, a long attachments list, applied and partly applied groups, a large
  answer, an error). Ignored for a real call.
  Settings `developerMode` (replaces `mockByDefault`) shows the `.dev-only` Simulation checkboxes,
  checked by default; off = real runs. Simulated `/loop` waits scale with `MULTIAGENT_MOCK_DELAY_SCALE`.
- To check the flags a real turn gets without a model, point a provider at `node` +
  `test/fixtures/fake-claude.js` (it answers with its own arguments; `test/capabilities.test.js`).

## Real CLIs and money

- Never open real CLI terminals or start real runs in automated checks (they cost money).
- **Workflow agents never prefix it**: the engine starts every agent process with
  `MULTIAGENT_SIMULATION_ONLY=1` already set (`AGENT_ENV` in `src/engine/capabilities.js`), so
  `npm test` and `node --test …` run as they are; a `VAR=value` prefix makes Claude Code refuse
  the command headless (see [capabilities.md](capabilities.md)).
- **Simulation-only guard**: `MULTIAGENT_SIMULATION_ONLY=1` (`src/engine/simulation.js`) makes real
  runs impossible: `run:start`/`runs:resume` (and its alias `supervisor:resume`)/`backlog:assign` refuse `mock: false` (never
  downgraded to a simulation), CLI terminals (`term:open` cli/cli-new/cli-resume/supervisor, the
  external console) are refused, and `providers.runTurn` refuses every non-mock provider. The UI
  shows a "Simulation only" badge and behaves as Developer mode. It is set by `scripts/test.js`
  (`npm test`), `scripts/smoke.js` (which also uses a scratch temporary workspace and fails unless
  every session was `mock`), the CI workflows and the tests' `makeService`/server helpers. A test
  that drives a real provider type at a fake CLI (`fake-claude.js`) lifts it for its duration.
- UI checks run through `scripts/smoke.js` (or a script built the same way), never through a
  hand-written script that launches `src/main` directly.
- In the UI, a checked Simulation box that can't apply (Developer mode off) fails the start with a
  message (`wantsSimulation` in app.js); it never silently starts a real run.
- Real-model calls cost the owner's money: say so and keep them minimal (one call to validate).
- In automated checks that go through `resolveCommand`, put a fake **`.exe`** first on PATH (it
  prefers any `.exe` over a `.cmd`) or a real CLI starts.
