# Machine independence, the mock provider and real CLIs

Machine-independent tests, the mock provider, simulated machine actions (#353) and when real CLIs cost money.

## Machine-independent tests

Git tests run with an empty `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`, passing identity,
`init.defaultBranch=main` and `core.autocrlf=false` with `-c`. So any production git command that
creates a commit needs its own `-c user.name/email`.

## The mock provider

- Picks the first enum value unless `MOCK_SEQUENCES` has a fitting sequence (or the run's
  `mockSequences` option overrides it). The default sequence fails the preview once with
  `failure_class: code` and recovers. Numbers and booleans take sequences too (`score`, `ready`).
- `mockSequences.screenshots: [[visit1], [visit2]]` (#57) sets the develop answer's `screenshots`
  list per visit, like `files_changed` (the last one repeats; `[]` lists no screen). Without it
  the developer lists one simulated screen.
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
- The safety rule is not in the adapter: under `CRAFTORIO_SIMULATION_ONLY=1` the real adapter's
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
  take the machine-wide slot of `packages/engine/engine/machine-slot.js` (`<os tmp>/craftorio/locks/screenshot.slot`,
  or `CRAFTORIO_LOCKS_DIR`): a second capture waits ("waiting for the screenshot slot"), a dead
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
  checked by default; off = real runs. Simulated `/loop` waits scale with `CRAFTORIO_MOCK_DELAY_SCALE`.
- To check the flags a real turn gets without a model, point a provider at `node` +
  `packages/engine/test/fixtures/fake-claude.js` (it answers with its own arguments; `test/capabilities.test.js`).

## Real CLIs and money

- Never open real CLI terminals or start real runs in automated checks (they cost money).
- **Workflow agents never prefix it**: the engine starts every agent process with
  `CRAFTORIO_SIMULATION_ONLY=1` already set (`AGENT_ENV` in `packages/engine/engine/capabilities.js`), so
  `npm test` and `node --test …` run as they are; a `VAR=value` prefix makes Claude Code refuse
  the command headless (see [capabilities.md](../capabilities.md)).
- **Simulation-only guard**: `CRAFTORIO_SIMULATION_ONLY=1` (`packages/engine/engine/simulation.js`) makes real
  runs impossible: `run:start`/`runs:resume` (and its alias `supervisor:resume`)/`backlog:assign` refuse `mock: false` (never
  downgraded to a simulation), CLI terminals (`term:open` cli/cli-new/cli-resume/supervisor, the
  external console) are refused, and `providers.runTurn` refuses every non-mock provider. The UI
  shows a "Simulation only" badge and behaves as Developer mode. It is set by `scripts/test.js`
  (`npm test`), `scripts/smoke.js` (which also uses a scratch temporary workspace and fails unless
  every session was `mock`), the CI workflows and the tests' `makeService`/server helpers. A test
  that drives a real provider type at a fake CLI (`fake-claude.js`) lifts it for its duration.
  On macOS a simulation on a throwaway user data folder (`CRAFTORIO_USER_DATA`, which the smoke, the
  screenshots and the E2E launches set) also runs with Chromium's mock keychain (`--use-mock-keychain`,
  set by `apps/desktop/host/main.js` in a development checkout): safeStorage never asks for "Chromium
  Safe Storage", a dialog that blocked those runs until dismissed; the owner's own user data keeps the
  real keychain.
- UI checks run through `scripts/smoke.js` (or a script built the same way), never through a
  hand-written script that launches `apps/desktop/host/main` directly. The remote engine (the app as a window onto
  `npm run serve`) has `scripts/smoke-remote.js <out-dir>`: a scratch server on 127.0.0.1, the app in
  remote mode on a scratch user data folder, its Settings, its connection page and the engine
  stopping (see [environment.md](../environment.md), "Remote engine").
- In the UI, a checked Simulation box that can't apply (Developer mode off) fails the start with a
  message (`wantsSimulation` in app.js); it never silently starts a real run.
- Real-model calls cost the owner's money: say so and keep them minimal (one call to validate).
- In automated checks that go through `resolveCommand`, put a fake **`.exe`** first on PATH (it
  prefers any `.exe` over a `.cmd`) or a real CLI starts.
