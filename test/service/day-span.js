// A time span inside one UTC day, for the tests that log a Self-healing day (#278, #283). Not a
// test file itself (no *.test.js suffix). `now` is injectable so the minutes around midnight UTC
// can be checked (test/service/day-span-283.test.js).

const iso = (ms) => new Date(ms).toISOString();
const dayStart = (ms) => Date.parse(`${iso(ms).slice(0, 10)}T00:00:00.000Z`);

// a span ending `endAgoMin` minutes before `now` (a minute or two earlier when that is in the first
// two minutes of a UTC day: it then ends at 23:59 of the day before), at most two hours long and
// inside one UTC day, starting no earlier than its day's first minute (#283: never inverted or empty)
function spanInOneDay(endAgoMin, now = Date.now()) {
  let end = now - endAgoMin * 60e3;
  if (end - dayStart(end) < 2 * 60e3) end = dayStart(end) - 60e3;
  const start = Math.max(dayStart(end) + 60e3, end - 2 * 3600e3);
  return { start, end, mid: Math.round((start + end) / 2), day: iso(end).slice(0, 10) };
}

module.exports = { dayStart, iso, spanInOneDay };
