// The fixed clock of the E2E visual scenarios (#362): a baseline that shows dates or hours (the
// hours heatmap: the last 30 days up to today, today's hours still to come hatched) must not depend
// on when the suite runs. launchApp({ now }) seeds the demo workspace with the clock set to `now` and
// passes it to the app (CRAFTORIO_E2E_NOW, read by features/support/electron-main.js), whose main
// process computes what the screens show. The clock is shifted, not frozen: it starts at `now` and
// runs on, so the engine's timers and durations behave as usual.

// the instant every visual scenario renders at: a local time, so the hours shown are the same in any time zone
const VISUAL_NOW = new Date(2026, 9, 8, 14, 0, 0).getTime();

// Replaces the global Date with one whose "now" starts at `at` (ms); returns the function that restores it
function shiftClock(at) {
  const RealDate = Date;
  const offset = at - RealDate.now();
  const now = () => RealDate.now() + offset;
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return args.length ? new RealDate(...args) : new RealDate(now());
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = now;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;
  return () => { globalThis.Date = RealDate; };
}

module.exports = {
  shiftClock,
  VISUAL_NOW,
};
