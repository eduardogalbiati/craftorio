// #312 (acceptance tests, written before the code): what each CLI adapter knows about accounts and
// usage limits. A run that waits for credits (test/provider-accounts-312.test.js) waits until the
// reset time the CLI printed, when it printed one; an account is a CLI config folder, given to the
// CLI through its config-folder variable.
//
// Interface assumed (decided for #312):
// - `quotaResetAt(type, message, now)` exported by src/engine/providers.js (next to isQuotaError):
//   the epoch ms the limit resets at, read from that CLI's message, or null. `now`: epoch ms or a
//   Date, the moment the message was read (a clock time without a date is its next occurrence).
// - each CLI adapter (src/shared/providers, registry().resolve(id)) has `quotaReset(message, now)`
//   next to quotaPattern, and `configDirEnv`: claude 'CLAUDE_CONFIG_DIR', codex 'CODEX_HOME',
//   grok null (no known variable).
// - `accountEnv(type, account)` exported by src/engine/providers.js: { [configDirEnv]: account.dir },
//   {} for no account or a CLI without a variable.
// Times are local (new Date(y, m, d, h, min)), so the cases hold on any machine's time zone.
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = () => require('../src/shared/providers');
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('#312 quotaResetAt reads Claude\'s epoch from "usage limit reached|<epoch>"', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  assert.equal(typeof quotaResetAt, 'function');
  assert.equal(quotaResetAt('claude-code', 'Claude AI usage limit reached|1760227200', local(2025, 10, 11, 10)), 1760227200000);
});

test('#312 quotaResetAt reads Claude\'s "resets 3pm" as today 15:00 local', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  assert.equal(quotaResetAt('claude-code', '5-hour limit reached ∙ resets 3pm', local(2026, 10, 22, 10)), local(2026, 10, 22, 15));
});

test('#312 quotaResetAt reads Codex\'s "try again at Oct 26th." as a time on Oct 26 (local)', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  const now = local(2026, 10, 8, 10);
  const msg = "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again at Oct 26th.";
  const at = quotaResetAt('codex-cli', msg, now);
  assert.equal(typeof at, 'number', `a time: ${at}`);
  const d = new Date(at);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 10, 26]);
  assert.equal(at > now, true);
});

test('#312 quotaResetAt reads Codex\'s "try again at 3:15 PM." as today 15:15 local', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  const msg = "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again at 3:15 PM.";
  assert.equal(quotaResetAt('codex-cli', msg, local(2026, 10, 22, 10)), local(2026, 10, 22, 15, 15));
});

test('#312 Grok\'s free usage-limit message is a quota error with no reset time', () => {
  const { isQuotaError, quotaResetAt } = require('../src/engine/providers');
  const msg = "You've reached your free Grok Build usage limit";
  assert.equal(isQuotaError('grok-cli', msg), true);
  assert.equal(quotaResetAt('grok-cli', msg, local(2026, 10, 22, 10)), null);
});

test('#312 quotaResetAt is null for a message with no time, for each CLI', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  const now = local(2026, 10, 22, 10);
  const cases = [
    ['claude-code', 'Credit balance is too low'],
    ['codex-cli', "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again later."],
    ['codex-cli', 'Quota exceeded. Check your plan and billing details.'],
    ['grok-cli', 'Your team has either used all available credits or reached its monthly spending limit.'],
  ];
  const wrong = cases.filter(([type, m]) => quotaResetAt(type, m, now) !== null).map(([type, m]) => `${type}: ${m}`);
  assert.deepEqual(wrong, []);
});

test('#312 each CLI adapter has quotaReset(message, now) next to quotaPattern, used by quotaResetAt', () => {
  const { quotaResetAt } = require('../src/engine/providers');
  const now = local(2026, 10, 22, 10);
  for (const id of ['claude', 'codex', 'grok']) {
    const a = registry().resolve(id);
    assert.equal(typeof a.quotaReset, 'function', `${id}.quotaReset`);
    assert.equal(a.quotaReset(a.usageLimitMessage, now) ?? null, quotaResetAt(a.type, a.usageLimitMessage, now) ?? null, id);
  }
  assert.equal(registry().resolve('claude').quotaReset('Claude AI usage limit reached|1760227200', now), 1760227200000);
});

test('#312 each CLI adapter names its config-folder variable (configDirEnv)', () => {
  const { resolve } = registry();
  assert.equal(resolve('claude').configDirEnv, 'CLAUDE_CONFIG_DIR');
  assert.equal(resolve('codex').configDirEnv, 'CODEX_HOME');
  assert.equal(resolve('grok').configDirEnv ?? null, null);
});

test('#312 accountEnv gives the CLI its account folder through its variable, nothing else', () => {
  const { accountEnv } = require('../src/engine/providers');
  assert.equal(typeof accountEnv, 'function');
  const acc = { name: 'Claude B', dir: 'C:/accounts/claude-b-312' };
  assert.deepEqual(accountEnv('claude-code', acc), { CLAUDE_CONFIG_DIR: 'C:/accounts/claude-b-312' });
  assert.deepEqual(accountEnv('codex-cli', { name: 'Codex B', dir: 'C:/accounts/codex-b-312' }), { CODEX_HOME: 'C:/accounts/codex-b-312' });
  assert.deepEqual(accountEnv('grok-cli', { name: 'Grok B', dir: 'C:/accounts/grok-b-312' }), {});
  assert.deepEqual(accountEnv('claude-code', null), {});
  assert.deepEqual(accountEnv('claude-code', undefined), {});
});

// Guard (may already be green): cli-config-dirs keeps following the CLIs' variables once it reads
// their names from the adapters.
test('#312 cliConfigDirs follows CODEX_HOME when it is set', (t) => {
  const saved = process.env.CODEX_HOME;
  t.after(() => { if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved; });
  process.env.CODEX_HOME = 'C:/accounts/codex-home-312';
  const { cliConfigDirs } = require('../src/domains/cli/cli-config-dirs');
  assert.equal(cliConfigDirs().codex, 'C:/accounts/codex-home-312');
});
