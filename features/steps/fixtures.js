// The playwright-bdd test of the E2E suite (#222): the `e2e` fixture opens the app on demand (a
// Given step: features/support/app.js) and closes it after the scenario. The app is an Electron
// window, not Playwright's own browser page, so the fixture applies the config's `use.trace`,
// `use.video` and `use.screenshot` itself: a failed scenario keeps its trace (trace.zip, with the
// window's screencast: Playwright's recordVideo stalls Electron 44 windows, so the trace's
// screencast is the scenario's video) and a screenshot of the window, attached to the report
// (results.json) and kept under the output folder.

const fs = require('fs');
const { test: base, createBdd } = require('playwright-bdd');
const { launchApp } = require('../support/app');

const modeOf = (v) => String(v?.mode ?? v ?? 'off');
// keep an artifact: 'on' always, the retain/only/first-retry modes when the scenario failed
const keep = (mode, failed) => mode === 'on' || (mode !== 'off' && failed);

const test = base.extend({
  e2e: async ({}, use, testInfo) => {
    const { trace, video, screenshot } = testInfo.project.use;
    const recordTrace = modeOf(trace) !== 'off' || modeOf(video) !== 'off';
    const state = {
      app: null,
      window: null,
      project: null,
      // opens the app (once per scenario): { theme: light | dark, size: 'WxH' }
      async open(options = {}) {
        if (state.app) throw new Error('the app is already open in this scenario');
        const opened = await launchApp(options);
        Object.assign(state, opened);
        if (recordTrace) await opened.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
        return opened.window;
      },
    };
    await use(state);
    if (!state.app) return;
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (keep(modeOf(screenshot), failed)) {
      const file = testInfo.outputPath('failure.png');
      if (await state.window.screenshot({ path: file }).catch(() => null)) await testInfo.attach('screenshot', { path: file, contentType: 'image/png' });
    }
    if (recordTrace) {
      const file = testInfo.outputPath('trace.zip');
      const kept = keep(modeOf(trace), failed) || keep(modeOf(video), failed);
      await state.app.context().tracing.stop(kept ? { path: file } : {}).catch(() => {});
      if (fs.existsSync(file)) await testInfo.attach('trace', { path: file, contentType: 'application/zip' });
    }
    await state.close();
  },
});

module.exports = {
  test,
  ...createBdd(test),
};
