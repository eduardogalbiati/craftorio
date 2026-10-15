// The fixed clock of the E2E visual scenarios (#362, features/support/fixed-clock.js): shiftClock
// moves "now" (Date.now(), new Date(), Date()) to a given instant and keeps it running, leaves dates
// built from explicit values alone, and restores the real Date; VISUAL_NOW is a fixed local instant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { shiftClock, VISUAL_NOW } = require('../features/support/fixed-clock');

const AT = new Date(2026, 9, 8, 14, 0, 0).getTime();
const near = (a, b) => Math.abs(a - b) < 5000;

test('VISUAL_NOW is 2026-10-08 14:00 local time (#362)', () => {
  const d = new Date(VISUAL_NOW);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 9, 8, 14, 0]);
});

test('shiftClock moves Date.now, new Date() and Date() to the instant, then restores the real clock (#362)', () => {
  const RealDate = Date;
  const restore = shiftClock(AT);
  let now; let fresh; let str; let instance;
  try {
    now = Date.now();
    const d = new Date();
    fresh = d.getTime();
    instance = d instanceof RealDate;
    str = Date();
  } finally {
    restore();
  }
  assert.equal(near(now, AT), true, `Date.now() ${now} is near ${AT}`);
  assert.equal(near(fresh, AT), true, `new Date() ${fresh} is near ${AT}`);
  assert.equal(instance, true, 'a shifted date is still a Date');
  assert.equal(typeof str, 'string');
  assert.match(str, /2026/);
  assert.equal(Date === RealDate, true, 'restored');
  assert.equal(near(Date.now(), new RealDate().getTime()), true);
});

test('shiftClock keeps the clock running and leaves explicit dates untouched (#362)', () => {
  const restore = shiftClock(AT);
  let explicit; let parsed; let utc; let first; let later;
  try {
    explicit = new Date(0).getTime();
    parsed = Date.parse('2020-01-01T00:00:00Z');
    utc = Date.UTC(2020, 0, 1);
    first = Date.now();
    const until = first + 20;
    while (Date.now() < until) { /* spin a few ms */ }
    later = Date.now();
  } finally {
    restore();
  }
  assert.equal(explicit, 0);
  assert.equal(parsed, 1577836800000);
  assert.equal(utc, 1577836800000);
  assert.equal(later > first, true, 'the shifted clock is not frozen');
});
