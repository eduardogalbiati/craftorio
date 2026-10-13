// The provider registry (#348): the adapters of claude.js, codex.js, grok.js and mock.js, one per
// CLI (and the simulated provider). It is the only place that maps between the two vocabularies of
// the code base: a CLI name or adapter id ('claude') and a provider type (the workflow YAML's
// `providers.<name>.type`). An adapter: { id, type, cli, label, short, models, modelPrefixes,
// imageInput, ... } and, for a CLI, its workflow provider `definition`, `resumeArgs(sessionId)`,
// `isolationArgs`, the stream parser `parse(event, emit, acc)` (with `parse.flush` when it buffers),
// `quotaPattern` and `usageLimitMessage`. Adding a provider: one adapter file and its lines below
// (its require, and its window global for the renderer).
// - list() → the adapters; clis() → those that are a CLI;
// - resolve(key) → the adapter of an id, a type, a CLI name or a model name (its modelPrefixes), or null;
// - byId(id), byType(type) → the adapter with exactly that id or type, or null.
// Browser (index.js loads after the adapters): window.Providers; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const ADAPTERS = node
    ? [
      require('./claude'),
      require('./codex'),
      require('./grok'),
      require('./mock'),
    ]
    : [
      root.ProviderClaude,
      root.ProviderCodex,
      root.ProviderGrok,
      root.ProviderMock,
    ];

  const list = () => [...ADAPTERS];
  const clis = () => ADAPTERS.filter((a) => a.cli);
  const byId = (id) => ADAPTERS.find((a) => a.id === id) || null;
  const byType = (type) => ADAPTERS.find((a) => a.type === type) || null;

  function resolve(key) {
    const k = String(key ?? '').trim().toLowerCase();
    if (!k) return null;
    return byId(k) || byType(k) || ADAPTERS.find((a) => a.cli && a.cli === k)
      || ADAPTERS.find((a) => a.modelPrefixes.some((re) => re.test(k))) || null;
  }

  const api = {
    byId,
    byType,
    clis,
    list,
    resolve,
  };
  if (node) module.exports = api;
  else root.Providers = api;
})(typeof window !== 'undefined' ? window : globalThis);
