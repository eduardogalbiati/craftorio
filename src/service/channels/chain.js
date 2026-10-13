// Workflow chaining (#134, src/service/areas/chain.js): a run's chain for the Run screen, edit or
// cancel it while the run goes, resume or drop a paused one, and the rough cost of a chain before it
// starts (an estimate).

const {
  ANY,
  args,
  nullable,
  OBJECT,
  RUN_ID,
  shape,
  WORKFLOW_FILE,
} = require('../schemas');

const ON_RUN = args({ runId: RUN_ID }, ['runId']);
// the run's chain after a change (null: none, or it could not be written)
const CHAIN = shape({ chain: nullable(OBJECT) }, ['chain']);

module.exports = (ctx) => [
  // { then, from, state, reason, nextRunId } of a run, null without a chain (the Run screen's chain banner)
  { channel: 'chain:get', method: 'runChain', params: ['runId'], schema: { params: ON_RUN, result: nullable(OBJECT) }, fn: (opts) => ctx.runChain(opts) },
  // then: the new chain (chain-model normalizeThen), null to cancel it
  { channel: 'chain:set', method: 'setRunChain', params: ['runId', 'then'], schema: { params: args({ runId: RUN_ID, then: ANY }, ['runId']), result: CHAIN }, fn: (opts) => ctx.setRunChain(opts) },
  { channel: 'chain:resume', method: 'resumeChain', params: ['runId'], schema: { params: ON_RUN, result: nullable(OBJECT) }, fn: (opts) => ctx.resumeChain(opts) },
  { channel: 'chain:drop', method: 'dropChain', params: ['runId'], schema: { params: ON_RUN, result: CHAIN }, fn: (opts) => ctx.dropChain(opts) },
  // file: the first workflow; then: the chain after it → { items, costUsd, complete, text }
  { channel: 'chain:estimate', method: 'chainEstimate', params: ['file', 'then'], schema: { params: args({ file: WORKFLOW_FILE, then: ANY }), result: OBJECT }, fn: (opts) => ctx.chainEstimate(opts) },
];
