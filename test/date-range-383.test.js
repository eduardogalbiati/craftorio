// #383: a date-range control with presets (last 24 h, 7 days, 30 days, All) instead of two bare
// date inputs. A preset gives a { from, to } pair of 'YYYY-MM-DD' days in the owner's time zone:
// to is today there, from is the day there of now minus the preset's duration; All is no range.
// Seam: src/renderer/date-range.js, UMD like status-pill.js (window.DateRange / module.exports):
// { PRESETS, presetRange(id, now, timeZone) }.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../src/renderer/date-range.js');
const range = (r) => (r ? { from: r.from, to: r.to } : r);

test('#383 the presets are Last 24 h, Last 7 days, Last 30 days and All, in that order', () => {
  const { PRESETS } = load();
  assert.deepEqual(PRESETS.map((p) => p.id), ['24h', '7d', '30d', 'all']);
  assert.deepEqual(PRESETS.map((p) => p.label), ['Last 24 h', 'Last 7 days', 'Last 30 days', 'All']);
});

test('#383 Last 7 days in UTC', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('7d', new Date('2026-10-15T02:00:00Z'), 'UTC')), { from: '2026-10-08', to: '2026-10-15' });
});

test('#383 Last 7 days in America/Sao_Paulo uses the day there (still the 14th)', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('7d', new Date('2026-10-15T02:00:00Z'), 'America/Sao_Paulo')), { from: '2026-10-07', to: '2026-10-14' });
});

test('#383 Last 24 h in UTC', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('24h', new Date('2026-10-15T02:00:00Z'), 'UTC')), { from: '2026-10-14', to: '2026-10-15' });
});

test('#383 Last 30 days in UTC', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('30d', new Date('2026-10-15T02:00:00Z'), 'UTC')), { from: '2026-09-15', to: '2026-10-15' });
});

test('#383 Last 24 h in Asia/Tokyo uses the day there (already the 16th)', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('24h', new Date('2026-10-15T20:00:00Z'), 'Asia/Tokyo')), { from: '2026-10-15', to: '2026-10-16' });
});

test('#383 All is no range (empty from and to)', () => {
  const { presetRange } = load();
  assert.deepEqual(range(presetRange('all', new Date('2026-10-15T02:00:00Z'), 'UTC')), { from: '', to: '' });
});

test('#383 an unknown preset id gives null', () => {
  const { presetRange } = load();
  assert.equal(presetRange('90d', new Date('2026-10-15T02:00:00Z'), 'UTC'), null);
});
