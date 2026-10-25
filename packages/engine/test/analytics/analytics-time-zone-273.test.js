// #273 acceptance tests (written before the code): Analytics and Usage cut days and months in the
// workspace's time zone (settings.timeZone), not in UTC. The zone is America/Los_Angeles (UTC-7 in
// October): 22:00 there is the next day both in UTC (CI) and in UTC-3 (the owner's machine), so a
// cut in either of those zones fails these tests. Stored stamps stay UTC ISO.
// Also: GitHub Actions minutes' month (packages/engine/domains/usage/actions-usage.js) resets on the local first of the month.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LA = { timeZone: 'America/Los_Angeles' };

function runsDir(t, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz273-runs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  runs.forEach((started, i) => {
    fs.mkdirSync(path.join(dir, `r${i}`));
    fs.writeFileSync(path.join(dir, `r${i}`, 'summary.json'), JSON.stringify({
      run_id: `r${i}`, workflow: 'wf', status: 'success', started_at: started,
      sessions: [{ id: 's1', agent: 'developer', step_id: 'implement', provider: 'claude', model: 'claude-opus-5-5', provider_session_id: `sess-${i}`, turns: 1, tokens: { input: 100, output: 50 }, cost_usd: 0.5, opened_at: started }],
    }));
  });
  return dir;
}

// ---- Analytics -------------------------------------------------------------------------------

test('#273 Analytics: a run at 22:00 local (05:00Z the next day) is counted on its local day', (t) => {
  const { computeAnalytics } = require('../../domains/analytics/analytics');
  const dir = runsDir(t, ['2026-10-05T05:00:00Z']); // 22:00 on 2026-10-04 in Los Angeles
  const a = computeAnalytics({ runsDir: dir, settings: LA, from: '2026-10-04', to: '2026-10-05', now: new Date('2026-10-06T12:00:00Z') });
  const days = Object.fromEntries(a.byDay.map((d) => [d.day, d.tokens]));
  assert.deepEqual(days, { '2026-10-04': 150, '2026-10-05': 0 });
});

test('#273 Analytics: the default range ends on the local today', (t) => {
  const { computeAnalytics } = require('../../domains/analytics/analytics');
  const dir = runsDir(t, []);
  const a = computeAnalytics({ runsDir: dir, settings: LA, now: new Date('2026-10-05T05:30:00Z') }); // 22:30 on Oct 4 local
  assert.equal(a.to, '2026-10-04');
});

// ---- Usage (today and the month in progress) ---------------------------------------------------

test('#273 Usage: a run at 13:00 local today counts in today while it is 22:30 local', (t) => {
  const usage = require('../../domains/usage/usage');
  const dir = runsDir(t, ['2026-10-04T20:00:00Z']);
  const u = usage.computeUsage({ runsDir: dir, settings: LA, now: new Date('2026-10-05T05:30:00Z') });
  assert.equal(u.totals.today.runs, 1);
});

test('#273 Usage: on Oct 31 at 23:45 local (06:45Z Nov 1) the month is still October', (t) => {
  const usage = require('../../domains/usage/usage');
  const dir = runsDir(t, ['2026-10-31T12:00:00Z']);
  const u = usage.computeUsage({ runsDir: dir, settings: LA, now: new Date('2026-11-01T06:45:00Z') });
  assert.equal(u.totals.month.runs, 1);
});

test('#273 Usage: the month resets at local midnight of the 1st', (t) => {
  const usage = require('../../domains/usage/usage');
  const dir = runsDir(t, ['2026-11-01T06:30:00Z']); // 23:30 on Oct 31 local
  const u = usage.computeUsage({ runsDir: dir, settings: LA, now: new Date('2026-11-01T08:00:00Z') }); // 01:00 on Nov 1 local
  assert.equal(u.totals.month.runs, 0);
});

// ---- GitHub Actions minutes -------------------------------------------------------------------

test('#273 Actions minutes: on Oct 31 at 23:45 local the month is October and it resets on Nov 1', () => {
  const { summarizeActionsUsage } = require('../../domains/usage/actions-usage');
  const s = summarizeActionsUsage({ usageItems: [] }, { now: new Date('2026-11-01T06:45:00Z'), timeZone: 'America/Los_Angeles' });
  assert.equal(s.month, '2026-10');
  assert.equal(s.resetsOn, '2026-11-01');
});
