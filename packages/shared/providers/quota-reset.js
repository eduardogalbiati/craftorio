// When a usage limit resets, from the clock time or the day its message gives (#312): the rules the
// adapters' quotaReset share, so the readings of each CLI do not diverge. Local time. Browser:
// window.ProviderQuotaReset; Node: module.exports.
(function (root) {
  // The next hh:mm (am/pm optional) from now, epoch ms: today when still ahead, else tomorrow.
  const nextClockTime = (hour, minute, ampm, now = Date.now()) => {
    const at = new Date(+now);
    at.setHours(ampm ? (+hour % 12) + (/pm/i.test(ampm) ? 12 : 0) : +hour, +(minute || 0), 0, 0);
    if (at.getTime() <= +now) at.setDate(at.getDate() + 1);
    return at.getTime();
  };

  // The start of a month's day (0-based month), epoch ms: this year, or the next when already past.
  // Today counts as today (its end, 23:59): the limit lifts later that day, not a year later.
  const nextDay = (month, day, now = Date.now()) => {
    const today = new Date(+now);
    const at = new Date(today.getFullYear(), month, +day);
    if (at.getMonth() === today.getMonth() && at.getDate() === today.getDate()) {
      return new Date(today.getFullYear(), month, +day, 23, 59, 0, 0).getTime();
    }
    if (at.getTime() <= +now) at.setFullYear(at.getFullYear() + 1);
    return at.getTime();
  };

  const api = {
    nextClockTime,
    nextDay,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProviderQuotaReset = api;
})(typeof window !== 'undefined' ? window : globalThis);
