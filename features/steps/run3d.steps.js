// Steps of features/run-3d-view.feature (#388): the run's 3D view draws on demand. The view is the
// overlay data-testid="run3d" (role dialog "Run in 3D", packages/ui-kit/run3d.js), opened by the Run
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
// The window is minimised and restored in the main process (BrowserWindow.minimize / restore), and
// the page is told it is hidden / visible (see setPageHidden: the harness keeps it visible).

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

// The harness keeps the page visible while minimised (features/support/electron-main.js disables
// native window occlusion and renderer backgrounding), so the page is told it is hidden: document's
// own hidden / visibilityState are shadowed and 'visibilitychange' is dispatched, as Chromium does.
// Restoring removes the shadows (the prototype's getters answer again) and dispatches it again.
const setPageHidden = (page, hidden) => page.evaluate((h) => {
  if (h) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  } else {
    delete document.hidden;
    delete document.visibilityState;
  }
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

// The HUD's cards (#833). Each card of the HUD (packages/ui-kit/run3d/hud.jsx, Kpis) carries
// data-testid="run3d-card-<name>" (NEW): run3d-card-visits, run3d-card-cost, run3d-card-tokens (the
// new card), run3d-card-elapsed. Inside them (NEW): run3d-cost-per-m, the line under the cost
// ("$2.63/M tokens"); run3d-tokens-total, the total ("3.7M"); run3d-tokens-split, the line under it
// ("69k output · 87% cache read"). Every kind of token is in the Tokens card's tooltip: the `title`
// of the card or of an element inside it.
const hudCard = (page, name) => overlay(page).getByTestId(`run3d-card-${name}`);
const TOKENS = /^\d+(\.\d+)?[kM]?$/;

Then('the 3D view\'s Cost card shows {string} with a price per million tokens under it', async ({ e2e }, cost) => {
  const card = hudCard(e2e.window, 'cost');
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(cost);
  await expect(card.getByTestId('run3d-cost-per-m')).toHaveText(/^\s*\$\d+(\.\d+)?\s*\/\s*M tokens\s*$/);
  await expect(card, 'the output tokens moved to the Tokens card').not.toContainText(/output tokens/i);
});

Then('the 3D view\'s Tokens card shows a total with its output and cache read share under it', async ({ e2e }) => {
  const card = hudCard(e2e.window, 'tokens');
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('run3d-tokens-total')).toHaveText(TOKENS);
  await expect(card.getByTestId('run3d-tokens-total')).not.toHaveText(/^0$/);
  await expect(card.getByTestId('run3d-tokens-split')).toHaveText(/^\s*\d+(\.\d+)?[kM]? output\s*·\s*\d+% cache read\s*$/);
});

Then('the 3D view\'s Tokens card lists every kind of token in its tooltip', async ({ e2e }) => {
  const card = hudCard(e2e.window, 'tokens');
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  const tooltip = () => card.evaluate((el) => [el, ...el.querySelectorAll('[title]')]
    .map((n) => n.getAttribute('title') || '').join(' ').replace(/\s+/g, ' '));
  // The issue says "cache creation", Analytics says "cache write": either label is accepted.
  for (const kind of [/input/i, /output/i, /cache read/i, /cache (write|creation)/i]) {
    await expect.poll(tooltip, { message: `the Tokens card's tooltip names ${kind}`, timeout: LOAD_TIMEOUT })
      .toMatch(kind);
  }
});

Then('the 3D view\'s HUD cards are, in order, {string}', async ({ e2e }, list) => {
  const want = list.split(',').map((s) => s.trim());
  const cards = overlay(e2e.window).locator('[data-testid^="run3d-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => cards.evaluateAll((els) => els.map((el) => el.dataset.testid.replace('run3d-card-', ''))), {
    message: 'the HUD cards, left to right', timeout: LOAD_TIMEOUT,
  }).toEqual(want);
});

When('I minimise the app\'s window', async ({ e2e }) => {
  await setWindow(e2e, 'minimize');
  await setPageHidden(e2e.window, true);
  await expect.poll(() => e2e.window.evaluate(() => document.visibilityState), { timeout: LOAD_TIMEOUT }).toBe('hidden');
});

When('I restore the app\'s window', async ({ e2e }) => {
  await setWindow(e2e, 'restore');
  await setPageHidden(e2e.window, false);
  await expect.poll(() => e2e.window.evaluate(() => document.visibilityState), { timeout: LOAD_TIMEOUT }).toBe('visible');
});
