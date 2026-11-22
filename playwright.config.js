// End-to-end suite (#222): Playwright + playwright-bdd on the real Electron app, deterministic, no
// LLM at run time. The feature files (features/*.feature, one per area, every scenario tagged
// @issue-<n>, the critical journeys @smoke) are turned into Playwright tests by `bddgen` (into
// .features-gen/); the steps are features/steps/*.js, and features/support/app.js launches the app
// with _electron on a fresh simulated workspace (CRAFTORIO_SIMULATION_ONLY=1, demo data, never as
// plain Node: ELECTRON_RUN_AS_NODE removed).
//
//   npm run test:e2e                         the whole suite (scripts/e2e.js: bddgen, then playwright test)
//   npm run test:e2e -- --grep @smoke        the critical journeys (a few minutes)
//   npm run test:e2e -w fronts/analyser      one front's features (phase 3 of the reorganisation study)
//   npm run test:e2e:update -- --grep @visual   rewrite the visual baselines (on purpose only)
//
// Two lanes (#365), two Playwright projects:
//   behaviour   every scenario that is neither @visual nor @serial, in E2E_WORKERS workers, fully
//               parallel; it never takes the screenshot slot.
//   visual      the @visual scenarios (and any @serial one), one at a time; each launch takes the
//               machine's screenshot slot (#199), so a run capturing screenshots elsewhere on the
//               machine still makes this lane wait.
// E2E_WORKERS (#366): CRAFTORIO_E2E_WORKERS unset or `auto` sizes it from the machine's threads and
// free memory, clamp(1, 4, min(floor(threads / 8), floor((freeGB - 4) / 1.5))); the constants and the
// measurements behind them are in scripts/e2e-workers.js. A number N (>= 1) forces N; an invalid value
// falls back to auto with a warning. The suite prints its choice at start, e.g.
// "E2E: 2 workers (auto: 20 threads, 11.2 GB free)".
// CRAFTORIO_E2E_WORKERS=1 gives back the old one-Electron-at-a-time suite. Shared state checked for
// the parallel lane: each scenario has its own scratch workspace, user-data and HOME; servers listen
// on port 0 (the phone gates fall back to it when their port is taken); the OS clipboard is used by
// one scenario only (control-channel.feature). A scenario that shares state with another one gets
// @serial, with the reason in a comment above it.
// A failed scenario keeps its trace, video and screenshot (features/steps/fixtures.js applies `use`
// to the Electron window) under .test-output/e2e/artifacts/, and the results go to
// .test-output/e2e/results.json (the e2e-release workflow's suite step reads them).
// Visual baselines: features/__screenshots__/<name>-<platform>.png, committed; a difference over
// maxDiffPixelRatio fails with the expected / actual / diff images attached.

require('@craftorio/engine/domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const os = require('os');
const path = require('path');
const { defineConfig } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');
const { e2eWorkers } = require('./scripts/e2e-workers');
const { featureDirs, fronts } = require('./scripts/source-tree');

// Phase 3 of docs/reorganisation-study-2026-10.md: the features live with their packages (the shell's
// in features/ and the kit's features/, a front's in fronts/<id>/features/), the steps next to them
// (every steps folder is loaded whatever runs: the fronts share the shell's steps). The folders are
// scripts/source-tree.js's (featureDirs), never named here. CRAFTORIO_E2E_FRONT=<id>
// (`node scripts/e2e.js --front <id>`, a front's `npm run test:e2e`) runs that front's features only.
const FRONT = process.env.CRAFTORIO_E2E_FRONT;
const allFeatureDirs = featureDirs(__dirname);
const frontDir = FRONT && fronts(__dirname).find((f) => f.id === FRONT)?.dir;
if (FRONT && !frontDir) throw new Error(`CRAFTORIO_E2E_FRONT names no front: ${FRONT} (fronts: ${fronts(__dirname).map((f) => f.id).join(', ')})`);
const testDir = defineBddConfig({
  features: frontDir ? `${frontDir}/features/**/*.feature` : allFeatureDirs.map((d) => `${d}/**/*.feature`),
  steps: allFeatureDirs.map((d) => `${d}/steps/**/*.js`),
  outputDir: '.features-gen',
});

// the behaviour lane's workers, also the whole run's pool (the visual lane uses one of them)
const choice = e2eWorkers({ value: process.env.CRAFTORIO_E2E_WORKERS, threads: os.availableParallelism(), freeBytes: os.freemem() });
// Playwright loads this file again in each worker process: the choice is printed by the runner only
if (process.env.TEST_WORKER_INDEX === undefined) {
  if (choice.warning) console.warn(choice.warning);
  console.log(choice.line);
}
const E2E_WORKERS = choice.workers;
const SERIAL = /@visual|@serial/;
// @quarantine: scenarios set aside for the v1.5.0 release (owner, 2026-11-15): they fail on the WSL
// engine host (no WebGL, no D-Bus keyring) or are stale against intended changes. Excluded by default;
// CRAFTORIO_E2E_QUARANTINE=1 runs them too. Each comes back out of quarantine through its own issue.
const QUARANTINE = process.env.CRAFTORIO_E2E_QUARANTINE === '1' ? null : /@quarantine/;
const BEHAVIOUR_OUT = QUARANTINE ? /@visual|@serial|@quarantine/ : SERIAL;

module.exports = defineConfig({
  testDir,
  workers: E2E_WORKERS,
  fullyParallel: false,
  retries: 0,
  projects: [
    { name: 'behaviour', grepInvert: BEHAVIOUR_OUT, workers: E2E_WORKERS, fullyParallel: true },
    // features/steps/fixtures.js takes the screenshot slot for this lane's launches only
    { name: 'visual', grep: SERIAL, ...(QUARANTINE ? { grepInvert: QUARANTINE } : {}), workers: 1, fullyParallel: false, metadata: { screenshotSlot: true } },
  ],
  // a scenario's own budget: the app's start plus a simulated run up to its first gate
  timeout: 180000,
  outputDir: path.join('.test-output', 'e2e', 'artifacts'),
  snapshotPathTemplate: path.join(__dirname, 'features', '__screenshots__', '{arg}-{platform}{ext}'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join('.test-output', 'e2e', 'results.json') }],
  ],
  expect: {
    timeout: 15000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
