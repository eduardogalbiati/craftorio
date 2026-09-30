// Usage screen: tokens and cost per provider, budgets, model prices and GitHub Actions minutes.

const actionsUsage = require('../../actions-usage');
const workspace = require('../../workspace');

module.exports = (ctx) => [
  { channel: 'usage:get', method: 'getUsage', params: ['scope'], fn: (opts) => ctx.usageSnapshot(opts?.scope) },
  { channel: 'usage:setBudget', method: 'setBudget', params: ['provider', 'budget', 'scope'], fn: (opts) => ctx.setBudget(opts) },
  { channel: 'usage:setPrice', method: 'setPrice', params: ['model', 'price', 'scope'], fn: (opts) => ctx.setPrice(opts) },
  // GitHub Actions minutes of the month vs the included quota (needs gh's `user` scope)
  {
    channel: 'usage:actions',
    method: 'getActionsUsage',
    params: ['force'],
    fn: (opts) => actionsUsage.getActionsUsage({ includedMinutes: +workspace.readSettings(ctx.ws).actionsIncludedMinutes || 0, force: !!opts?.force }),
  },
];
