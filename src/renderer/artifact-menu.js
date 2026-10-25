// Artifact context menu (#114): right-click (or Shift+F10 / the context-menu key) on an artifact of a
// list, or on an open image, copies it out of the app. One menu for the Artifacts screen (app.js's
// renderArtifactList / renderArtifactViewer) and the shared Artifacts panel (artifacts-panel.js: the
// Run screen's Artifacts tab and a gate's side panel):
// - a file: Copy to clipboard (an image as an image, a text file as its text), Copy file (the file
//   itself, to paste in the file explorer or a chat; desktop only) and Copy path;
// - an open image (each side of a before/after pair too): Copy image and Copy path.
// The main process only copies a run's artifacts (clipboard:writeImage / clipboard:writeFile in
// src/host/main.js); the browser UI copies images and text through the web Clipboard API.
// A toast says "Copied" or why it failed; the menu closes on Esc, a click outside, scroll or blur.
// Uses app.js's helpers (api, esc, errMsg, showToast).
(() => {
  const TEXT_KINDS = ['markdown', 'json', 'table', 'text'];
  let menu = null;
  let opener = null;
  const baseOf = (p) => String(p || '').replace(/\\/g, '/').split('/').pop();
  const desktop = () => api.platform !== 'browser';

  function close(refocus = false) {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onBlur);
    document.removeEventListener('scroll', onBlur, true);
    if (refocus && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  const onOutside = (e) => { if (menu && !menu.contains(e.target)) close(); };
  const onBlur = () => close();

  async function run(action, label) {
    try {
      const detail = await action();
      showToast(t('artifact_menu.copied'), detail || label);
    } catch (e) {
      showToast(t('artifact_menu.could_not_copy'), errMsg(e));
    }
  }

  // The file's content: an image as an image, a text file as its text, anything else as the file
  async function copyContent(file) {
    const name = file.name || baseOf(file.path);
    if (file.kind === 'image') { await api.clipboardWriteImage(file.path); return `The image ${name}.`; }
    const doc = await api.readArtifact(file.path);
    if (doc.image) { await api.clipboardWriteImage(file.path); return `The image ${name}.`; }
    if (doc.binary || doc.text == null) {
      if (!desktop()) throw new Error(`${name} is not a text file: copy the file itself in the desktop app.`);
      await api.clipboardWriteFile(file.path);
      return `The file ${name} (not text).`;
    }
    await api.clipboardWrite(doc.text);
    return doc.truncated ? `The first 5 MB of ${name}.` : `The text of ${name}.`;
  }

  function items(target) {
    const { path, image } = target;
    const name = target.name || baseOf(path);
    if (image) {
      return [
        ['Copy image', () => api.clipboardWriteImage(path).then(() => `The image ${name}.`)],
        ['Copy path', () => api.clipboardWrite(path).then(() => path)],
      ];
    }
    return [
      ['Copy to clipboard', () => copyContent(target), target.kind === 'image' ? 'image' : TEXT_KINDS.includes(target.kind) ? 'text' : ''],
      ...(desktop() ? [['Copy file', () => api.clipboardWriteFile(path).then(() => `The file ${name}: paste it in a folder or a chat.`)]] : []),
      ['Copy path', () => api.clipboardWrite(path).then(() => path)],
    ];
  }

  // e: the contextmenu event (or a keyboard one: the menu opens at the element);
  // target: { path, kind, name } for a file, { path, image: true } for an open image.
  function open(e, target) {
    if (!target?.path) return;
    e.preventDefault();
    e.stopPropagation();
    close();
    opener = e.currentTarget instanceof Element ? e.currentTarget : e.target instanceof Element ? e.target : null;
    const list = items(target);
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.dataset.ctxFor = target.image ? 'image' : 'file';
    menu.innerHTML = list.map(([label, , hint], i) => `<button type="button" role="menuitem" class="ctx-item" data-ctx="${i}">${esc(label)}${hint ? ` <span class="muted small">${esc(hint)}</span>` : ''}</button>`).join('');
    document.body.appendChild(menu);
    // a keyboard opening has no pointer position: under the element
    const fromKeyboard = !(e.clientX || e.clientY);
    const rect = (e.target instanceof Element ? e.target : opener)?.getBoundingClientRect();
    let x = fromKeyboard && rect ? rect.left + 12 : e.clientX;
    let y = fromKeyboard && rect ? rect.top + Math.min(rect.height, 28) : e.clientY;
    const m = menu.getBoundingClientRect();
    x = Math.max(4, Math.min(x, window.innerWidth - m.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - m.height - 4));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-ctx]');
      if (!b) return;
      const [label, action] = list[+b.dataset.ctx];
      close(true);
      run(action, label);
    });
    menu.addEventListener('keydown', (ev) => {
      const all = [...menu.querySelectorAll('.ctx-item')];
      const i = all.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); close(true); } else if (ev.key === 'Tab') close(true);
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus({ preventScroll: true });
      } else if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); all[ev.key === 'Home' ? 0 : all.length - 1].focus({ preventScroll: true }); }
    });
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    document.addEventListener('scroll', onBlur, true);
    menu.querySelector('.ctx-item')?.focus({ preventScroll: true });
  }

  window.ArtifactMenu = { close, copyContent, open };
})();
