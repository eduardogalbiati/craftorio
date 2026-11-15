// #836: the host's captureMockupRegion (mockups:crops, fronts/plan/engine/channels/mockups.js) turns a
// selected region of the mockup editor window, `box` [x, y, width, height] in the window's coordinates,
// into a PNG data URL, or null when there is nothing to capture (no window, a destroyed one, a bad or empty
// box, an empty image). It lives inline in apps/desktop/host/main.js (the `host` object given to
// createService), which requires Electron at load, so like main-agents-window-navigate-263.test.js this
// reads its source: the property is sliced out and evaluated with a fake mockups window (the Electron
// boundary: webContents.capturePage). Results are compared as primitives.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'host', 'main.js'), 'utf8');

// captureMockupRegion with `mockupsWindow` the given fake (or null)
function capture(mockupsWindow) {
  const m = mainSrc.match(/captureMockupRegion:\s*(async[\s\S]*?\n\s*\}),\n/);
  assert.ok(m, 'apps/desktop/host/main.js gives the service host a captureMockupRegion');
  return vm.runInNewContext(`(${m[1]})`, { mockupsWindow, Array, Math, Number });
}

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
function fakeWindow({ destroyed = false, empty = false } = {}) {
  const rects = [];
  const win = {
    isDestroyed: () => destroyed,
    webContents: { capturePage: async (rect) => { rects.push(JSON.stringify(rect)); return { isEmpty: () => empty, toDataURL: () => PNG }; } },
  };
  return { rects, mockupsWindow: { current: () => win } };
}

test('#836 captureMockupRegion captures the box of the editor window as a PNG data URL', async () => {
  const { rects, mockupsWindow } = fakeWindow();
  const out = await capture(mockupsWindow)({ box: [10, 20, 200, 40] });
  assert.deepEqual([out, rects], [PNG, ['{"x":10,"y":20,"width":200,"height":40}']]);
});

test('#836 captureMockupRegion rounds the box and clamps negative values to the window', async () => {
  const { rects, mockupsWindow } = fakeWindow();
  await capture(mockupsWindow)({ box: [-5, 3.6, 99.4, 40.5] });
  assert.deepEqual(rects, ['{"x":0,"y":4,"width":99,"height":41}']);
});

test('#836 captureMockupRegion gives null without an editor window', async () => {
  assert.equal(await capture(null)({ box: [0, 0, 10, 10] }), null);
  assert.equal(await capture({ current: () => null })({ box: [0, 0, 10, 10] }), null);
});

test('#836 captureMockupRegion gives null for a destroyed window, capturing nothing', async () => {
  const { rects, mockupsWindow } = fakeWindow({ destroyed: true });
  assert.deepEqual([await capture(mockupsWindow)({ box: [0, 0, 10, 10] }), rects.length], [null, 0]);
});

test('#836 captureMockupRegion gives null for a missing, malformed or empty box, capturing nothing', async () => {
  const { rects, mockupsWindow } = fakeWindow();
  const fn = capture(mockupsWindow);
  const outs = [await fn(), await fn({}), await fn({ box: [0, 0, 10] }), await fn({ box: [0, 0, 0, 30] }), await fn({ box: [5, 5, 40, 0] })];
  assert.deepEqual([outs, rects.length], [[null, null, null, null, null], 0]);
});

test('#836 captureMockupRegion gives null when the captured image is empty', async () => {
  const { mockupsWindow } = fakeWindow({ empty: true });
  assert.equal(await capture(mockupsWindow)({ box: [0, 0, 10, 10] }), null);
});
