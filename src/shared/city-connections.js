// The most connected files of the project city (#382): the ranking behind the City view's
// connections panel (src/renderer/views/project/project-city-connections.js), from the layout's
// file edges (src/shared/city-layout.js layoutCity → edges, #371's model). Pure and deterministic.
// - rank(layout, { limit, query }) → [{ path, requires, requiredBy, total }]: every drawn file with
//   at least one edge, its outgoing (requires) and incoming (required by) counts, the most connected
//   first (then the most required, then by path), the first `limit` (RANK_LIMIT), those whose path
//   contains `query` (case-insensitive) when one is given.
// - edgesState(model) → { ok: true } or { ok: false, reason }: whether the city has file edges at
//   all (a language whose imports are not read has none: the panel says so instead of an empty list).
// Browser: window.CityConnections; Node: module.exports.
(function (root) {
  const RANK_LIMIT = 30;
  const arr = (x) => (Array.isArray(x) ? x : []);
  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /** The files with the most connections, see the header. */
  function rank(layout, { limit = RANK_LIMIT, query = '' } = {}) {
    const counts = new Map();
    const of = (p) => counts.get(p) || counts.set(p, { path: p, requires: 0, requiredBy: 0 }).get(p);
    for (const e of arr(layout && layout.edges)) {
      if (e.kind !== 'file') continue;
      of(e.from).requires++;
      of(e.to).requiredBy++;
    }
    const q = String(query || '').trim().toLowerCase();
    return [...counts.values()]
      .filter((c) => !q || c.path.toLowerCase().includes(q))
      .map((c) => ({ ...c, total: c.requires + c.requiredBy }))
      .sort((a, b) => b.total - a.total || b.requiredBy - a.requiredBy || byString(a.path, b.path))
      .slice(0, Math.max(0, limit));
  }

  /** Whether the model has file edges to rank. */
  function edgesState(model) {
    const edges = model && model.edges;
    if (typeof edges === 'string') return { ok: false, reason: edges };
    if (!arr(edges).some((e) => e.kind === 'file')) return { ok: false, reason: 'no import between the drawn files was found' };
    return { ok: true };
  }

  const api = { edgesState, rank, RANK_LIMIT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityConnections = api;
})(typeof window !== 'undefined' ? window : globalThis);
