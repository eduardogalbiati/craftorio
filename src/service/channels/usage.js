// Usage screen: tokens and cost per provider, budgets, model prices and GitHub Actions minutes.

const actionsUsage = require('../../domains/usage/actions-usage');
const workspace = require('../../domains/workspace/workspace');
const { requireText } = require('../common');
const {
  ANY,
  args,
  FLAG,
  nullable,
  OBJECT,
  STRING,
  text,
} = require('../schemas');

// scope: which budgets (the day's or the night's, src/service/areas/usage.js); none: the default
const SCOPE = nullable(STRING);

module.exports = (ctx) => [
  { channel: 'usage:get', method: 'getUsage', params: ['scope'], schema: { params: args({ scope: SCOPE }), result: OBJECT }, fn: (opts) => ctx.usageSnapshot(opts?.scope) },
  {
    channel: 'usage:setBudget',
    method: 'setBudget',
    params: ['provider', 'budget', 'scope'],
    schema: { params: args({ provider: text(100), budget: ANY, scope: SCOPE }, ['provider']), result: OBJECT },
    fn: (opts) => ctx.setBudget({ ...opts, provider: requireText(opts.provider, 'provider', 100) }),
  },
  { channel: 'usage:setPrice', method: 'setPrice', params: ['model', 'price', 'scope'], schema: { params: args({ model: STRING, price: ANY, scope: SCOPE }), result: OBJECT }, fn: (opts) => ctx.setPrice(opts) },
  // GitHub Actions minutes of the month vs the included quota (needs gh's `user` scope)
  {
    channel: 'usage:actions',
    method: 'getActionsUsage',
    params: ['force'],
    schema: { params: args({ force: FLAG }), result: OBJECT },
    fn: (opts) => {
      const settings = workspace.readSettings(ctx.ws);
      // #273: the month and its reset are the owner's local ones
      return actionsUsage.getActionsUsage({ includedMinutes: +settings.actionsIncludedMinutes || 0, force: !!opts?.force, timeZone: settings.timeZone });
    },
  },
];
