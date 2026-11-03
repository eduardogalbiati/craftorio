// The app's menu (#748): one component for every ⋮ / ⋯ menu (the roadmap stage's, the roadmap bar's,
// the Backlog card's), so a new screen draws its menu with it instead of building its own.
// - menuHtml(items, { label, testid, className }): a role="menu" (class "ui-menu") with, per entry
//   { id, icon?, iconHtml?, label, title?, disabledReason?, danger?, testid?, attrs? }, a
//   role="menuitem" button: a fixed icon slot first (.ui-menu-icon, empty when the entry has none; `icon`
//   is text, escaped, `iconHtml` the caller's own SVG), then its label. A refused entry
//   (`disabledReason`) stays, dimmed, aria-disabled (never `disabled`: the keyboard still reaches it),
//   its reason in its title only: no line of text between the entries. `danger` marks a destructive
//   entry (ui-menu-danger). `attrs` is the caller's raw markup (its data-* hooks). { divider: true } is a
//   role="separator"; falsy items are skipped and dividers collapse (never first, last or twice).
// - bindMenu(menuEl, { onPick, onClose, anchor }) → { close() }: arrows (wrapping), Home / End move
//   between the entries (dividers skipped, refused entries reached); Enter clicks the focused entry; a
//   click on an allowed entry calls onPick(id); Escape calls onClose('escape'); a press or a click
//   outside the menu and its `anchor` (the button that opened it, or a function returning it) calls
//   onClose('outside'), once. close() removes the listeners. The look is menu.css.
// Browser: window.Menu; Node: module.exports.
// load: early (the views draw their menus with it)
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SEP = '<div role="separator" class="ui-menu-sep"></div>';

  function entryHtml(e) {
    const why = e.disabledReason || '';
    const title = why || e.title || '';
    const icon = e.iconHtml != null ? e.iconHtml : esc(e.icon || '');
    return `<button type="button" role="menuitem" class="ui-menu-item${e.danger ? ' ui-menu-danger' : ''}" data-menu-id="${esc(e.id)}"`
      + `${title ? ` title="${esc(title)}"` : ''}${why ? ' aria-disabled="true"' : ''}${e.testid ? ` data-testid="${esc(e.testid)}"` : ''}${e.attrs ? ` ${e.attrs}` : ''}>`
      + `<span class="ui-menu-icon" aria-hidden="true">${icon}</span><span class="ui-menu-label">${esc(e.label)}</span></button>`;
  }

  function menuHtml(items, { label = '', testid = '', className = '' } = {}) {
    const rows = [];
    for (const it of items || []) {
      if (!it) continue;
      if (it.divider) { if (rows.length && rows[rows.length - 1] !== SEP) rows.push(SEP); continue; }
      rows.push(entryHtml(it));
    }
    while (rows[rows.length - 1] === SEP) rows.pop();
    return `<div class="ui-menu${className ? ` ${esc(className)}` : ''}" role="menu"${label ? ` aria-label="${esc(label)}"` : ''}${testid ? ` data-testid="${esc(testid)}"` : ''}>${rows.join('')}</div>`;
  }

  function bindMenu(menu, { onPick, onClose, anchor } = {}) {
    const doc = menu.ownerDocument || root.document;
    let open = true;
    const entries = () => [...menu.querySelectorAll('[role="menuitem"]')];
    const refused = (el) => el.getAttribute('aria-disabled') === 'true';
    const entryOf = (target) => { const el = target?.closest?.('[role="menuitem"]'); return el && menu.contains(el) ? el : null; };
    const onKey = (e) => {
      const list = entries();
      const at = list.indexOf(doc.activeElement);
      const to = { ArrowDown: at + 1, ArrowUp: at < 0 ? -1 : at - 1, Home: 0, End: -1 }[e.key];
      if (to !== undefined) {
        e.preventDefault();
        if (list.length) list[(to + list.length) % list.length].focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish('escape');
      } else if (e.key === 'Enter' && entryOf(e.target)) {
        e.preventDefault(); // one click, ours: a refused entry ignores it
        entryOf(e.target).click();
      }
    };
    const onClick = (e) => { const el = entryOf(e.target); if (el && !refused(el)) onPick?.(el.getAttribute('data-menu-id')); };
    const inside = (target) => {
      const a = typeof anchor === 'function' ? anchor() : anchor;
      return menu.contains(target) || !!(a && a.contains(target));
    };
    const onDoc = (e) => { if (!inside(e.target)) finish('outside'); };
    function close() {
      open = false;
      menu.removeEventListener('keydown', onKey);
      menu.removeEventListener('click', onClick);
      doc.removeEventListener('mousedown', onDoc);
      doc.removeEventListener('click', onDoc);
    }
    function finish(why) {
      if (!open) return;
      close();
      onClose?.(why);
    }
    menu.addEventListener('keydown', onKey);
    menu.addEventListener('click', onClick);
    doc.addEventListener('mousedown', onDoc);
    doc.addEventListener('click', onDoc);
    return { close };
  }

  const api = {
    bindMenu,
    menuHtml,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Menu = api;
})(typeof window !== 'undefined' ? window : globalThis);
