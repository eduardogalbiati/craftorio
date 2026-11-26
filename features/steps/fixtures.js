// The playwright-bdd test of the E2E suite (#222): the `e2e` fixture opens the app on demand (a
// Given step: features/support/app.js) and closes it after the scenario. The app is an Electron
// window, not Playwright's own browser page, so the fixture applies the config's `use.trace`,
// `use.video` and `use.screenshot` itself: a failed scenario keeps its trace (trace.zip, with the
// window's screencast: Playwright's recordVideo stalls Electron 44 windows, so the trace's
// screencast is the scenario's video) and a screenshot of the window, attached to the report
// (results.json) and kept under the output folder. Only the visual lane's launches (the project
// with metadata.screenshotSlot, playwright.config.js) take the machine's screenshot slot (#365).
// A scenario tagged @webgl (#849) launches the app with software WebGL where there is no GPU
// (CRAFTORIO_E2E_SOFTWARE_WEBGL=1, features/support/electron-main.js); the others never do.

const fs = require('fs');
const { test: base, createBdd } = require('playwright-bdd');
const { launchApp } = require('../support/app');
const { launchServedUi } = require('../support/served');

const modeOf = (v) => String(v?.mode ?? v ?? 'off');
// keep an artifact: 'on' always, the retain/only/first-retry modes when the scenario failed
const keep = (mode, failed) => mode === 'on' || (mode !== 'off' && failed);

const test = base.extend({
  e2e: async ({}, use, testInfo) => {
    const { trace, video, screenshot } = testInfo.project.use;
    const recordTrace = modeOf(trace) !== 'off' || modeOf(video) !== 'off';
    const slot = Boolean(testInfo.project.metadata?.screenshotSlot);
    const webgl = { CRAFTORIO_E2E_SOFTWARE_WEBGL: testInfo.tags.includes('@webgl') ? '1' : '0' };
    const state = {
      app: null,
      window: null,
      project: null,
      // opens the app (once per scenario): { theme: light | dark, size: 'WxH' }
      async open(options = {}) {
        if (state.app) throw new Error('the app is already open in this scenario');
        const opened = await launchApp({ ...options, env: { ...webgl, ...options.env }, slot });
        Object.assign(state, opened);
        if (recordTrace) await opened.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
        return opened.window;
      },
      // #339: a served engine (scripts/serve.js) and a browser window for its UI, on about:blank
      // until state.served.open() (features/support/served.js); same trace and screenshot handling
      async openServed(options = {}) {
        if (state.app) throw new Error('the app is already open in this scenario');
        const opened = await launchServedUi({ ...options, slot });
        Object.assign(state, opened, { served: opened });
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
    // an unsaved workflow in the Builder (dirty) makes the window ask before it closes (beforeunload):
    // Playwright cannot answer that native dialog and the close waits on it. The scenario is over, so
    // the teardown destroys the windows (no beforeunload); the app's own behaviour is unchanged
    await state.app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await state.close();
  },
});

module.exports = {
  test,
  ...createBdd(test),
};
