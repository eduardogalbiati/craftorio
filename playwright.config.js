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
// One Electron at a time (workers: 1; each launch also takes the machine's screenshot slot, #199).
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

module.exports = defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  retries: 0,
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
