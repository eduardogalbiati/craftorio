// apps/desktop/renderer/estimates.js (#215): the shared rules for showing an estimate against what really
// happened, used by the roadmap (backlog-roadmap.js) and the Product Owner's proposals. UMD like
// workflow-inputs.js (window.Estimates in the renderer, module.exports in Node), so it is required
// directly here.
// - formatMinutes(n): a duration in minutes as the roadmap shows it ("58 min", "1 h 45 min").
// - verdict(actual, estimate): { level, percent, diff }: level 'good' when the real value is at or
//   below the estimate, 'warn' up to +25%, 'bad' above; percent the rounded difference in % (signed),
//   diff the signed difference in the value's unit (rounded to cents); null without an estimate.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const load = () => require(path.join(__dirname, '..', 'renderer', 'estimates.js'));

test('formatMinutes: under an hour in minutes, above it in hours and minutes', () => {
  const { formatMinutes } = load();
  assert.equal(formatMinutes(58), '58 min');
  assert.equal(formatMinutes(105), '1 h 45 min');
  assert.equal(formatMinutes(221), '3 h 41 min');
});

test('verdict: at or below the estimate is good, with a negative difference', () => {
  const { verdict } = load();
  assert.equal(verdict(15.18, 15.18).level, 'good');
  const under = verdict(10, 15.18);
  assert.equal(under.level, 'good');
  assert.equal(under.percent, -34);
});

test('verdict: slightly over the estimate (up to +25%) is a warning', () => {
  const { verdict } = load();
  const v = verdict(18, 15.18);
  assert.equal(v.level, 'warn');
  assert.equal(v.percent, 19);
  assert.equal(verdict(125, 100).level, 'warn');
});

test('verdict: far over the estimate (above +25%) is bad, with the percent and the amount more', () => {
  const { verdict } = load();
  assert.equal(verdict(126, 100).level, 'bad');
  const v = verdict(22.21, 15.18);
  assert.equal(v.level, 'bad');
  assert.equal(v.percent, 46);
  assert.equal(v.diff, 7.03);
});

test('verdict: no estimate (missing or zero) gives no verdict', () => {
  const { verdict } = load();
  assert.equal(verdict(10, null), null);
  assert.equal(verdict(10, 0), null);
});
