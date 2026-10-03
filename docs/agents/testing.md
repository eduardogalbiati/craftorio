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
  runs (`scripts/ci-plan.js`, Actions minutes: macOS counts ×10). `preview.yml`/`deploy.yml` run
  on `windows-latest` and skip `npm test` when CI already passed on the same code (the `ci/tested`
  status CI records on the PR head, with the tree it tested: pending at the start of each run, then
  its result, so only the latest run counts). Tests that pass
  locally can still fail on another OS: CI is the judge.
- The Electron part of `test/screenshot.test.js` (every view of `scripts/screenshot.js` opens and
  quits by itself, ~1 min, ~25 windows) only runs with `MULTIAGENT_UI_TESTS=1`: CI's Windows job
  has a step for it (after `node node_modules/electron/install.js`; the matrix sets
  `ELECTRON_SKIP_BINARY_DOWNLOAD`). Run it locally when you change the script or add a view.

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
  run in sequence).
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
  `slow_tools: { step: ms }` makes the step's tool call wait ms silently (exercises the idle warning).
- `wait:` probes are simulated too (`MOCK_PROBES` in workflow.js: CI fails once, then passes with
  no agent turn); `mockSequences.probes: { step: [states] }` overrides them, and the `probe` option
  of `WorkflowRun` injects a fake (`test/probes.test.js`). A mock run never calls `gh`/`glab`.
- Its context grows 30k per turn of the same conversation (start 20k, peak +20k): `max_context`
  rotations are deterministic (`test/fixtures/handoff.yaml`).
- E2E scenarios (#143): an output schema's `scenarios` array (items with a `status`) gets sample
  scenarios (`mockScenarios` in `src/engine/providers.js`). A schema whose status enum has no
  `passed` (the development workflows' test step, #199) gets two `pending` ones (written, run at
  release). Otherwise (e2e-release's `e2e` step): on a visit whose `tests_status` fails (the 1st by
  default) one passed, one failed and one skipped; on later visits the failed one passes; e2e-release's
  `e2e_status` follows `['fail', 'pass']`. The engine saves them in `<run_dir>/e2e/`
  (`src/engine/scenarios.js`) and the gates show them ("written, run at release" for pending);
  `npm run screenshot -- --view run --stop-at approve_merge` shows the gate with them. Local hero
  has no merge approval: the run's summary (`renderRunSummary`, views/run/run.js) shows them.
- **Where E2E runs (#199)**: development runs write the issue's scenarios (user-visible issues only,
  at most 3, `@issue-<n>`) and check that they parse (a dry run), never start the app or a browser
  for them; the whole suite runs once, at release, in the bundled `e2e-release.yaml` (its own
  worktree of the local base, one feature file at a time within `time_budget_minutes`, a failed
  scenario → developer → review → the scenario again, at most `max_rounds`, then a human gate; a
  green pass records `refs/multiagent/e2e-last-green`). Development runs merge locally without
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
