// Image viewer (#145): the one viewer every artifact image of the app opens in (the Artifacts panel
// of a gate and of the Run screen, the Artifacts screen; a new place that shows an artifact image
// uses it too). Almost full screen over a dark overlay, above the screen, which does not change
// (a gate keeps its choice and its feedback text):
// - the image fitted to the window (a small one at 100%, never upscaled), its title and caption on
//   top, a close button; Esc, the button or a click on the overlay outside the image close it;
// - zoom: a click zooms in at the point clicked (magnifier cursor), the wheel zooms around the
//   cursor, + / − / Fit / 100% buttons with the percentage (keys + - 0 1), from fit to 400%;
// - zoomed, a drag pans the image (grab cursor), clamped so it never leaves the view; a press that
//   does not move is still a click;
// - an original/modified pair (#146): tabs (or ← / →) switch to the other image at the same zoom
//   and position, to compare them;
// - an image that does not load: "Could not load the image"; right-click: the copy menu (#114).
// ImageViewer.open({ title, images: [{ src?, file?, label?, caption? }], index }) (file: an
// artifact's path, read with artifacts:read when there is no src, and the copy menu's target);
// ImageViewer.THUMB: the attributes of a clickable thumbnail (hand cursor, hint, focusable).
// The zoom/pan math is image-viewer-model.js. Uses app.js's helpers (esc, api) and ArtifactMenu.
(() => {
  const M = window.ImageViewerModel;
  const THUMB = 'tabindex="0" role="button" title="Click to enlarge" data-iv-thumb';
  let cur = null;

  function open(opts = {}) {
    close();
    const images = (opts.images || []).filter(Boolean);
    if (!images.length) return;
    const el = document.createElement('div');
    el.className = 'iv';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', opts.title || 'Image');
    el.innerHTML = `<div class="iv-bar">
        <div class="iv-title"><b title="${esc(opts.title || '')}">${esc(opts.title || '')}</b><span class="iv-caption muted small"></span></div>
        ${images.length > 1 ? `<div class="seg sm iv-tabs" role="tablist">${images.map((im, i) => `<button type="button" role="tab" data-iv-tab="${i}" title="${esc(im.label || '')} (← / → to switch)">${esc(im.label || `Image ${i + 1}`)}</button>`).join('')}</div>` : ''}
        <div class="iv-zoom">
          <button type="button" class="btn sm ghost" data-iv-zoom="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
          <span class="iv-pct mono small" aria-live="polite"></span>
          <button type="button" class="btn sm ghost" data-iv-zoom="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button type="button" class="btn sm ghost" data-iv-zoom="fit" title="Fit to the window (0)">Fit</button>
          <button type="button" class="btn sm ghost" data-iv-zoom="actual" title="Actual size (1)">100%</button>
        </div>
        <button type="button" class="btn sm ghost iv-close" data-iv-close title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="iv-stage"><img class="iv-img" alt="" draggable="false" /><p class="iv-msg muted hidden"></p></div>`;
    document.body.appendChild(el);
    cur = { el, images, index: -1, view: null, size: null, opener: document.activeElement, drag: null, seq: 0 };
    const stage = el.querySelector('.iv-stage');
    const img = el.querySelector('.iv-img');
    el.addEventListener('click', onClick);
    stage.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('pointerdown', onPointerDown);
    img.addEventListener('pointermove', onPointerMove);
    img.addEventListener('pointerup', onPointerUp);
    img.addEventListener('pointercancel', () => { if (cur) { cur.drag = null; cur.el.classList.remove('iv-grabbing'); } });
    img.addEventListener('contextmenu', (e) => {
      const file = cur?.images[cur.index]?.file;
      if (file && window.ArtifactMenu) ArtifactMenu.open(e, { path: file, image: true });
    });
    img.addEventListener('load', onLoad);
    img.addEventListener('error', () => failed());
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    show(Math.min(Math.max(0, opts.index || 0), images.length - 1));
    el.querySelector('[data-iv-close]').focus({ preventScroll: true });
  }

  function close() {
    if (!cur) return;
    const { el, opener } = cur;
    cur = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    el.remove();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  const parts = () => ({ stage: cur.el.querySelector('.iv-stage'), img: cur.el.querySelector('.iv-img'), msg: cur.el.querySelector('.iv-msg') });
  const stageSize = () => { const s = parts().stage; return { w: s.clientWidth, h: s.clientHeight }; };

  // Shows image i; the view (zoom and position) is kept when switching inside a pair.
  async function show(i) {
    if (!cur || i === cur.index || i < 0 || i >= cur.images.length) return;
    cur.index = i;
    const im = cur.images[i];
    const { img, msg } = parts();
    cur.el.querySelectorAll('[data-iv-tab]').forEach((b) => {
      const on = +b.dataset.ivTab === i;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    cur.el.querySelector('.iv-caption').textContent = [im.label, im.caption].filter(Boolean).join(' · ');
    img.alt = im.caption || im.label || '';
    const seq = ++cur.seq;
    let src = im.src || null;
    if (!src && im.file) {
      msg.textContent = 'Loading…';
      msg.classList.remove('hidden');
      try { src = (await api.readArtifact(im.file))?.image || null; } catch { src = null; }
      if (!cur || seq !== cur.seq) return;
      im.src = src;
    }
    if (!src) { failed(); return; }
    msg.classList.add('hidden');
    cur.el.classList.remove('iv-failed');
    img.classList.remove('hidden');
    if (img.getAttribute('src') === src && img.complete && img.naturalWidth) onLoad();
    else img.src = src;
  }

  function failed() {
    if (!cur) return;
    const { img, msg } = parts();
    img.classList.add('hidden');
    msg.textContent = 'Could not load the image';
    msg.classList.remove('hidden');
    cur.el.classList.add('iv-failed');
    cur.el.querySelector('.iv-pct').textContent = '';
    cur.el.querySelectorAll('[data-iv-zoom]').forEach((b) => { b.disabled = true; });
  }

  function onLoad() {
    if (!cur) return;
    const { img } = parts();
    cur.size = { w: img.naturalWidth, h: img.naturalHeight };
    img.style.width = `${cur.size.w}px`;
    img.style.height = `${cur.size.h}px`;
    cur.el.querySelectorAll('[data-iv-zoom]').forEach((b) => { b.disabled = false; });
    cur.view = cur.view ? M.clamp(cur.view, cur.size, stageSize()) : M.fit(cur.size, stageSize());
    paint();
  }

  function paint() {
    if (!cur?.view) return;
    const { img } = parts();
    const v = cur.view;
    img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    cur.el.querySelector('.iv-pct').textContent = M.percent(v);
    cur.el.classList.toggle('iv-zoomed', M.isZoomed(v, cur.size, stageSize()));
    cur.el.classList.toggle('iv-max', v.scale >= M.maxScale(cur.size, stageSize()) - 1e-6);
  }

  function setView(fn) {
    if (!cur?.view || !cur.size) return;
    cur.view = fn(cur.view, cur.size, stageSize());
    paint();
  }
  const center = () => { const s = stageSize(); return { x: s.w / 2, y: s.h / 2 }; };
  const pointIn = (e) => { const r = parts().stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function zoom(how, at = center()) {
    if (how === 'in') setView((v, im, st) => M.zoomBy(v, M.STEP, at, im, st));
    else if (how === 'out') setView((v, im, st) => M.zoomBy(v, 1 / M.STEP, at, im, st));
    else if (how === 'fit') setView((v, im, st) => M.fit(im, st));
    else if (how === 'actual') setView((v, im, st) => M.actual(im, st, v));
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-iv-close]')) { close(); return; }
    const tab = t.closest('[data-iv-tab]');
    if (tab) { show(+tab.dataset.ivTab); return; }
    const z = t.closest('[data-iv-zoom]');
    if (z) { zoom(z.dataset.ivZoom); return; }
    // the overlay outside the image (the image's own clicks are pointerup)
    if (t.classList.contains('iv-stage') || t.classList.contains('iv-msg')) close();
  }

  function onWheel(e) {
    if (!cur?.view) return;
    e.preventDefault();
    const at = pointIn(e);
    setView((v, im, st) => M.zoomBy(v, e.deltaY < 0 ? M.STEP : 1 / M.STEP, at, im, st));
  }

  function onPointerDown(e) {
    if (!cur?.view || e.button !== 0) return;
    e.preventDefault();
    cur.drag = { x0: e.clientX, y0: e.clientY, view0: cur.view, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    const d = cur?.drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && !M.isDrag(dx, dy)) return;
    d.moved = true;
    if (!M.isZoomed(d.view0, cur.size, stageSize())) return;
    cur.el.classList.add('iv-grabbing');
    setView((v, im, st) => M.pan(d.view0, dx, dy, im, st));
  }

  function onPointerUp(e) {
    const d = cur?.drag;
    if (!d) return;
    cur.drag = null;
    cur.el.classList.remove('iv-grabbing');
    if (d.moved) return;
    const at = pointIn(e);
    setView((v, im, st) => M.zoomBy(v, M.CLICK_ZOOM, at, im, st));
  }

  function onResize() {
    if (!cur?.view) return;
    const st = stageSize();
    cur.view = M.isZoomed(cur.view, cur.size, st) ? M.clamp(cur.view, cur.size, st) : M.fit(cur.size, st);
    paint();
  }

  function onKey(e) {
    if (!cur || e.target?.closest?.('.ctx-menu')) return; // the copy menu handles its own keys
    const keys = { Escape: () => close(), ArrowLeft: () => show(cur.index - 1), ArrowRight: () => show(cur.index + 1), '+': () => zoom('in'), '=': () => zoom('in'), '-': () => zoom('out'), 0: () => zoom('fit'), 1: () => zoom('actual') };
    if (e.key === 'Tab') { trapFocus(e); return; }
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation(); // the screen behind never sees the viewer's keys (Esc closes only the viewer)
    fn();
  }

  // Tab stays inside the viewer
  function trapFocus(e) {
    const list = [...cur.el.querySelectorAll('button:not([disabled])')];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
    e.preventDefault();
    list[next].focus({ preventScroll: true });
  }

  window.ImageViewer = { THUMB, close, isOpen: () => !!cur, open };
})();
