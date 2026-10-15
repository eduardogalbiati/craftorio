// Steps of features/run-3d-view.feature (#388): the run's 3D view draws on demand. The view is the
// overlay data-testid="run3d" (role dialog "Run in 3D", src/renderer/run3d.js), opened by the Run
// screen's 3D button data-testid="run-3d" (#run-mode-3d) and closed by data-testid="run3d-close"
// ("Close the 3D view"); its scene is the canvas of React Three Fiber inside the overlay.
//
// The frame spy: before the view opens, the prototypes of WebGLRenderingContext and
// WebGL2RenderingContext get their draw calls (drawElements, drawArrays and their instanced / range
// forms) wrapped. A draw on a canvas inside the overlay marks that canvas as the 3D view's (a
// WeakSet: a canvas taken out of the page on close still counts, so a loop left running after close
// would show), and the draws made in one synchronous task count as one frame (three.js renders a
// whole frame in one gl.render call). Draw calls rather than requestAnimationFrame: the replay
// clock and the HUD may use timers or rAF of their own; what costs the CPU/GPU is the drawing.
//
// Measuring "no frames for 2 seconds" is a measured idle window: the counter is reset, the step waits
// 2 s (page.waitForTimeout: the window itself is what is measured, there is no event to wait for),
// then reads it. The view may still finish a short opening move (the camera settling), so the
// measurement is repeated (expect.poll) until one whole window has no frame, within 20 s: a view
// whose loop never stops never gets there. "Keeps drawing" asks for at least 10 frames in 2 s.
//
// The window is minimised and restored in the main process (BrowserWindow.minimize / restore).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const WINDOW_MS = 2000;
const SETTLE_TIMEOUT = 20000;
const MIN_LIVE_FRAMES = 10;

const overlay = (page) => page.getByTestId('run3d');

// installs the spy once per page: window.__r3dSpy = { frames, draws, reset() }
async function installFrameSpy(page) {
  await page.evaluate(() => {
    if (window.__r3dSpy) return;
    const spy = { frames: 0, draws: 0, inFrame: false, canvases: new WeakSet() };
    spy.reset = () => { spy.frames = 0; spy.draws = 0; };
    window.__r3dSpy = spy;
    const count = (canvas) => {
      if (!canvas) return;
      if (!spy.canvases.has(canvas)) {
        if (!(canvas.closest && canvas.closest('[data-testid="run3d"]'))) return;
        spy.canvases.add(canvas);
      }
      spy.draws += 1;
      if (spy.inFrame) return;
      spy.inFrame = true;
      spy.frames += 1;
      queueMicrotask(() => { spy.inFrame = false; });
    };
    const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'];
    for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Ctx) continue;
      for (const name of names) {
        const original = Ctx.prototype[name];
        if (typeof original !== 'function') continue;
        Ctx.prototype[name] = function spied(...args) {
          count(this.canvas);
          return original.apply(this, args);
        };
      }
    }
  });
}

const readFrames = (page) => page.evaluate(() => window.__r3dSpy.frames);
const resetFrames = (page) => page.evaluate(() => window.__r3dSpy.reset());

// the frames the 3D view draws in one measured window
async function framesIn(page, ms) {
  await resetFrames(page);
  await page.waitForTimeout(ms);
  return readFrames(page);
}

async function setWindow(e2e, how) {
  await e2e.app.evaluate(({ BrowserWindow }, action) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (action === 'minimize') w.minimize();
      else w.restore();
    }
  }, how);
}

When('I open the run\'s 3D view', async ({ e2e }) => {
  const page = e2e.window;
  await installFrameSpy(page);
  const button = page.getByTestId('run-3d').filter({ visible: true }).first();
  await expect(button, 'the 3D button is enabled (WebGL and the 3D bundle are there)').toBeEnabled({ timeout: LOAD_TIMEOUT });
  await button.click();
  await expect(overlay(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('the 3D scene has drawn', async ({ e2e }) => {
  const page = e2e.window;
  await expect(overlay(page).locator('canvas').first(), 'the scene is drawn in a canvas').toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => readFrames(page), { message: 'the 3D view drew its first frame', timeout: LOAD_TIMEOUT }).toBeGreaterThan(0);
});

Then('the 3D view draws no frames for {int} seconds', async ({ e2e }, seconds) => {
  const page = e2e.window;
  await expect.poll(() => framesIn(page, seconds * 1000), {
    message: `a whole ${seconds} s window without a frame of the 3D view`,
    timeout: SETTLE_TIMEOUT + seconds * 1000,
    intervals: [0],
  }).toBe(0);
});

Then('the 3D view keeps drawing frames', async ({ e2e }) => {
  const page = e2e.window;
  await expect.poll(() => framesIn(page, WINDOW_MS), {
    message: `the live 3D view draws at least ${MIN_LIVE_FRAMES} frames in ${WINDOW_MS / 1000} s`,
    timeout: LOAD_TIMEOUT,
    intervals: [0],
  }).toBeGreaterThanOrEqual(MIN_LIVE_FRAMES);
});

When('I close the 3D view', async ({ e2e }) => {
  await overlay(e2e.window).getByTestId('run3d-close').click();
});

Then('no 3D canvas remains', async ({ e2e }) => {
  const page = e2e.window;
  await expect(overlay(page)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  await expect(page.locator('[data-testid="run3d"] canvas')).toHaveCount(0);
});

When('I minimise the app\'s window', async ({ e2e }) => {
  await setWindow(e2e, 'minimize');
  await expect.poll(() => e2e.window.evaluate(() => document.visibilityState), { timeout: LOAD_TIMEOUT }).toBe('hidden');
});

When('I restore the app\'s window', async ({ e2e }) => {
  await setWindow(e2e, 'restore');
  await expect.poll(() => e2e.window.evaluate(() => document.visibilityState), { timeout: LOAD_TIMEOUT }).toBe('visible');
});
