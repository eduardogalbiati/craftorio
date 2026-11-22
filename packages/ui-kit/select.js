// The app's select (#383). Every select element keeps the native control: style.css turns it into the
// customizable select (`appearance: base-select`, its list on the panel colour, the chosen option
// marked), so keyboard, ARIA, disabled options and groups stay native, and `.value`, `change` and the
// E2E `selectOption` steps work as before. This file adds what CSS cannot:
// - the search list: a select with more than 10 options (SelectSearch.needsSearch) opens, on a click
//   or on Enter / Space / Alt+Down, a list of its own (role="listbox", one role="option" per option,
//   optgroups as role="group", disabled options shown disabled) with a search box on top
//   (data-testid="select-search", role="searchbox"), on --panel in the top layer (above drawers,
//   dialogs and the 3D HUDs), under the select or flipped above it near the window's bottom. Typing
//   filters (SelectSearch.matchOption); arrows, Home / End and Enter pick, Esc, a click outside, a
//   scroll or the window losing focus close it. A pick sets the select's value and dispatches a
//   bubbling `change`.
// - markup(attrs, options, value): a select's markup, for the screens that build one from a list:
//   options are [value, label, { disabled }] tuples, { value, label, disabled } objects, plain
//   values, or option markup as a string. New screens use it instead of a bare select tag
//   (scripts/bare-controls.js counts those).
// Browser: window.Select; Node: module.exports.
// load: early (the screens' panels are built with it as they load)
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function optionHtml(o, value) {
    const [v, label, extra] = Array.isArray(o) ? o : (o && typeof o === 'object') ? [o.value, o.label, o] : [o, o];
    const selected = value != null && String(v) === String(value) ? ' selected' : '';
    const disabled = extra?.disabled ? ' disabled' : '';
    return `<option value="${esc(v)}"${selected}${disabled}>${esc(label ?? v)}</option>`;
  }

  function markup(attrs = '', options = [], value = null) {
    const inner = typeof options === 'string' ? options : options.map((o) => optionHtml(o, value)).join('');
    return `<select ${attrs}>${inner}</select>`;
  }

  // ---- the search list ------------------------------------------------------------------------
  let open = null; // { sel, box, search, list }

  const searchable = (sel) => sel instanceof HTMLSelectElement && !sel.multiple && !sel.disabled && sel.size <= 1
    && root.SelectSearch?.needsSearch(sel.options.length);

  const items = () => (open ? [...open.list.querySelectorAll('[role=option]')] : []);
  const pickable = () => items().filter((el) => !el.hidden && el.getAttribute('aria-disabled') !== 'true');

  function setActive(el) {
    for (const o of items()) o.classList.toggle('active', o === el);
    if (!el) { open.search.removeAttribute('aria-activedescendant'); return; }
    open.search.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  function optionEl(opt, i) {
    const el = document.createElement('div');
    el.className = 'sel-option';
    el.id = `sel-option-${i}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(opt.selected));
    if (opt.disabled || opt.parentElement?.disabled) el.setAttribute('aria-disabled', 'true');
    el.dataset.index = String(i);
    el.textContent = opt.label || opt.textContent;
    el.title = el.textContent;
    return el;
  }

  function buildList(sel, list) {
    let i = 0;
    for (const child of sel.children) {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.className = 'sel-group';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', child.label);
        const head = document.createElement('div');
        head.className = 'sel-group-label';
        head.textContent = child.label;
        group.append(head);
        for (const opt of child.children) if (opt.tagName === 'OPTION') group.append(optionEl(opt, i++));
        list.append(group);
      } else if (child.tagName === 'OPTION') list.append(optionEl(child, i++));
    }
  }

  // sized here (the select's width, as tall as the larger free side allows), placed by the app's
  // popover rule (run-list.js placePopover: under the select, flipped above it, kept in the window)
  function place() {
    const r = open.sel.getBoundingClientRect();
    const box = open.box;
    const vh = document.documentElement.clientHeight;
    box.style.width = `${Math.max(r.width, 220)}px`;
    box.style.maxHeight = `${Math.max(120, Math.min(360, Math.max(vh - r.bottom, r.top) - 14))}px`;
    root.placePopover?.(box, open.sel);
  }

  function filter() {
    const q = open.search.value;
    for (const el of items()) el.hidden = !root.SelectSearch.matchOption(el.textContent, q);
    for (const g of open.list.querySelectorAll('[role=group]')) g.hidden = !g.querySelector('[role=option]:not([hidden])');
    open.empty.hidden = pickable().length > 0;
    setActive(pickable()[0] || null);
  }

  function close({ focus = true } = {}) {
    if (!open) return;
    const { sel, box } = open;
    open = null;
    if (box.hidePopover && box.matches(':popover-open')) box.hidePopover();
    box.remove();
    sel.setAttribute('aria-expanded', 'false');
    if (focus) sel.focus({ preventScroll: true });
  }

  function pick(el) {
    const sel = open.sel;
    const opt = sel.options[Number(el.dataset.index)];
    close();
    if (!opt || opt.disabled || sel.value === opt.value && opt.selected) return;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function show(sel) {
    close({ focus: false });
    const box = document.createElement('div');
    box.className = 'sel-popover';
    box.dataset.testid = 'select-popover';
    if (box.showPopover) box.setAttribute('popover', 'manual');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'sel-search';
    search.dataset.testid = 'select-search';
    search.placeholder = t('select.search');
    search.setAttribute('aria-label', t('select.search_value', { value: sel.getAttribute('aria-label') || 'the options' }));
    search.setAttribute('aria-controls', 'sel-listbox');
    search.autocomplete = 'off';
    const list = document.createElement('div');
    list.className = 'sel-list';
    list.id = 'sel-listbox';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', sel.getAttribute('aria-label') || t('select.options'));
    const empty = document.createElement('div');
    empty.className = 'sel-empty small muted';
    empty.textContent = t('select.no_option_matches_the_search');
    empty.hidden = true;
    box.append(search, list, empty);
    buildList(sel, list);
    open = { sel, box, search, list, empty };
    // in the select's theme: a 3D view (.r3d, light or dark) lends its own colours to the app's tokens
    const r3d = sel.closest('.r3d');
    if (r3d) {
      const cs = getComputedStyle(r3d);
      const tokens = { '--accent': '--r3d-accent', '--border': '--r3d-line', '--muted': '--r3d-muted', '--panel': '--r3d-tint', '--panel-2': '--r3d-soft', '--text': '--r3d-ink' };
      for (const [app, own] of Object.entries(tokens)) box.style.setProperty(app, cs.getPropertyValue(own));
      box.style.colorScheme = cs.colorScheme;
    }
    document.body.append(box);
    if (box.showPopover) box.showPopover();
    sel.setAttribute('aria-expanded', 'true');
    place();
    search.focus({ preventScroll: true });
    const current = items().find((el) => el.getAttribute('aria-selected') === 'true');
    setActive(current && current.getAttribute('aria-disabled') !== 'true' ? current : pickable()[0] || null);
    search.addEventListener('input', filter);
    search.addEventListener('keydown', onSearchKey);
    list.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the search focused
    list.addEventListener('click', (e) => {
      const el = e.target.closest('[role=option]');
      if (el && el.getAttribute('aria-disabled') !== 'true') pick(el);
    });
  }

  function onSearchKey(e) {
    const all = pickable();
    const at = all.indexOf(open.list.querySelector('.active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(all[Math.max(0, Math.min(all.length - 1, at + step))] || null);
    } else if ((e.key === 'Home' || e.key === 'End') && !open.search.value) {
      e.preventDefault();
      setActive(e.key === 'Home' ? all[0] : all[all.length - 1]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (all[at]) pick(all[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close();
  }

  if (typeof document !== 'undefined' && typeof HTMLSelectElement !== 'undefined') {
    document.addEventListener('mousedown', (e) => {
      if (open && !open.box.contains(e.target) && e.target !== open.sel) close({ focus: false });
      const sel = e.target.closest?.('select');
      if (e.button !== 0 || !searchable(sel)) return;
      e.preventDefault(); // no native list
      if (open?.sel === sel) { close(); return; }
      sel.focus({ preventScroll: true });
      show(sel);
    }, true);
    document.addEventListener('click', (e) => { if (searchable(e.target.closest?.('select'))) e.preventDefault(); }, true);
    document.addEventListener('keydown', (e) => {
      const sel = e.target;
      if (!searchable(sel) || open?.sel === sel) return;
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        show(sel);
      }
    }, true);
    // the list follows nothing that moves: it closes
    window.addEventListener('scroll', (e) => { if (open && !open.box.contains(e.target)) close({ focus: false }); }, true);
    window.addEventListener('resize', () => close({ focus: false }));
    window.addEventListener('blur', () => close({ focus: false }));
  }

  const api = {
    markup,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Select = api;
})(typeof window !== 'undefined' ? window : globalThis);
