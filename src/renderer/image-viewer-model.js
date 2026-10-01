// The zoom and pan math of the image viewer (image-viewer.js, #145), without the DOM. A view is
// { scale, x, y }: the image drawn at `scale`, its top-left corner at (x, y) in the stage. Sizes are
// { w, h } (img: natural size, stage: the viewer's area).
// - fit: the whole image in the stage, never upscaled (a small image opens at 100%);
// - zoom goes from fit to 400% (MAX_SCALE), around a point of the stage (the cursor, the click);
// - pan is clamped: an image smaller than the stage is centred on that axis, a larger one always
//   covers the stage (every corner can be reached, it never leaves the view).
// Browser: window.ImageViewerModel; Node: module.exports.
(function (root) {
  const MAX_SCALE = 4;
  const STEP = 1.25; // + / − buttons and one wheel notch
  const CLICK_ZOOM = 2; // a click on the image
  const DRAG_PX = 4; // a press that moves less than this is a click, not a drag

  const fitScale = (img, stage) => (img.w > 0 && img.h > 0 && stage.w > 0 && stage.h > 0 ? Math.min(1, stage.w / img.w, stage.h / img.h) : 1);
  const minScale = (img, stage) => fitScale(img, stage);
  const maxScale = (img, stage) => Math.max(MAX_SCALE, fitScale(img, stage));

  function clampAxis(pos, size, room) {
    if (size <= room) return (room - size) / 2;
    return Math.min(0, Math.max(room - size, pos));
  }

  function clamp(view, img, stage) {
    const scale = Math.min(maxScale(img, stage), Math.max(minScale(img, stage), view.scale));
    return { scale, x: clampAxis(view.x, img.w * scale, stage.w), y: clampAxis(view.y, img.h * scale, stage.h) };
  }

  const fit = (img, stage) => clamp({ scale: fitScale(img, stage), x: 0, y: 0 }, img, stage);
  const actual = (img, stage, view = fit(img, stage)) => zoomTo(view, 1, { x: stage.w / 2, y: stage.h / 2 }, img, stage);

  // The image point under `at` (stage coordinates) stays under it.
  function zoomTo(view, scale, at, img, stage) {
    const next = Math.min(maxScale(img, stage), Math.max(minScale(img, stage), scale));
    const k = next / view.scale;
    return clamp({ scale: next, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, img, stage);
  }

  const zoomBy = (view, factor, at, img, stage) => zoomTo(view, view.scale * factor, at, img, stage);
  const pan = (view, dx, dy, img, stage) => clamp({ scale: view.scale, x: view.x + dx, y: view.y + dy }, img, stage);
  const isZoomed = (view, img, stage) => view.scale > fitScale(img, stage) + 1e-6;
  const isDrag = (dx, dy) => Math.hypot(dx, dy) >= DRAG_PX;
  const percent = (view) => `${Math.round(view.scale * 100)}%`;

  const api = { CLICK_ZOOM, DRAG_PX, MAX_SCALE, STEP, actual, clamp, fit, fitScale, isDrag, isZoomed, maxScale, minScale, pan, percent, zoomBy, zoomTo };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageViewerModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
