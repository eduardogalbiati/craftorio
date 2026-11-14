// Mockup element inspector (#625, D7): runs inside the editor's canvas, the sandboxed iframe of a mockup
// screen (served on mockup:// by apps/desktop/host/mockups-window.js, which injects this file before
// </body>; sandbox allow-scripts without allow-same-origin, so it reaches no window.api). A click on the
// screen climbs to the nearest element with data-mid (the generator puts one on every node,
// MockupModel.addMids) and posts { type: 'mockup:select', mid, selector, kit, text, box, html, add } (add:
// Shift, Ctrl or ⌘ held, the element joins the selection) to the
// editor (fronts/plan/views/mockups/mockup-editor.js), which draws it as a selection chip in the designer
// chat. describeElement(el) → { mid, selector (ancestors' tag.class, ending with the element's), kit
// (data-kit or null), text (trimmed, at most 200 characters), box ([x, y, width, height] rounded),
// html (outerHTML, at most 300 characters) }. The main window loads it too: there (not in a frame) it
// installs nothing. UMD: module.exports in Node, window.MockupInspector in the browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.MockupInspector = api;
    api.install(root);
  }
})(typeof window !== 'undefined' ? window : null, () => {
  const MAX_HTML = 300;
  const MAX_TEXT = 200;
  const DEPTH = 4; // ancestors kept in the selector

  // tag.class of one element (the first two classes)
  function part(el) {
    const tag = String(el.localName || el.tagName || '').toLowerCase();
    const cls = String(el.className && typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return tag + cls.map((c) => `.${c}`).join('');
  }

  function selectorOf(el) {
    const parts = [];
    for (let n = el; n && parts.length < DEPTH; n = n.parentElement) {
      const tag = String(n.localName || '').toLowerCase();
      if (!tag || tag === 'html' || tag === 'body') break;
      parts.unshift(part(n));
    }
    return parts.join(' > ');
  }

  function describeElement(target) {
    const el = target?.closest ? target.closest('[data-mid]') : null;
    if (!el) return null;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    const attr = (k) => (el.getAttribute ? el.getAttribute(k) : null);
    return {
      mid: attr('data-mid'),
      selector: selectorOf(el),
      kit: attr('data-kit') || null,
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT),
      box: [r.x ?? r.left ?? 0, r.y ?? r.top ?? 0, r.width ?? 0, r.height ?? 0].map((v) => Math.round(Number(v) || 0)),
      html: String(el.outerHTML || '').slice(0, MAX_HTML),
    };
  }

  // inside a frame only: a click selects (and does not follow links or submit forms)
  function install(win) {
    let parent = null;
    try { parent = win.parent; } catch { return false; }
    if (!parent || parent === win || !win.document?.addEventListener) return false;
    win.document.addEventListener('click', (e) => {
      const d = describeElement(e.target);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      // Shift (or Ctrl/⌘) adds the element to the selection instead of replacing it
      parent.postMessage({ type: 'mockup:select', ...d, add: !!(e.shiftKey || e.ctrlKey || e.metaKey) }, '*');
    }, true);
    return true;
  }

  return { describeElement, install };
});
