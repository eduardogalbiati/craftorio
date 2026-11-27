// What a session and a run cost (#72): the one rule behind the run list, the Run screen, the roadmap,
// the header and Usage, so a run has one total everywhere. Pure, for node and the renderer.
// - A session counts what was recorded: its cost_usd plus, for its turns on a model the CLI does not
//   know and the app had no price for (#369: cost_estimate `source: 'unknown'`), the CLI's own figure.
//   That figure is at another model's rates, so the total is `approx` (drawn "≈"), never a zero.
//   What was recorded stays: a price added after the run does not change it.
// - A session with nothing recorded (Codex) is priced from its tokens (the user's price, else the
//   adapter's table); without a price it counts nothing and the total is `approx` too.
// - #117: a session or turn whose cost the app does not know at all reads "unknown", never $0.00; a
//   total that misses such a cost is `partial`.
// sessionCost(s, prices) → US$ or null; runCost(sessions, prices) → { usd, approx, unknown, partial },
// totalMarks(usd, missing) → { unknown, partial } (the chat and the 3D view's totals use it too),
// `prices` null: only what was recorded; tokenPricedUsd(sessions, prices): what the prices add to that;
// turnCost(ev, prices, model) → { usd, approx, unknown? }: the same rule on one turn's event,
// turnResult(ev, prices, model) → { cost, unknown? }: a turn's cost for the Run screen. Sessions
// come as snapshots (cost_usd, cost_estimate) or as the lists' views (costUsd, costEstimate).
// Browser: window.SessionCost; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const registry = () => (node ? require('./providers') : root.Providers);
  const sessionCache = () => (node ? require('./session-cache') : root.SessionCache);

  // reasoning is already counted inside output, so it is not added to the total
  const totalTokens = (t) => (t ? (t.input || 0) + (t.output || 0) + (t.cache_read || 0) + (t.cache_write || 0) : 0);

  // A model's price (US$ per million tokens): settings.prices, else the price table of a CLI adapter (#369)
  function priceOf(model, prices = {}) {
    return prices[model] || registry().clis().find((a) => a.prices?.[model])?.prices[model] || null;
  }

  // What tokens cost at `price`: input, output, cache reads, and cache writes at the cache's lifetime
  // (session-cache.js cacheWriteUsd: 1.25× input for 5 minutes, 2× for an hour, unless the price sets it)
  function tokensCost(t = {}, price, lifetimeMs) {
    const base = (t.input || 0) * (price.input || 0) + (t.output || 0) * (price.output || 0) + (t.cache_read || 0) * (price.cache_read ?? price.input ?? 0);
    return base / 1e6 + (sessionCache().cacheWriteUsd(t.cache_write, price, lifetimeMs) || 0);
  }

  // The CLI's figure of the turns with no price in a session's cost_estimate, null without such a turn.
  // Records from before #72 have no unknown_cli_usd: the whole figure, when the last turn was one.
  function unknownUsd(estimate) {
    if (estimate?.unknown_cli_usd != null) return Number(estimate.unknown_cli_usd) || 0;
    return estimate?.source === 'unknown' ? Number(estimate.cli_cost_usd) || 0 : null;
  }

  const unknownOf = (s) => unknownUsd(s.cost_estimate || s.costEstimate);
  const recordedCost = (s) => (Number(s.cost_usd ?? s.costUsd) || 0) + (unknownOf(s) || 0) || null;

  function sessionCost(s, prices = {}) {
    const recorded = recordedCost(s);
    if (recorded != null || !prices) return recorded;
    const price = priceOf(s.model, prices);
    return price ? tokensCost(s.tokens || {}, price, s.cache_lifetime_ms ?? s.cacheLifetimeMs) : null;
  }

  // Whether `s` has a cost the app does not know: an unknown turn, or tokens with no cost at all
  function isApprox(s, prices = {}) {
    if (s.provider === 'mock') return false;
    return unknownOf(s) != null || (sessionCost(s, prices) == null && totalTokens(s.tokens) > 0);
  }

  // #117: a session whose cost the app does not know at all (unpriced tokens, a Codex turn on a ChatGPT
  // account, or an unknown turn with no CLI figure): drawn "unknown"
  const unpriced = (s, prices = {}) => isApprox(s, prices) && !sessionCost(s, prices);

  // #117: a total's marks when some of its costs are `missing`: `unknown` with nothing priced (drawn
  // "unknown", never $0.00), `partial` when the total misses such a cost. The one rule of every screen.
  const totalMarks = (usd, missing) => ({ unknown: !!missing && !usd, partial: !!missing && !!usd });

  // { usd, approx, unknown, partial }: the marks of totalMarks over the sessions with unpriced tokens
  function runCost(sessions, /** @type {Record<string, any> | null} */ prices = {}) {
    const list = sessions || [];
    const usd = list.reduce((a, s) => a + (sessionCost(s, prices) || 0), 0);
    return { usd, approx: list.some((s) => isApprox(s, prices)), ...totalMarks(usd, list.some((s) => unpriced(s, prices))) };
  }

  const tokenPricedUsd = (sessions, prices = {}) => runCost(sessions, prices).usd - runCost(sessions, null).usd;

  // A turn's event (session.message_received): { usd, approx, unknown }; #117: a turn with no cost
  // recorded (cost_usd null, a Codex turn) is priced from its tokens when its model has a price
  // (`prices`, else the adapter's table), else it is unknown, never $0.00
  function turnCost(ev, prices = {}, model = ev.session?.model) {
    const unknown = ev.cost_usd == null && ev.cost_source === 'unknown';
    const none = ev.cost_usd === null && !ev.cost_source && !ev.cost_not_recorded && ev.session?.provider !== 'mock';
    const price = none && prices && model ? priceOf(model, prices) : null;
    if (price) return { usd: tokensCost(ev.usage || {}, price), approx: false };
    return { usd: Number(unknown ? ev.cli_cost_usd : ev.cost_usd) || 0, approx: unknown || none, ...(none ? { unknown: true } : {}) };
  }

  // The Run screen's turn result: { cost, unknown? }; the recorded cost, else the turn priced by
  // turnCost; an unknown turn (cost_source unknown, or no price) has cost null and the unknown mark
  function turnResult(ev, prices = {}, model = ev.session?.model) {
    const unknown = ev.cost_source === 'unknown' || !!turnCost(ev, prices, model).unknown;
    return { cost: ev.cost_usd ?? (unknown ? null : turnCost(ev, prices, model).usd), ...(unknown ? { unknown: true } : {}) };
  }

  const api = {
    isApprox,
    priceOf,
    runCost,
    sessionCost,
    tokenPricedUsd,
    tokensCost,
    totalMarks,
    totalTokens,
    turnCost,
    turnResult,
    unknownUsd,
  };
  if (node) module.exports = api;
  else root.SessionCost = api;
})(typeof window !== 'undefined' ? window : globalThis);
