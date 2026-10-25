// Image viewer (#145): the one viewer every artifact image of the app opens in (the Artifacts panel
// of a gate and of the Run screen, the Artifacts screen, the diff viewer, the chats; a new place
// that shows an image uses it too). Almost full screen over a dark overlay, above the screen, which
// does not change (a gate keeps its choice and its feedback text):
// - the image fitted to the window (a small one at 100%, never upscaled), its title and caption on
//   top, a close button; Esc, the button or a click on the overlay outside the image close it;
// - zoom: a click zooms in at the point clicked (magnifier cursor), the wheel zooms around the
//   cursor, + / − / Fit / 100% buttons with the percentage (keys + - 0 1), from fit to 400%;
// - zoomed, a drag pans the image (grab cursor), clamped so it never leaves the view; a press that
//   does not move is still a click;
// - the whole context (#182): every image of the place it was opened from, in the order shown there;
//   an original/modified pair is one item. Previous / next arrows on the sides and ← / →, Home / End
//   (no wrap-around), a counter "3 / 12"; going to another item fits it, the neighbours are
//   preloaded. One item: no arrows, no counter;
// - an original/modified pair (#146): tabs (or Space, O / M) switch to the other image at the same
//   zoom and position, to compare them;
// - an image that does not load: "Could not load the image" (the arrows still work); right-click:
//   the copy menu (#114).
// ImageViewer.open({ title, items: [{ title, images }], index, imageIndex }) or, for one item,
// ImageViewer.open({ title, images: [{ src?, file?, label?, caption?, side? }], index }) (file: an
// artifact's path, read with artifacts:read when there is no src, and the copy menu's target);
// ImageViewer.THUMB: the attributes of a clickable thumbnail (hand cursor, hint, focusable).
// The zoom/pan math is image-viewer-model.js, the browsing model image-sequence.js. Uses app.js's
// helpers (esc, api) and ArtifactMenu.
(() => {
  const M = window.ImageViewerModel;
  const S = window.ImageSequence;
  const THUMB = `tabindex="0" role="button" title="${t('image_viewer.click_to_enlarge')}" data-iv-thumb`;
  let cur = null;

  // { title, items } or { title, images, index } → the items and where to start
  function itemsOf(opts) {
    if (Array.isArray(opts.items)) return { items: opts.items.map((it) => ({ ...it, images: (it?.images || []).filter(Boolean) })), index: opts.index || 0, imageIndex: opts.imageIndex || 0 };
    return { items: [{ title: opts.title || '', images: (opts.images || []).filter(Boolean) }], index: 0, imageIndex: opts.index || 0 };
  }

  function open(opts = {}) {
    close();
    const { items, index, imageIndex } = itemsOf(opts);
    const seq = S.createImageSequence(items, index, imageIndex);
    if (!seq.length) return;
    const nav = seq.navigable();
    const el = document.createElement('div');
    el.className = 'iv';
    el.tabIndex = -1;
    el.setAttribute('data-testid', 'image-viewer');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', opts.title || t('image_viewer.image'));
    el.innerHTML = `<div class="iv-bar">
        <div class="iv-title"><b data-testid="image-viewer-title"></b>${nav ? '<span class="badge iv-counter" data-testid="image-viewer-counter" aria-live="polite"></span>' : ''}<span class="iv-caption muted small"></span></div>
        <div class="iv-tabs-slot"></div>
        <div class="iv-zoom">
          <button type="button" class="btn sm ghost" data-iv-zoom="out" title="${t('image_viewer.zoom_out')}" aria-label="${t('image_viewer.zoom_out_2')}">−</button>
          <span class="iv-pct mono small" aria-live="polite"></span>
          <button type="button" class="btn sm ghost" data-iv-zoom="in" title="${t('image_viewer.zoom_in')}" aria-label="${t('image_viewer.zoom_in_2')}">+</button>
          <button type="button" class="btn sm ghost" data-iv-zoom="fit" title="${t('image_viewer.fit_to_the_window_0')}">${t('image_viewer.fit')}</button>
          <button type="button" class="btn sm ghost" data-iv-zoom="actual" title="${t('image_viewer.actual_size_1')}">100%</button>
        </div>
        <button type="button" class="btn sm ghost iv-close" data-iv-close title="${t('image_viewer.close_esc')}" aria-label="${t('common.close')}">✕</button>
      </div>
      <div class="iv-stage"><img class="iv-img" alt="" draggable="false" /><p class="iv-msg muted hidden"></p>${nav ? `
        <button type="button" class="iv-arrow iv-prev" data-iv-nav="prev" aria-label="${t('image_viewer.previous_image')}" title="${t('image_viewer.previous_image_home_the_first')}">‹</button>
        <button type="button" class="iv-arrow iv-next" data-iv-nav="next" aria-label="${t('image_viewer.next_image')}" title="${t('image_viewer.next_image_end_the_last')}">›</button>` : ''}</div>`;
    document.body.appendChild(el);
    cur = { el, seq, item: -1, image: -1, view: null, size: null, opener: document.activeElement, drag: null, load: 0 };
    const stage = el.querySelector('.iv-stage');
    const img = el.querySelector('.iv-img');
    el.addEventListener('click', onClick);
    stage.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('pointerdown', onPointerDown);
    img.addEventListener('pointermove', onPointerMove);
    img.addEventListener('pointerup', onPointerUp);
    img.addEventListener('pointercancel', () => { if (cur) { cur.drag = null; cur.el.classList.remove('iv-grabbing'); } });
    img.addEventListener('contextmenu', (e) => {
      const file = cur?.seq.current().image?.file;
      if (file && window.ArtifactMenu) ArtifactMenu.open(e, { path: file, image: true });
    });
    img.addEventListener('load', onLoad);
    img.addEventListener('error', () => failed());
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    show('reset');
    // the dialog itself, not a button: Space switches inside a pair instead of pressing the button
    el.focus({ preventScroll: true });
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

  // The current item's tabs (a pair), its title, the counter and the arrows
  function paintItem() {
    const { item, index } = cur.seq.current();
    const images = item.images;
    cur.el.querySelector('[data-testid="image-viewer-title"]').textContent = item.title || cur.el.getAttribute('aria-label') || '';
    cur.el.querySelector('[data-testid="image-viewer-title"]').title = item.title || '';
    const counter = cur.el.querySelector('[data-testid="image-viewer-counter"]');
    if (counter) counter.textContent = cur.seq.counter();
    const prev = cur.el.querySelector('[data-iv-nav="prev"]');
    const next = cur.el.querySelector('[data-iv-nav="next"]');
    if (prev) prev.disabled = !cur.seq.hasPrev();
    if (next) next.disabled = !cur.seq.hasNext();
    if (cur.item === index) return;
    cur.item = index;
    const keyOf = (im) => (im.side === 'original' ? 'O' : im.side === 'modified' ? 'M' : '');
    cur.el.querySelector('.iv-tabs-slot').innerHTML = images.length > 1
      ? `<div class="seg sm iv-tabs" role="tablist">${images.map((im, i) => `<button type="button" role="tab" data-iv-tab="${i}" title="${t('image_viewer.value_value2_space_to_switch', { value: esc(im.label || ''), value2: keyOf(im) ? `${keyOf(im)} or ` : '' })}">${esc(im.label || t('image_viewer.image_value', { value: i + 1 }))}</button>`).join('')}</div>`
      : '';
  }

  // Shows the sequence's current image; zoom 'reset' fits it (another item), 'keep' keeps the view
  // (the other image of a pair).
  async function show(zoomMode) {
    if (!cur) return;
    const { image: im, imageIndex } = cur.seq.current();
    paintItem();
    if (zoomMode === 'reset') cur.view = null;
    cur.image = imageIndex;
    const { img, msg } = parts();
    cur.el.querySelectorAll('[data-iv-tab]').forEach((b) => {
      const on = +b.dataset.ivTab === imageIndex;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    cur.el.querySelector('.iv-caption').textContent = [im.label, im.caption].filter(Boolean).join(' · ');
    img.alt = im.caption || im.label || '';
    const load = ++cur.load;
    let src = im.src || null;
    if (!src && im.file) {
      msg.textContent = t('image_viewer.loading');
      msg.classList.remove('hidden');
      img.classList.add('hidden');
      src = await readSrc(im);
      if (!cur || load !== cur.load) return;
    }
    preload();
    if (!src) { failed(); return; }
    msg.classList.add('hidden');
    cur.el.classList.remove('iv-failed');
    img.classList.remove('hidden');
    if (img.getAttribute('src') === src && img.complete && img.naturalWidth) onLoad();
    else img.src = src;
  }

  // An image's data URL (artifacts:read, once)
  async function readSrc(im) {
    if (im.src) return im.src;
    if (!im.file) return null;
    try { im.src = (await api.readArtifact(im.file))?.image || null; } catch { im.src = null; }
    return im.src;
  }

  // The previous and next items' images, loaded before they are shown
  function preload() {
    const wanted = new Set(cur.seq.preload());
    for (const it of cur.seq.items) {
      for (const im of it.images) {
        if (!wanted.has(im.src || im.file) || im.preloaded) continue;
        im.preloaded = true;
        readSrc(im).then((src) => { if (src) { const pre = new Image(); pre.src = src; } });
      }
    }
  }

  function go(action) {
    if (!cur) return;
    const r = cur.seq.apply(action);
    if (r.moved) show(r.zoom);
  }

  function failed() {
    if (!cur) return;
    const { img, msg } = parts();
    img.classList.add('hidden');
    msg.textContent = t('image_viewer.could_not_load_the_image');
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
    const navBtn = t.closest('[data-iv-nav]');
    if (navBtn) { go(navBtn.dataset.ivNav); return; }
    const tab = t.closest('[data-iv-tab]');
    if (tab) {
      const side = cur.seq.current().item.images[+tab.dataset.ivTab]?.side;
      if (side) go(side);
      else if (+tab.dataset.ivTab !== cur.seq.imageIndex) go('switch');
      return;
    }
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
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = S.keyAction(e.key);
    if (!action) return;
    // Space on a focused button presses it (an arrow, a tab), like a click
    if (action === 'switch' && e.target?.closest?.('button')) return;
    e.preventDefault();
    e.stopPropagation(); // the screen behind never sees the viewer's keys (Esc closes only the viewer)
    if (action === 'close') close();
    else if (action.startsWith('zoom-')) zoom(action.slice(5));
    else if (action === 'fit' || action === 'actual') zoom(action);
    else go(action);
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
