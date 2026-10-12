// #273 acceptance tests (written before the code): the shared date helper src/time-zone.js (a Node
// re-export of src/renderer/time-zone.js). Every function takes the IANA zone explicitly as its last
// argument, so these tests never depend on the machine's TZ (CI runs in UTC, the owner in UTC-3).
// The module is required inside each test: this file loads before the module exists.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../src/time-zone');
const HOUR = 3600e3;

test('#273 dayKey: 22:00 in Sao Paulo (01:00Z the next day) is still the local day', () => {
  const tz = load();
  assert.equal(tz.dayKey('2026-10-05T01:00:00Z', 'America/Sao_Paulo'), '2026-10-04');
});

test('#273 dayKey: a Tokyo day starts at 15:00Z the UTC day before', () => {
  const tz = load();
  assert.equal(tz.dayKey('2026-10-04T14:59:00Z', 'Asia/Tokyo'), '2026-10-04');
  assert.equal(tz.dayKey('2026-10-04T15:00:00Z', 'Asia/Tokyo'), '2026-10-05');
});

test('#273 startOfDay: local midnight of Sao Paulo as an epoch', () => {
  const tz = load();
  assert.equal(tz.startOfDay('2026-10-05T01:00:00Z', 'America/Sao_Paulo'), Date.parse('2026-10-04T03:00:00Z'));
});

test('#273 DST: New York 2026-03-08 (clocks forward) is a 23-hour day', () => {
  const tz = load();
  const start = tz.startOfDay('2026-03-08T12:00:00Z', 'America/New_York');
  const next = tz.startOfDay('2026-03-09T12:00:00Z', 'America/New_York');
  assert.equal(start, Date.parse('2026-03-08T05:00:00Z'));
  assert.equal(next, Date.parse('2026-03-09T04:00:00Z'));
  assert.equal(next - start, 23 * HOUR);
});

test('#273 DST: New York 2026-11-01 (clocks back) is a 25-hour day', () => {
  const tz = load();
  const start = tz.startOfDay('2026-11-01T12:00:00Z', 'America/New_York');
  const next = tz.startOfDay('2026-11-02T12:00:00Z', 'America/New_York');
  assert.equal(start, Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(next, Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(next - start, 25 * HOUR);
});

test('#273 DST: Berlin 2026-03-29, 00:30 local (still CET) is already the new day', () => {
  const tz = load();
  assert.equal(tz.dayKey('2026-03-28T23:30:00Z', 'Europe/Berlin'), '2026-03-29');
  assert.equal(tz.startOfDay('2026-03-29T12:00:00Z', 'Europe/Berlin'), Date.parse('2026-03-28T23:00:00Z'));
});

test('#273 startOfMonth: 23:30 on Oct 31 in Sao Paulo (02:30Z Nov 1) is still October', () => {
  const tz = load();
  assert.equal(tz.startOfMonth('2026-11-01T02:30:00Z', 'America/Sao_Paulo'), Date.parse('2026-10-01T03:00:00Z'));
});

test('#273 startOfWeek: a local midnight within the 7 days up to the instant', () => {
  const tz = load();
  const t = Date.parse('2026-10-05T01:00:00Z');
  const s = tz.startOfWeek(t, 'America/Sao_Paulo');
  assert.equal(s, tz.startOfDay(s, 'America/Sao_Paulo'));
  assert.ok(s <= t && t - s < 7 * 24 * HOUR, `week start ${new Date(s).toISOString()}`);
});

test('#273 formatTime: the local 24h HH:MM in the given zone', () => {
  const tz = load();
  assert.equal(tz.formatTime('2026-10-05T01:14:00Z', 'America/Sao_Paulo'), '22:14');
  assert.equal(tz.formatTime('2026-10-05T01:14:00Z', 'Asia/Tokyo'), '10:14');
});

test('#273 formatDateTime: the local date and the local 24h time', () => {
  const tz = load();
  const s = tz.formatDateTime('2026-10-05T01:14:00Z', 'America/Sao_Paulo');
  assert.ok(s.includes('22:14'), s);
  assert.match(s.replace('22:14', ''), /(^|\D)0?4(\D|$)/); // the 4th, not the UTC 5th
});

test('#273 an unknown zone falls back to UTC instead of throwing', () => {
  const tz = load();
  assert.equal(tz.dayKey('2026-10-05T01:00:00Z', 'Not/AZone'), '2026-10-05');
  assert.equal(tz.formatTime('2026-10-05T01:14:00Z', 'Not/AZone'), '01:14');
});
