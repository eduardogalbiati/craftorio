// src/actions-usage.js: GitHub Actions minutes of the month against the included quota.
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeActionsUsage, quotaExhausted, getActionsUsage } = require('../src/actions-usage');

const NOW = new Date('2026-09-30T12:00:00Z');
const item = (sku, quantity, extra = {}) => ({ date: '2026-09-30T00:00:00Z', product: 'actions', sku, unitType: 'minutes', quantity, grossAmount: 0, netAmount: 0, ...extra });

test('summarizeActionsUsage: Windows minutes count x2 and macOS x10 against the quota', () => {
  const s = summarizeActionsUsage({ usageItems: [item('Actions Linux', 53), item('Actions Windows', 150), item('Actions macOS', 32)] }, { now: NOW });
  assert.equal(s.usedMinutes, 673);
  assert.equal(s.realMinutes, 235);
  assert.equal(s.includedMinutes, 2000);
  assert.equal(s.status, 'ok');
  assert.equal(s.resetsOn, '2026-10-01');
  assert.deepEqual(s.skus.map((x) => [x.sku, x.minutes, x.multiplier]), [['Actions macOS', 32, 10], ['Actions Windows', 150, 2], ['Actions Linux', 53, 1]]);
});

test('summarizeActionsUsage: warns at 80% and is over at the included minutes', () => {
  const at = (minutes) => summarizeActionsUsage({ usageItems: [item('actions_linux', minutes)] }, { includedMinutes: 2000, now: NOW });
  assert.equal(at(1599).status, 'ok');
  assert.equal(at(1600).status, 'warn');
  assert.equal(at(1719).status, 'warn');
  assert.equal(at(2000).status, 'over');
});

test('summarizeActionsUsage: ignores storage, other products and other months', () => {
  const s = summarizeActionsUsage({
    usageItems: [
      item('Actions Linux', 10, { grossAmount: 0.08 }),
      item('Actions storage', 500, { unitType: 'GigabyteHours' }),
      item('Copilot', 300, { product: 'copilot' }),
      item('Actions Linux', 900, { date: '2026-08-31T00:00:00Z' }),
    ],
  }, { now: NOW });
  assert.equal(s.usedMinutes, 10);
  assert.equal(s.grossUsd, 0.08);
});

test('summarizeActionsUsage: an empty month uses nothing', () => {
  const s = summarizeActionsUsage({}, { now: NOW });
  assert.equal(s.usedMinutes, 0);
  assert.equal(s.pct, 0);
  assert.deepEqual(s.skus, []);
});

test('quotaExhausted: names the reset date only once the quota is used up', () => {
  const over = summarizeActionsUsage({ usageItems: [item('Actions Windows', 1005)] }, { now: NOW });
  assert.equal(quotaExhausted(over), 'GitHub Actions quota exhausted until 2026-10-01 (2,010 of 2,000 minutes used): no check will start before then');
  assert.equal(quotaExhausted(summarizeActionsUsage({ usageItems: [item('Actions Windows', 900)] }, { now: NOW })), null);
  assert.equal(quotaExhausted({ error: 'no scope' }), null);
  assert.equal(quotaExhausted(null), null);
});

test('getActionsUsage: reads the logged-in account\'s billing usage of the month', async () => {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args].join(' '));
    if (args[1] === 'user') return 'octocat\n';
    return JSON.stringify({ usageItems: [item('Actions Linux', 100)] });
  };
  const u = await getActionsUsage({ exec, now: NOW, includedMinutes: 3000, owner: '', force: true });
  assert.equal(u.login, 'octocat');
  assert.equal(u.usedMinutes, 100);
  assert.equal(u.includedMinutes, 3000);
  assert.deepEqual(calls, ['gh api user --jq .login', 'gh api users/octocat/settings/billing/usage?year=2026&month=9']);
});

test('getActionsUsage: without the user scope it says how to grant it', async () => {
  const exec = async () => { throw new Error('gh api users/acme/settings/billing/usage failed: HTTP 404: Not Found'); };
  const u = await getActionsUsage({ exec, now: NOW, owner: 'acme', force: true });
  assert.match(u.error, /user" scope/);
  assert.equal(u.hint, 'gh auth refresh -s user');
});

test('getActionsUsage: answers from its cache for ten minutes', async () => {
  let n = 0;
  const exec = async () => { n++; return JSON.stringify({ usageItems: [item('Actions Linux', n)] }); };
  const first = await getActionsUsage({ exec, now: NOW, owner: 'cache-test', force: true });
  const again = await getActionsUsage({ exec, now: new Date(NOW.getTime() + 5 * 60e3), owner: 'cache-test' });
  const later = await getActionsUsage({ exec, now: new Date(NOW.getTime() + 11 * 60e3), owner: 'cache-test' });
  assert.equal(first.usedMinutes, 1);
  assert.equal(again.usedMinutes, 1);
  assert.equal(later.usedMinutes, 2);
});
