// The menu's groups (#254): the sidebar follows the flow from an idea to a release (Plan & Design,
// Code & Build, Workflows, AI). A view's `nav` entry names its group (`group: 'code'`); an entry
// without one stands alone (Home, Night watch, Settings; Analytics is a tab of Home, #255). Everything sits by `order`: a
// group at its own, its entries by theirs inside it. A group folds, and the choice is remembered.
// No DOM here: view-registry.js draws the groups; a test feeds navLayout the views' entries.
// load: early (view-registry.js reads the groups when the views register)
// Browser: window.NavGroups; Node: module.exports.
(function (root) {
  const GROUPS = [
    { id: 'plan', title: 'Plan & Design', order: 30 },
    { id: 'code', title: 'Code & Build', order: 40 },
    { id: 'workflows', title: 'Workflows', order: 60 },
    { id: 'ai', title: 'AI', order: 70 },
  ];
  const COLLAPSED_KEY = 'multiagent.navCollapsed';
  const byOrder = (a, b) => a.order - b.order;

  /** The menu, top to bottom: a block per group that has entries (`{ group, title, order, items }`) and per entry without a group (`{ group: null, order, items: [entry] }`). */
  function navLayout(entries) {
    const groups = GROUPS.map((g) => ({ group: g.id, title: g.title, order: g.order, items: entries.filter((e) => e.group === g.id).sort(byOrder) }))
      .filter((b) => b.items.length);
    const alone = entries.filter((e) => !GROUPS.some((g) => g.id === e.group)).map((e) => ({ group: null, order: e.order, items: [e] }));
    return [...groups, ...alone].sort(byOrder);
  }

  // the ids of the folded groups, read each time: another window may have changed them
  function collapsed(storage) {
    try {
      const ids = JSON.parse(storage.getItem(COLLAPSED_KEY) || '[]');
      return Array.isArray(ids) ? ids : [];
    } catch { return []; }
  }

  /** True when the group is folded. */
  const isCollapsed = (groupId, storage) => collapsed(storage).includes(groupId);

  /** Folds or unfolds a group, remembered in `storage`. */
  function setCollapsed(groupId, on, storage) {
    const ids = collapsed(storage).filter((id) => id !== groupId);
    if (on) ids.push(groupId);
    try { storage.setItem(COLLAPSED_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
  }

  const api = { GROUPS, isCollapsed, navLayout, setCollapsed };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NavGroups = api;
})(typeof window !== 'undefined' ? window : globalThis);
