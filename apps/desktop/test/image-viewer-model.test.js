// apps/desktop/renderer/image-viewer-model.js (#145): the zoom/pan math of the shared image viewer, without
// the DOM. A view is { scale, x, y }: the image drawn at `scale`, its top-left corner at (x, y) in
// the stage ({ w, h }).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/image-viewer-model');

const IMG = { w: 2000, h: 1000 };
const STAGE = { w: 1000, h: 500 }; // half the image on both axes: fit scale is 0.5
const SMALL = { w: 100, h: 50 };

test('fit: a larger-than-stage image is scaled down to cover the stage exactly, centred', () => {
  const v = M.fit(IMG, STAGE);
  assert.equal(v.scale, 0.5);
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('fit: a smaller-than-stage image opens at 100%, never upscaled, centred in the stage', () => {
  const v = M.fit(SMALL, STAGE);
  assert.equal(v.scale, 1);
  assert.equal(v.x, (STAGE.w - SMALL.w) / 2);
  assert.equal(v.y, (STAGE.h - SMALL.h) / 2);
});

test('fitScale/minScale/maxScale: fit (never above 100%) is the minimum zoom, 400% is the maximum', () => {
  assert.equal(M.fitScale(IMG, STAGE), 0.5);
  assert.equal(M.minScale(IMG, STAGE), M.fitScale(IMG, STAGE));
  assert.equal(M.maxScale(IMG, STAGE), M.MAX_SCALE);
  // a small image never upscales past 100% to "fit": its fit scale is capped at 1
  assert.equal(M.fitScale(SMALL, STAGE), 1);
  assert.equal(M.maxScale(SMALL, STAGE), M.MAX_SCALE);
});

test('zoomTo: the image point under the given stage point stays under it', () => {
  const view = M.fit(IMG, STAGE); // { scale: 0.5, x: 0, y: 0 }
  const at = { x: 250, y: 250 };
  const next = M.zoomTo(view, 1, at, IMG, STAGE);
  assert.equal(next.scale, 1);
  // the image point under (250,250) at scale 0.5 is (500,500); at scale 1 it must stay at (250,250)
  const imgX = (at.x - view.x) / view.scale;
  const imgY = (at.y - view.y) / view.scale;
  assert.equal(imgX * next.scale + next.x, at.x);
  assert.equal(imgY * next.scale + next.y, at.y);
});

test('zoomTo/zoomBy: the scale is clamped between fit and the maximum', () => {
  const view = M.fit(IMG, STAGE);
  const tooFar = M.zoomTo(view, 100, { x: 0, y: 0 }, IMG, STAGE);
  assert.equal(tooFar.scale, M.maxScale(IMG, STAGE));
  const tooClose = M.zoomTo(view, 0.01, { x: 0, y: 0 }, IMG, STAGE);
  assert.equal(tooClose.scale, M.fitScale(IMG, STAGE));
  const byStep = M.zoomBy(view, M.STEP, { x: 0, y: 0 }, IMG, STAGE);
  assert.equal(byStep.scale, view.scale * M.STEP);
});

test('actual: zooms to 100% around the centre of the stage', () => {
  const view = M.fit(IMG, STAGE);
  const v = M.actual(IMG, STAGE, view);
  assert.equal(v.scale, 1);
});

test('isZoomed: true once the scale is above fit', () => {
  const view = M.fit(IMG, STAGE);
  assert.equal(M.isZoomed(view, IMG, STAGE), false);
  assert.equal(M.isZoomed(M.zoomTo(view, 1, { x: 0, y: 0 }, IMG, STAGE), IMG, STAGE), true);
});

test('pan: clamped so a zoomed image always covers the stage and never leaves it — every corner is reachable', () => {
  const view = M.zoomTo(M.fit(IMG, STAGE), 1, { x: STAGE.w / 2, y: STAGE.h / 2 }, IMG, STAGE);
  const farRight = M.pan(view, 1e6, 0, IMG, STAGE);
  const farLeft = M.pan(view, -1e6, 0, IMG, STAGE);
  // the image (2000x1000 at scale 1) is larger than the stage on both axes: x stays in [stage.w - img.w, 0]
  assert.equal(farRight.x, 0);
  assert.equal(farLeft.x, STAGE.w - IMG.w);
});

test('pan: an axis where the (zoomed) image is smaller than the stage stays centred, ignoring the drag', () => {
  const view = M.fit(SMALL, STAGE); // scale 1, image smaller than the stage on both axes
  const panned = M.pan(view, 500, 500, SMALL, STAGE);
  assert.equal(panned.x, view.x);
  assert.equal(panned.y, view.y);
});

test('isDrag: a press under the pixel threshold is a click, not a drag', () => {
  assert.equal(M.isDrag(1, 1), false);
  assert.equal(M.isDrag(M.DRAG_PX, 0), true);
  assert.equal(M.isDrag(3, 3), true);
});

test('percent: the scale as a rounded percentage', () => {
  assert.equal(M.percent({ scale: 1 }), '100%');
  assert.equal(M.percent({ scale: 0.5 }), '50%');
  assert.equal(M.percent({ scale: 1.2345 }), '123%');
});

test('clamp: a view outside the image/stage bounds snaps back inside them', () => {
  const v = M.clamp({ scale: 1, x: 9999, y: -9999 }, IMG, STAGE);
  assert.ok(v.x <= 0 && v.x >= STAGE.w - IMG.w);
  assert.ok(v.y <= 0 && v.y >= STAGE.h - IMG.h);
});
