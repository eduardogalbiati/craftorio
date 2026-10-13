// End-to-end suite (#222): Playwright + playwright-bdd on the real Electron app, deterministic, no
// LLM at run time. The feature files (features/*.feature, one per area, every scenario tagged
// @issue-<n>, the critical journeys @smoke) are turned into Playwright tests by `bddgen` (into
// .features-gen/); the steps are features/steps/*.js, and features/support/app.js launches the app
// with _electron on a fresh simulated workspace (MULTIAGENT_SIMULATION_ONLY=1, demo data, never as
// plain Node: ELECTRON_RUN_AS_NODE removed).
//
//   npm run test:e2e                         the whole suite
//   npm run test:e2e -- --grep @smoke        the critical journeys (a few minutes)
//   npm run test:e2e:update -- --grep @visual   rewrite the visual baselines (on purpose only)
//
// Two lanes (#365), two Playwright projects:
//   behaviour   every scenario that is neither @visual nor @serial, in E2E_WORKERS workers
//               (MULTIAGENT_E2E_WORKERS, default 2), fully parallel; it never takes the screenshot slot.
//   visual      the @visual scenarios (and any @serial one), one at a time; each launch takes the
//               machine's screenshot slot (#199), so a run capturing screenshots elsewhere on the
//               machine still makes this lane wait.
// MULTIAGENT_E2E_WORKERS=1 gives back the old one-Electron-at-a-time suite. Shared state checked for
// the parallel lane: each scenario has its own scratch workspace, user-data and HOME; servers listen
// on port 0 (the phone gates fall back to it when their port is taken); the OS clipboard is used by
// one scenario only (control-channel.feature). A scenario that shares state with another one gets
// @serial, with the reason in a comment above it.
// A failed scenario keeps its trace, video and screenshot (features/steps/fixtures.js applies `use`
// to the Electron window) under .test-output/e2e/artifacts/, and the results go to
// .test-output/e2e/results.json (the e2e-release workflow's suite step reads them).
// Visual baselines: features/__screenshots__/<name>-<platform>.png, committed; a difference over
// maxDiffPixelRatio fails with the expected / actual / diff images attached.

const path = require('path');
const { defineConfig } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/steps/**/*.js',
  outputDir: '.features-gen',
});

// the behaviour lane's workers, also the whole run's pool (the visual lane uses one of them)
const E2E_WORKERS = Math.max(1, Number.parseInt(process.env.MULTIAGENT_E2E_WORKERS, 10) || 2);
const SERIAL = /@visual|@serial/;

module.exports = defineConfig({
  testDir,
  workers: E2E_WORKERS,
  fullyParallel: false,
  retries: 0,
  projects: [
    { name: 'behaviour', grepInvert: SERIAL, workers: E2E_WORKERS, fullyParallel: true },
    // features/steps/fixtures.js takes the screenshot slot for this lane's launches only
    { name: 'visual', grep: SERIAL, workers: 1, fullyParallel: false, metadata: { screenshotSlot: true } },
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
