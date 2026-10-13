// Analytics screen: tokens and session metrics of a date range, and the supervisor's report on them;
// the Repository performance tab (#159) and its "Ask for a plan" (#197); the Run tab (#228); the 24/7
// tab and the top bar chip (#188, `summary: true`); the Agents tab (#280): { from, to } → the Oracle's,
// the Product Owner's and the Supervisor chat's totals, days and sessions.

const {
  OBJECT,
  OPTIONS,
} = require('../schemas');

// each tab's options ({ from, to, projectId, runId, summary, ... }; none: the defaults) → its snapshot
const TAB = { params: OPTIONS, result: OBJECT };

module.exports = (ctx) => [
  { channel: 'analytics:get', method: 'getAnalytics', params: 'opts', schema: TAB, fn: (opts) => ctx.analyticsSnapshot(opts || {}) },
  { channel: 'analytics:analyze', method: 'analyzeAnalytics', params: 'opts', schema: TAB, fn: (opts) => ctx.analyzeAnalytics(opts || {}) },
  { channel: 'analytics:performance', method: 'getRepositoryPerformance', params: 'opts', schema: TAB, fn: (opts) => ctx.repositoryPerformance(opts || {}) },
  { channel: 'analytics:plan', method: 'askPerformancePlan', params: 'opts', schema: TAB, fn: (opts) => ctx.performancePlan(opts || {}) },
  { channel: 'analytics:run', method: 'getRunAnalysis', params: 'opts', schema: TAB, fn: (opts) => ctx.runAnalysis(opts || {}) },
  { channel: 'analytics:occupancy', method: 'getOccupancy', params: 'opts', schema: TAB, fn: (opts) => ctx.occupancySnapshot(opts || {}) },
  { channel: 'analytics:agents', method: 'getAgentsAnalytics', params: 'opts', schema: TAB, fn: (opts) => ctx.agentsSnapshot(opts || {}) },
];
