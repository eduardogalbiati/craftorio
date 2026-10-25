// An estimate against what really happened (#215), the same rules wherever it shows: the roadmap's
// items and stages (backlog-roadmap.js) and the Product Owner's proposals (backlog-po.js).
// - formatMinutes(n): a duration in minutes as the cards show it ("58 min", "1 h 45 min").
// - verdict(actual, estimate): { level, percent, diff, sign }: level 'good' at or below the estimate,
//   'warn' up to WARN_OVER above it, 'bad' beyond; percent the rounded difference in % (signed); diff
//   the signed difference in the value's unit (cents); sign an arrow (▲ over, ▼ under, = equal), so
//   the colour is never the only signal. null without an estimate.
// Browser: window.Estimates; Node: module.exports.
(function (root) {
  const WARN_OVER = 0.25;

  /** A duration in minutes: "58 min" under an hour, "1 h 45 min" (or "2 h") above. */
  function formatMinutes(n) {
    const m = Math.max(0, Math.round(Number(n) || 0));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  }

  function verdict(actual, estimate) {
    const est = Number(estimate);
    if (actual == null || !Number.isFinite(est) || est <= 0) return null;
    const real = Number(actual) || 0;
    const delta = real - est;
    const level = delta <= 0 ? 'good' : delta <= est * WARN_OVER + 1e-9 ? 'warn' : 'bad';
    return {
      level,
      percent: Math.round((delta / est) * 100),
      diff: Math.round(delta * 100) / 100,
      sign: delta > 0 ? '▲' : delta < 0 ? '▼' : '=',
    };
  }

  const api = {
    formatMinutes,
    verdict,
    WARN_OVER,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Estimates = api;
})(typeof window !== 'undefined' ? window : globalThis);
