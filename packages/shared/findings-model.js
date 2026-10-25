// Findings button (#361), the renderer's model: where the button shows, its shortcut, and what a
// numbered pin resolves to (the element under it). The overlay is src/renderer/findings.js.
// - SHORTCUT, isShortcut(event): Ctrl+Shift+F opens the findings;
// - buttonVisible({ isPackaged, settings, screenshot }): shown from source (npm start) or with
//   Settings › General › "Findings button" on; never in a scripts/screenshot.js capture unless the
//   setting asks for it;
// - resolvePin(target, { x, y, view, tab }): the element under a pin as plain data (its data-testid
//   or its nearest ancestor's, the ids it carries from data-run/-step/-stage/-item/-issue/-session,
//   the nearest winning, and the rounded box); a pin on empty space says so ({ empty: true });
// - remember(list, entry, cap): appends to a ring buffer of the last `cap` entries (UI actions,
//   service calls).
// Browser: window.FindingsModel; Node: module.exports (packages/engine/service/areas/findings.js, the tests).
(function (root) {
  const SHORTCUT = 'Ctrl+Shift+F';
  const ID_KEYS = ['run', 'step', 'stage', 'item', 'issue', 'session'];

  const isShortcut = (e) => Boolean(e && e.ctrlKey && e.shiftKey && !e.altKey && String(e.key || '').toLowerCase() === 'f');

  function buttonVisible({ isPackaged, settings, screenshot } = {}) {
    if (settings && settings.findingsButton === true) return true;
    if (screenshot) return false;
    return isPackaged === false;
  }

  const isEmptySpace = (el) => !el || el.nodeType !== 1 || el.localName === 'body' || el.localName === 'html';

  const roundBox = (r) => ({ x: Math.round(r.x ?? r.left), y: Math.round(r.y ?? r.top), width: Math.round(r.width), height: Math.round(r.height) });

  function resolvePin(target, { x, y, view = null, tab = null } = {}) {
    const el = target && target.nodeType === 3 ? target.parentElement : target;
    if (isEmptySpace(el)) return { empty: true, x, y, view, tab, testid: null };
    const ids = {};
    let carrier = null;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (!carrier && cur.getAttribute('data-testid')) carrier = cur;
      for (const key of ID_KEYS) {
        const value = cur.getAttribute(`data-${key}`);
        if (!(key in ids) && value != null && value !== '') ids[key] = String(value);
      }
    }
    const boxed = carrier || el;
    const box = typeof boxed.getBoundingClientRect === 'function' ? roundBox(boxed.getBoundingClientRect()) : null;
    return { empty: false, x, y, testid: carrier ? carrier.getAttribute('data-testid') : null, view, tab, ids, box };
  }

  function remember(list, entry, cap = 50) {
    list.push(entry);
    if (list.length > cap) list.splice(0, list.length - cap);
    return list;
  }

  const api = { ID_KEYS, SHORTCUT, buttonVisible, isShortcut, remember, resolvePin };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FindingsModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
