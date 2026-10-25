// #337 (acceptance tests, written before the code): while the Night watch is on, the owner can expand
// every run limit. The API these tests pin down (the developer implements it), a new module
// packages/engine/domains/night/night-limits.js:
//   - MULTIPLIERS = [1.5, 2, 3], DEFAULT_MULTIPLIER = 2.
//   - effectiveLimits(day, tonight, granted = null) → { context, cost, duration, turns }: pure.
//       day      { context (tokens), cost (US$), duration (ms) }: the workflow's own limits, after the
//                #262 per-model lift and its templates; 0 / null = no limit.
//       tonight  null | { multiplier } | { values: { context?, cost?, duration?, turns?, budget? } }
//                (custom values: tokens, US$, ms; `turns` a factor of each agent's own timeout).
//       granted  the highest limits this run was granted so far (same shape as the result), or null.
//     Each limit is the day value × multiplier, or tonight's custom value; never below the day value
//     nor below `granted`; a limit the workflow does not set (0 / null) stays unset. turns is 1 by day.
//   - saveNightLimits(dir, limits, { by = 'the owner', now = Date.now() }) → the saved record. `dir` is
//     the Oracle's folder (<dir>/night-watch.json, packages/engine/domains/oracle/oracle-actions.js). Refused unless a Night
//     watch with an end time is active (Self-healing's standing watch never expands limits). Appends
//     { type: 'oracle.limits', multiplier, values, by, at } to the night log (night-watch.js LOG_TYPES).
//   - tonightLimits(dir, now = Date.now()) → { multiplier, values, ... } while that Night watch is
//     active, null otherwise (after its end time, switched off, or under Self-healing alone).
//   - pastDayLimits(runs) → { lines, overDayUsd }: runs [{ label, used: { context, cost }, day: {...},
//     tonight: {...} }]; one line per run that went past a day limit; overDayUsd = what the runs spent
//     above their day cost limits.
//   night-watch.js morningSummary(m, { limits }) carries them: summary.limits (the lines) and
//   summary.overDayUsd.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const actions = require('../../domains/oracle/oracle-actions');
const night = require('../../domains/night/night-watch');

const load = () => require('../../domains/night/night-limits');

const H = 3600e3;
const DAY = { context: 40000000, cost: 120, duration: 28800000 };

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-limits-337-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function nightOn(dir, hours = 8) {
  const until = new Date(Date.now() + hours * H).toISOString();
  return actions.setNightWatch(dir, { on: true, until, by: 'test' });
}

test('#337 the multipliers offered are 1.5, 2 and 3, with 2 by default', () => {
  const { MULTIPLIERS, DEFAULT_MULTIPLIER } = load();
  assert.deepEqual([...MULTIPLIERS], [1.5, 2, 3]);
  assert.equal(DEFAULT_MULTIPLIER, 2);
});

test('#337 effectiveLimits from a multiplier: each day limit times it, and turns times it', () => {
  const { effectiveLimits } = load();
  assert.deepEqual({ ...effectiveLimits(DAY, { multiplier: 2 }) }, { context: 80000000, cost: 240, duration: 57600000, turns: 2 });
  assert.deepEqual({ ...effectiveLimits(DAY, { multiplier: 1.5 }) }, { context: 60000000, cost: 180, duration: 43200000, turns: 1.5 });
});

test('#337 effectiveLimits from custom values: tonight\'s value replaces the day one; a value not given keeps the day limit', () => {
  const { effectiveLimits } = load();
  assert.deepEqual({ ...effectiveLimits(DAY, { values: { context: 100000000, cost: 300, duration: 43200000, turns: 3 } }) }, { context: 100000000, cost: 300, duration: 43200000, turns: 3 });
  assert.deepEqual({ ...effectiveLimits(DAY, { values: { context: 60000000 } }) }, { context: 60000000, cost: 120, duration: 28800000, turns: 1 });
});

test('#337 effectiveLimits without tonight\'s settings are the day limits, turns 1', () => {
  const { effectiveLimits } = load();
  assert.deepEqual({ ...effectiveLimits(DAY, null) }, { context: 40000000, cost: 120, duration: 28800000, turns: 1 });
});

test('#337 effectiveLimits never lowers a limit: a custom value under the day limit keeps the day limit', () => {
  const { effectiveLimits } = load();
  assert.deepEqual({ ...effectiveLimits(DAY, { values: { context: 10000000, cost: 50, duration: H, turns: 0.5 } }) }, { context: 40000000, cost: 120, duration: 28800000, turns: 1 });
});

test('#337 effectiveLimits: a limit the workflow does not set (cost 0, no duration, no context) stays unset whatever tonight says', () => {
  const { effectiveLimits } = load();
  const none = { context: null, cost: 0, duration: null };
  for (const tonight of [{ multiplier: 3 }, { values: { context: 80000000, cost: 500, duration: 57600000 } }]) {
    const e = effectiveLimits(none, tonight);
    assert.deepEqual([e.context ?? null, e.cost, e.duration ?? null], [null, 0, null], JSON.stringify(tonight));
  }
});

test('#337 effectiveLimits keeps the highest limit already granted: the morning never cuts a run', () => {
  const { effectiveLimits } = load();
  const granted = { context: 80000000, cost: 240, duration: 57600000, turns: 2 };
  // the watch ended: no settings tonight, the run keeps what it was granted
  assert.deepEqual({ ...effectiveLimits(DAY, null, granted) }, { context: 80000000, cost: 240, duration: 57600000, turns: 2 });
  // a raise above what it was granted wins
  assert.deepEqual({ ...effectiveLimits(DAY, { multiplier: 3 }, granted) }, { context: 120000000, cost: 360, duration: 86400000, turns: 3 });
});

test('#337 saveNightLimits during a Night watch: tonightLimits returns them, and the night log gets oracle.limits { multiplier, values, by, at }', (t) => {
  const { saveNightLimits, tonightLimits } = load();
  const dir = tmpDir(t);
  nightOn(dir);
  saveNightLimits(dir, { multiplier: 2 }, { by: 'the owner' });
  assert.equal(tonightLimits(dir).multiplier, 2);
  const values = { context: 100000000, cost: 300, duration: 43200000, turns: 2, budget: 150 };
  saveNightLimits(dir, { values }, { by: 'the owner' });
  assert.deepEqual({ ...tonightLimits(dir).values }, values);
  const logged = night.readNightLog(dir).filter((e) => e.type === 'oracle.limits');
  assert.equal(logged.length, 2);
  assert.deepEqual([logged[0].multiplier, logged[0].by], [2, 'the owner']);
  assert.deepEqual([logged[1].multiplier ?? null, { ...logged[1].values }, logged[1].by], [null, values, 'the owner']);
  for (const e of logged) assert.equal(Number.isNaN(Date.parse(e.at)), false, `at is a date: ${e.at}`);
  assert.equal(night.LOG_TYPES.includes('oracle.limits'), true);
});

test('#337 saveNightLimits refuses a multiplier that is not 1.5, 2 or 3', (t) => {
  const { saveNightLimits } = load();
  const dir = tmpDir(t);
  nightOn(dir);
  assert.throws(() => saveNightLimits(dir, { multiplier: 5 }, { by: 'the owner' }), /multiplier/i);
});

test('#337 tonightLimits is null once the Night watch\'s end time passed or it was switched off: runs starting afterwards get day limits', (t) => {
  const { saveNightLimits, tonightLimits } = load();
  const dir = tmpDir(t);
  const w = nightOn(dir, 2);
  saveNightLimits(dir, { multiplier: 3 }, { by: 'the owner' });
  assert.equal(tonightLimits(dir, Date.parse(w.until) + 1000), null);
  actions.setNightWatch(dir, { on: false });
  assert.equal(tonightLimits(dir), null);
});

test('#337 Self-healing does not expand limits: with only the standing watch on, saving is refused and nothing is in force', (t) => {
  const { saveNightLimits, tonightLimits } = load();
  const dir = tmpDir(t);
  actions.markSelfHealing(dir, true);
  assert.equal(actions.watchState(dir, { oracle: { selfHealing: true } }).active, true, 'the standing watch is on');
  assert.throws(() => saveNightLimits(dir, { multiplier: 2 }, { by: 'the owner' }), /Night watch/);
  assert.equal(tonightLimits(dir), null);
  assert.equal(night.readNightLog(dir).filter((e) => e.type === 'oracle.limits').length, 0);
});

test('#337 pastDayLimits: one line per run past a day limit, with how far; and the spending above the day cost limits', () => {
  const { pastDayLimits } = load();
  const tonight = { context: 80000000, cost: 240 };
  const day = { context: 40000000, cost: 120 };
  const out = pastDayLimits([
    { label: '#262', used: { context: 58000000, cost: 61 }, day, tonight },
    { label: '#263', used: { context: 12000000, cost: 20 }, day, tonight },
    { label: '#264', used: { context: 30000000, cost: 150 }, day, tonight },
  ]);
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[0], '#262: context 58M of 80M tonight (day limit 40M), US$ 61 of US$ 240');
  assert.match(out.lines[1], /^#264: /);
  assert.equal(out.overDayUsd, 30);
});

test('#337 morningSummary lists the runs past a day limit and the spending above the day limits', () => {
  const { pastDayLimits } = load();
  const startedAt = '2026-10-12T22:00:00.000Z';
  const m = night.nightMetrics({ night: { startedAt, until: '2026-10-13T06:00:00.000Z', endedAt: '2026-10-13T06:00:00.000Z' }, now: Date.parse('2026-10-13T07:00:00.000Z') });
  const limits = pastDayLimits([{ label: '#262', used: { context: 58000000, cost: 150 }, day: { context: 40000000, cost: 120 }, tonight: { context: 80000000, cost: 240 } }]);
  const s = night.morningSummary(m, { limits });
  assert.deepEqual([...s.limits], [...limits.lines]);
  assert.equal(s.limits.length, 1);
  assert.equal(s.overDayUsd, 30);
});

test('#337 the Oracle gets no new permission: no action kind or Night watch permission changes limits', () => {
  assert.deepEqual(actions.ACTION_KINDS.filter((k) => /limit/i.test(k)), []);
  assert.deepEqual(night.PERMISSIONS.map((p) => p.id).filter((id) => /limit/i.test(id)), []);
});
