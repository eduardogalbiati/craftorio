// GitHub Actions minutes of the month, against the account's included quota (private repositories:
// GitHub Free includes 2,000 minutes; Windows minutes count x2, macOS x10). When the quota runs out
// with a $0 spending limit, Actions stop until the month resets: the Usage screen warns at 80%, and
// the `pr_checks` probe (packages/engine/engine/probes.js) reports the exhaustion instead of waiting for checks
// that never start.
//
// Source: `gh api users/<login>/settings/billing/usage`, which needs the `user` scope
// (`gh auth refresh -s user`). Without it the monitor is simply unavailable.

const { execCli } = require('../backlog/backlog');
const TimeZone = require('../analytics/time-zone');
const { WARN_AT } = require('./usage');

const DEFAULT_INCLUDED_MINUTES = 2000;
const CACHE_MS = 10 * 60 * 1000;
const SCOPE_HINT = 'gh auth refresh -s user';

// Quota multiplier of a runner SKU ("Actions Linux", "actions_windows", "Actions macOS 12-core"…).
function multiplier(sku) {
  const s = String(sku || '').toLowerCase();
  if (/mac/.test(s)) return 10;
  if (/windows/.test(s)) return 2;
  return 1;
}

// First day of the next local month (settings.timeZone, #273), when the included minutes reset.
const resetDate = (now, timeZone) => TimeZone.dayKey(TimeZone.nextMonth(now, timeZone), timeZone);

/**
 * The month's Actions minutes from a billing usage response.
 * @param body            GET /users/{user}/settings/billing/usage ({ usageItems: [...] })
 * @param includedMinutes the plan's included quota minutes (settings.actionsIncludedMinutes)
 * @param timeZone        the owner's zone (settings.timeZone): the month is the local one; default UTC
 * @returns { month, usedMinutes (quota minutes, multipliers applied), realMinutes, includedMinutes,
 *            pct, status: ok | warn | over, grossUsd, netUsd, resetsOn, skus: [{ sku, minutes, multiplier }] }
 */
function summarizeActionsUsage(body, { includedMinutes = DEFAULT_INCLUDED_MINUTES, now = new Date(), timeZone = 'UTC' } = {}) {
  const month = TimeZone.monthKey(now, timeZone);
  const bySku = new Map();
  let grossUsd = 0, netUsd = 0;
  for (const item of body?.usageItems || []) {
    if (!/actions/i.test(item.product || '') || !/minute/i.test(item.unitType || '')) continue; // storage is not minutes
    if (item.date && String(item.date).slice(0, 7) !== month) continue;
    const sku = item.sku || 'Actions';
    bySku.set(sku, (bySku.get(sku) || 0) + (Number(item.quantity) || 0));
    grossUsd += Number(item.grossAmount) || 0;
    netUsd += Number(item.netAmount) || 0;
  }
  const skus = [...bySku].map(([sku, minutes]) => ({ sku, minutes, multiplier: multiplier(sku) })).sort((a, b) => b.minutes * b.multiplier - a.minutes * a.multiplier);
  const usedMinutes = skus.reduce((n, s) => n + s.minutes * s.multiplier, 0);
  const realMinutes = skus.reduce((n, s) => n + s.minutes, 0);
  const pct = includedMinutes > 0 ? usedMinutes / includedMinutes : null;
  return {
    month, usedMinutes, realMinutes, includedMinutes, pct,
    status: pct == null ? 'ok' : pct >= 1 ? 'over' : pct >= WARN_AT ? 'warn' : 'ok',
    grossUsd, netUsd, resetsOn: resetDate(now, timeZone), skus,
  };
}

/** The message for an exhausted quota, or null while minutes are left (or the usage is unknown). */
function quotaExhausted(summary) {
  if (!summary || summary.status !== 'over') return null;
  const n = (x) => Math.round(x).toLocaleString('en-US');
  return `GitHub Actions quota exhausted until ${summary.resetsOn} (${n(summary.usedMinutes)} of ${n(summary.includedMinutes)} minutes used): no check will start before then`;
}

const cache = new Map(); // owner ('' = the gh user) -> { at, value }

/**
 * The month's Actions usage of an account, cached for 10 minutes.
 * @param owner  the account (a repository's owner); default: the user gh is logged in as
 * @param exec   (cli, args) => Promise<stdout> (tests)
 * @returns the summary with `login`, or { error, hint? } when it cannot be read
 */
async function getActionsUsage({ owner = '', includedMinutes = DEFAULT_INCLUDED_MINUTES, exec = execCli, now = new Date(), force = false, timeZone = 'UTC' } = {}) {
  const hit = cache.get(owner);
  if (!force && hit && now - hit.at < CACHE_MS && hit.value.includedMinutes === includedMinutes && hit.timeZone === timeZone) return hit.value;
  let value;
  try {
    const login = owner || String(await exec('gh', ['api', 'user', '--jq', '.login'])).trim();
    const [y, m] = TimeZone.monthKey(now, timeZone).split('-').map(Number);
    const body = JSON.parse(await exec('gh', ['api', `users/${login}/settings/billing/usage?year=${y}&month=${m}`]));
    value = { login, ...summarizeActionsUsage(body, { includedMinutes, now, timeZone }) };
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0];
    value = /scope|40[34]|not accessible|Not Found/i.test(msg)
      ? { error: 'GitHub billing usage needs the gh "user" scope', hint: SCOPE_HINT, includedMinutes }
      : { error: msg, includedMinutes };
  }
  cache.set(owner, { at: now, value, timeZone });
  return value;
}

module.exports = {
  DEFAULT_INCLUDED_MINUTES,
  getActionsUsage,
  multiplier,
  quotaExhausted,
  SCOPE_HINT,
  summarizeActionsUsage,
};
