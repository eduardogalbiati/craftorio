# Running tests and where a new test goes

What `npm test` runs, CI, and the folder and file a new test belongs in.

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
  (`@craftorio/shared/test/i18n-sandbox`, `@craftorio/engine/test/contract/harness`):
  `packages/engine/test/` holds the engine's, the service's (`service/`), the domains' (`<domain>/`),
  the contract suite (`contract/`), the slow runs (`slow/`), the fixtures (`fixtures/`) and the helpers
  `engine-helpers.js`, `worktree-helpers.js`; `packages/shared/test/` the shared modules'. The root
  `test/` keeps the repository's own tests (scripts, docs, packaging, the test runner), the renderer's
  and the host's until phase 2's desktop package, and their helpers (`mini-dom.js`, …), required as
  `../<helper>`.
- Tests never read live documents (#695): a document under `docs/work/` is edited by people and
  docs PRs that run no test, so a test copies it into its `test/fixtures/` and reads the copy.
  `npm run check`'s `test-fixtures` rule (`scripts/test-fixture-rule.js`) names each test file and
  line that reads a path under `docs/work/`.
- Node 24's test reporter is "spec", not TAP: look for `ℹ pass N` / `✖`, not `# pass`.
- `npm test` must pass on Windows, Linux and macOS: `ci.yml` runs a matrix (checks `test (<os>)`)
  plus a combined `test` check that is green only when every planned OS is. PRs run Ubuntu +
  Windows; macOS only for platform-sensitive paths or the `ci:macos` label, weekly and on manual
  runs (`scripts/ci-plan.js`, Actions minutes: macOS counts ×10). `preview.yml`/`deploy.yml` build
  on each OS (see [environment.md](../environment.md)) and skip `npm test` when CI already passed on the same code (the `ci/tested`
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
  A new `@visual` scenario's baseline comes with the change (#696): `baseline_check` sends develop
  back when one is missing; if one still reaches the E2E step, Playwright writes it (its default
  `updateSnapshots: 'missing'`, never `-u`, so an existing baseline is never rewritten), the step
  lists it in `new_baselines` and passes, and only a pixel difference fails and goes to the healer.
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
