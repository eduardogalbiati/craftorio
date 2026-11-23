/* global api */
// Pasting images into the AI prompt fields (#130): Ctrl+V with an image on the clipboard (a
// Win+Shift+S screenshot, an image copied in a browser) in a field of voice.js's VOICE_FIELDS adds
// it as an attachment of that field: a chip row under it (48 px thumbnail, image-1.png · 240 KB,
// × to remove; a click on the thumbnail opens ImageViewer). The image is saved at once into the
// workspace's staging folder through the service (clipboard:saveImage, packages/engine/domains/chat/pasted-images.js), so
// the browser UI works the same; while it is saved the chip shows a spinner, a refused one is a red
// chip with the reason and the field keeps its text. A clipboard that holds text pastes the text as
// usual, even when it also holds an image (a copy from Office). Pasting never sends anything: the
// screen that submits the field takes its images (PasteImage.settle, then .attachments) and clears
// the chips with the text (.clear). Fields rendered later get it from one document-level paste
// listener; the hint (paste_image.paste_an_image) is added by the same MutationObserver pattern as
// voice.js. Fields with their own image paste (the Product Owner #117, the Oracle #171) are left to
// it. Pure helpers (pastedFiles, checkImage, formatSize) are exported for the tests.
// load: after voice.js
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  // the limits of a turn's attachments (packages/engine/engine/providers.js ATTACHMENT_LIMITS)
  const LIMITS = { count: 10, bytes: 10 * 1024 * 1024 };
  const TYPES = { 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  // #28: the hint in the interface language, read when a field is attached
  const hint = () => t('paste_image.paste_an_image');
  // fields that already handle a pasted image themselves
  const OWN_PASTE = '#inbox-text, #po-question, .oracle-input';

  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
  const formatSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  // The image files of a paste event's clipboardData; none when it holds text (the text pastes).
  function pastedFiles(data) {
    if (!data || (data.getData?.('text/plain') || '').length) return [];
    return [...(data.items || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
  }

  // Why a pasted file is refused (count: the field's images already kept), or null.
  function checkImage(file, count = 0) {
    if (count >= LIMITS.count) return `Over ${LIMITS.count} images`;
    if (!TYPES[file?.type]) return 'Unsupported format';
    if (file.size > LIMITS.bytes) return `Image too large: ${mb(file.size)}, max ${mb(LIMITS.bytes)}`;
    return null;
  }

  const helpers = { checkImage, formatSize, hint, LIMITS, pastedFiles };
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;

  const FIELDS = () => root.voice?.VOICE_FIELDS || 'textarea[id^="in-"]';
  const message = (e) => (typeof root.errMsg === 'function' ? root.errMsg(e) : String(e?.message || e));
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const kept = (st) => st.items.filter((i) => i.status !== 'error');

  const readDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('Could not read the pasted image.'));
    r.readAsDataURL(file);
  });

  // Adds images (File/Blob objects) to a field's chips and saves each one.
  function add(ta, files) {
    const st = ta._paste;
    if (!st) return;
    for (const file of files) {
      const id = `p${++st.seq}`;
      const item = { id, name: `image-${st.seq}.${TYPES[file.type] || 'png'}`, size: file.size, status: 'saving', dataUrl: null, path: null, error: null };
      item.error = checkImage(file, kept(st).length);
      if (!item.error && typeof api?.clipboardSaveImage !== 'function') item.error = 'Image paste is available in the desktop app';
      if (item.error) item.status = 'error';
      st.items.push(item);
      if (!item.error) item.saving = save(ta, item, file);
    }
    render(ta);
  }

  async function save(ta, item, file) {
    try {
      item.dataUrl = await readDataUrl(file);
      render(ta);
      const out = await api.clipboardSaveImage(item.dataUrl.slice(item.dataUrl.indexOf(',') + 1), item.name);
      // removed while it was saved: its file goes too
      if (!ta._paste.items.includes(item)) return void api.clipboardDiscardImage(out.path).catch(() => {});
      Object.assign(item, { path: out.path, size: out.size, status: 'ready' });
    } catch (e) {
      Object.assign(item, { status: 'error', error: message(e) });
    }
    render(ta);
  }

  function remove(ta, id) {
    const st = ta._paste;
    const item = st?.items.find((i) => i.id === id);
    if (!item) return;
    st.items = st.items.filter((i) => i !== item);
    if (item.path) api.clipboardDiscardImage(item.path).catch(() => {});
    render(ta);
    ta.focus({ preventScroll: true });
  }

  const chipHtml = (i) => {
    const lead = i.status === 'error' ? ''
      : i.status === 'saving' || !i.dataUrl ? `<span class="paste-spin" role="status" aria-label="${t('paste_image.saving_the_image')}"></span>`
        : `<img class="paste-thumb" ${root.ImageViewer?.THUMB || 'tabindex="0" role="button"'} src="${escape(i.dataUrl)}" alt="${escape(i.name)}" data-paste-view="${escape(i.id)}" />`;
    const text = i.status === 'error' ? `<span title="${escape(i.error)}">${escape(i.error)}</span>` : `<span>${escape(i.name)}</span><small>${escape(formatSize(i.size))}</small>`;
    return `<span class="ar-chip paste-chip${i.status === 'error' ? ' error' : ''}" title="${escape(i.status === 'error' ? i.error : i.name)}">${lead}${text}`
      + `<button type="button" data-paste-remove="${escape(i.id)}" title="${t('common.remove')}" aria-label="${t('paste_image.remove_name', { name: escape(i.name) })}">×</button></span>`;
  };

  // The chip row sits under the field (after voice.js's mic and badge); no row while it is empty.
  function render(ta) {
    const st = ta._paste;
    if (!st.row) {
      if (!st.items.length) return;
      st.row = document.createElement('div');
      st.row.className = 'ar-chips paste-chips';
      st.row.addEventListener('click', (e) => onRowClick(ta, e));
      st.row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.pasteView) { e.preventDefault(); view(ta, e.target.dataset.pasteView); } });
      let anchor = ta;
      while (anchor.nextElementSibling?.matches('.voice-mic, .voice-busy')) anchor = anchor.nextElementSibling;
      anchor.after(st.row);
    }
    st.row.classList.toggle('hidden', !st.items.length);
    st.row.innerHTML = st.items.map(chipHtml).join('');
    // the mic is placed from the bottom of the field's box, which the row just changed
    if (ta._voiceBtn) root.voice?.place?.(ta._voiceBtn);
  }

  function onRowClick(ta, e) {
    const rm = e.target.closest('[data-paste-remove]');
    if (rm) return remove(ta, rm.dataset.pasteRemove);
    const thumb = e.target.closest('[data-paste-view]');
    if (thumb) view(ta, thumb.dataset.pasteView);
  }

  function view(ta, id) {
    const shown = ta._paste.items.filter((i) => i.dataUrl && i.status !== 'error');
    const index = shown.findIndex((i) => i.id === id);
    // every pasted image of the field, one item each (#182)
    if (index >= 0 && root.ImageViewer) root.ImageViewer.open({ title: t('paste_image.pasted_images'), items: shown.map((i) => ({ title: i.name || t('paste_image.pasted_image'), images: [{ src: i.dataUrl, label: i.name }] })), index });
  }

  // ---- what the screens that submit a field call ----------------------------------------------
  /** Waits for the field's images still being saved. */
  const settle = (ta) => Promise.all((ta?._paste?.items || []).map((i) => i.saving).filter(Boolean));
  /** The field's saved images, as the engine takes them: [{ path, name }] (empty: send nothing). */
  const attachments = (ta) => (ta?._paste?.items || []).filter((i) => i.status === 'ready' && i.path).map((i) => ({ path: i.path, name: i.name }));
  /** Both: the field's images once saved. */
  const collect = (ta) => settle(ta).then(() => attachments(ta));
  /** Clears the chips (the field was submitted: the request copied the images). */
  function clear(ta) {
    if (!ta?._paste) return;
    ta._paste.items = [];
    render(ta);
  }

  function attach(ta) {
    if (ta._paste || ta.matches(OWN_PASTE)) return;
    ta._paste = { items: [], row: null, seq: 0 };
    const ph = ta.getAttribute('placeholder') || '';
    const text = hint();
    if (!ph.includes(text)) ta.setAttribute('placeholder', ph ? `${ph} · ${text}` : text);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(FIELDS())) attach(node);
    node.querySelectorAll(FIELDS()).forEach(attach);
  }

  function init() {
    scan(document.body);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
    // bubbling: a field's own handler (the Product Owner, the Oracle) has already taken its images
    document.addEventListener('paste', (e) => {
      const ta = e.target;
      if (e.defaultPrevented || !ta?._paste || ta.disabled || ta.readOnly) return;
      const files = pastedFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      add(ta, files);
    });
  }

  root.PasteImage = { ...helpers, add, attach, attachments, clear, collect, settle };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
