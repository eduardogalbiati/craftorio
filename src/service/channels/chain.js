// Workflow chaining (#134, src/service/areas/chain.js): a run's chain for the Run screen, edit or
// cancel it while the run goes, resume or drop a paused one, and the rough cost of a chain before it
// starts (an estimate).

module.exports = (ctx) => [
  // { then, from, state, reason, nextRunId } of a run, null without a chain (the Run screen's chain banner)
  { channel: 'chain:get', method: 'runChain', params: ['runId'], fn: (opts) => ctx.runChain(opts) },
  // then: the new chain (chain-model normalizeThen), null to cancel it
  { channel: 'chain:set', method: 'setRunChain', params: ['runId', 'then'], fn: (opts) => ctx.setRunChain(opts) },
  { channel: 'chain:resume', method: 'resumeChain', params: ['runId'], fn: (opts) => ctx.resumeChain(opts) },
  { channel: 'chain:drop', method: 'dropChain', params: ['runId'], fn: (opts) => ctx.dropChain(opts) },
  // file: the first workflow; then: the chain after it → { items, costUsd, complete, text }
  { channel: 'chain:estimate', method: 'chainEstimate', params: ['file', 'then'], fn: (opts) => ctx.chainEstimate(opts) },
];
