// Analytics screen: tokens and session metrics of a date range, and the supervisor's report on them;
// the Repository performance tab (#159) and its "Ask for a plan" (#197); the Run tab (#228); the 24/7
// tab and the top bar chip (#188, `summary: true`).

module.exports = (ctx) => [
  { channel: 'analytics:get', method: 'getAnalytics', params: 'opts', fn: (opts) => ctx.analyticsSnapshot(opts || {}) },
  { channel: 'analytics:analyze', method: 'analyzeAnalytics', params: 'opts', fn: (opts) => ctx.analyzeAnalytics(opts || {}) },
  { channel: 'analytics:performance', method: 'getRepositoryPerformance', params: 'opts', fn: (opts) => ctx.repositoryPerformance(opts || {}) },
  { channel: 'analytics:plan', method: 'askPerformancePlan', params: 'opts', fn: (opts) => ctx.performancePlan(opts || {}) },
  { channel: 'analytics:run', method: 'getRunAnalysis', params: 'opts', fn: (opts) => ctx.runAnalysis(opts || {}) },
  { channel: 'analytics:occupancy', method: 'getOccupancy', params: 'opts', fn: (opts) => ctx.occupancySnapshot(opts || {}) },
];
