// #283 The shared helper test/service/day-span.js (spanInOneDay) never returns an inverted or
// empty span: at any time of the UTC day, for the minutes the #278 tests ask for, start < end,
// both on one UTC day, `day` that day, and `mid` strictly inside.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spanInOneDay } = require('./day-span');

const NOWS = ['2026-10-05T00:30:40Z', '2026-10-05T00:00:10Z', '2026-10-04T23:59:50Z', '2026-10-05T00:31:10Z', '2026-10-05T00:32:00Z', '2026-10-05T08:00:30Z', '2026-10-05T12:00:00Z'];
const AGO = [30, 8 * 60];
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

for (const at of NOWS) {
  for (const ago of AGO) {
    test(`#283 spanInOneDay(${ago}) at ${at}: start < end, one UTC day, mid inside, ending no later than asked`, () => {
      const now = Date.parse(at);
      const s = spanInOneDay(ago, now);
      const show = JSON.stringify({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), day: s.day });
      assert.ok(s.start < s.end, `inverted or empty span: ${show}`);
      assert.ok(s.end - s.start > 0, `no span: ${show}`);
      assert.equal(dayOf(s.start), dayOf(s.end), `start and end on two UTC days: ${show}`);
      assert.equal(s.day, dayOf(s.end), `day is not the UTC day of the end: ${show}`);
      assert.ok(s.mid > s.start && s.mid < s.end, `mid outside the span: ${show}`);
      assert.ok(s.end <= now - ago * 60e3, `the span ends later than asked: ${show}`);
      // the morning-card tests need it recent: at most a few minutes earlier than asked
      assert.ok(now - ago * 60e3 - s.end <= 5 * 60e3, `the span ends too early: ${show}`);
      assert.ok(s.end - s.start <= 2 * 3600e3, `longer than two hours: ${show}`);
    });
  }
}

test('#283 spanInOneDay: every 10 seconds of a UTC day, for 30 and 480 minutes ago, gives a valid span', () => {
  const day0 = Date.parse('2026-10-05T00:00:00Z');
  const bad = [];
  for (let now = day0; now < day0 + 24 * 3600e3; now += 10e3) {
    for (const ago of AGO) {
      const s = spanInOneDay(ago, now);
      if (!(s.start < s.end && s.mid > s.start && s.mid < s.end && dayOf(s.start) === dayOf(s.end) && s.day === dayOf(s.end))) bad.push(`${new Date(now).toISOString()} ago ${ago}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} bad spans`);
});
