// #273 internals (the developer's tests, next to the acceptance tests in time-zone-273.test.js): the
// helper's datetime-local round trip, nextAt, startOfDayKey and offsetLabel; the setting's save rules
// (the computer's zone is not saved until one is chosen, an unknown zone is refused); the Supervisor
// chat's [Time] line; the day budget (#206) cut in the owner's zone. Every zone is explicit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tz = require('../../src/domains/analytics/time-zone');

test('#273 inputValue / parseInput: a datetime-local value round-trips in the zone', () => {
  const t = Date.parse('2026-10-05T01:14:00Z');
  assert.equal(tz.inputValue(t, 'America/Sao_Paulo'), '2026-10-04T22:14');
  assert.equal(tz.parseInput('2026-10-04T22:14', 'America/Sao_Paulo'), t);
  assert.equal(tz.parseInput('2026-10-05T10:14', 'Asia/Tokyo'), t);
  assert.ok(Number.isNaN(tz.parseInput('not a time', 'Asia/Tokyo')));
});

test('#273 parseInput around a clocks-back change: the right instant, the earlier one when the time comes twice', () => {
  // Berlin 2026-10-25: 03:00 CEST becomes 02:00 CET (01:00Z)
  assert.equal(tz.parseInput('2026-10-25T01:30', 'Europe/Berlin'), Date.parse('2026-10-24T23:30:00Z'));
  assert.equal(tz.parseInput('2026-10-25T02:30', 'Europe/Berlin'), Date.parse('2026-10-25T00:30:00Z'));
  assert.equal(tz.parseInput('2026-10-25T03:30', 'Europe/Berlin'), Date.parse('2026-10-25T02:30:00Z'));
  // New York 2026-11-01 01:30 comes twice (EDT, then EST): the EDT one
  assert.equal(tz.parseInput('2026-11-01T01:30', 'America/New_York'), Date.parse('2026-11-01T05:30:00Z'));
  // a time in the spring gap does not exist: shifted forward by the gap (02:30 EST reads 03:30 EDT)
  assert.equal(tz.parseInput('2026-03-08T02:30', 'America/New_York'), Date.parse('2026-03-08T07:00:00Z') + 30 * 60e3);
  assert.ok(Number.isNaN(tz.startOfDayKey('bad', 'Asia/Tokyo')));
});

test('#273 nextAt: today\'s 07:30 while it is ahead, else tomorrow\'s, in the zone', () => {
  // 22:14 on Oct 4 in Sao Paulo: the next 07:30 is Oct 5 07:30 local (10:30Z)
  assert.equal(tz.nextAt(7, 30, 'America/Sao_Paulo', Date.parse('2026-10-05T01:14:00Z')), Date.parse('2026-10-05T10:30:00Z'));
  // 05:00 on Oct 5 in Sao Paulo: still ahead today
  assert.equal(tz.nextAt(7, 30, 'America/Sao_Paulo', Date.parse('2026-10-05T08:00:00Z')), Date.parse('2026-10-05T10:30:00Z'));
});

test('#273 startOfDayKey and offsetLabel', () => {
  assert.equal(tz.startOfDayKey('2026-10-04', 'Asia/Tokyo'), Date.parse('2026-10-03T15:00:00Z'));
  assert.equal(tz.startOfDayKey('2026-10-04', 'Pacific/Kiritimati'), Date.parse('2026-10-03T10:00:00Z'));
  assert.equal(tz.offsetLabel('2026-10-05T01:14:00Z', 'America/Sao_Paulo'), 'UTC-03:00');
  assert.equal(tz.offsetLabel('2026-10-05T01:14:00Z', 'Asia/Kolkata'), 'UTC+05:30');
  assert.match(tz.titleOf('2026-10-05T01:14:00Z', 'Asia/Tokyo'), /^2026-10-05 10:14 Asia\/Tokyo \(UTC\+09:00\)$/);
});

test('#273 nowLine names the zone and the local time; zones() lists UTC and the given zone', () => {
  const line = tz.nowLine('Asia/Tokyo', Date.parse('2026-10-05T01:14:00Z'));
  assert.ok(line.includes('Asia/Tokyo') && line.includes('2026-10-05 10:14'), line);
  const list = tz.zones('Asia/Tokyo');
  assert.ok(list.includes('UTC') && list.includes('Asia/Tokyo') && list.includes('America/Sao_Paulo'));
});

function tempWs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz273-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { settings: path.join(dir, 'settings.json') };
}

test('#273 writeSettings: the computer\'s zone is not saved until one is chosen; a chosen one is kept', (t) => {
  const workspace = require('../../src/workspace');
  const ws = tempWs(t);
  workspace.writeSettings(ws, { backlogMaxGroup: 4 });
  assert.equal(JSON.parse(fs.readFileSync(ws.settings, 'utf8')).timeZone, null);
  assert.equal(workspace.readSettings(ws).timeZone, tz.systemZone());
  workspace.writeSettings(ws, { timeZone: 'Asia/Tokyo' });
  workspace.writeSettings(ws, { backlogMaxGroup: 3 });
  assert.equal(JSON.parse(fs.readFileSync(ws.settings, 'utf8')).timeZone, 'Asia/Tokyo');
});

test('#273 writeSettings refuses an unknown time zone', (t) => {
  const workspace = require('../../src/workspace');
  const ws = tempWs(t);
  assert.throws(() => workspace.writeSettings(ws, { timeZone: 'Not/AZone' }), /Unknown time zone/);
});

test('#273 Supervisor chat: a question carries the [Time] line when the zone is given', () => {
  const { questionText } = require('../../src/supervisor-chat');
  assert.equal(questionText('Why?', 'Runs'), '[Screen] Runs\n\nWhy?');
  const text = questionText('Why?', 'Runs', 'Asia/Tokyo');
  assert.match(text.split('\n')[0], /^\[Time\] .*Asia\/Tokyo/);
  assert.ok(text.endsWith('[Screen] Runs\n\nWhy?'));
});

test('#273 day budget (#206): today is the owner\'s local day', () => {
  const budget = require('../../src/budget');
  const runs = [{ startedAt: '2026-10-04T16:00:00Z', sessions: [{ cost_usd: 2 }] }, { startedAt: '2026-10-04T14:00:00Z', sessions: [{ cost_usd: 7 }] }];
  // 19:00 on Oct 5 in Tokyo: only the 01:00 JST run (16:00Z the day before) is today
  const st = budget.budgetState({ settings: { timeZone: 'Asia/Tokyo', budget: { dailyUsd: 10 } }, runs, now: new Date('2026-10-05T10:00:00Z') });
  assert.equal(st.day.key, '2026-10-05');
  assert.equal(st.day.spentUsd, 2);
});
