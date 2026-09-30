// Analytics screen: tokens and session metrics of a date range, and the supervisor's report on them.

module.exports = (ctx) => [
  { channel: 'analytics:get', method: 'getAnalytics', params: 'opts', fn: (opts) => ctx.analyticsSnapshot(opts || {}) },
  { channel: 'analytics:analyze', method: 'analyzeAnalytics', params: 'opts', fn: (opts) => ctx.analyzeAnalytics(opts || {}) },
];
