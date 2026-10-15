// The date-range control (#383): a From / To pair of date fields in the app's input style (their
// calendar themed by `color-scheme: dark`, style.css), with optional presets, for every screen that
// filters by days (Analytics, the project's Architecture and Conflict map).
// - PRESETS: [{ id, label }], Last 24 h, Last 7 days, Last 30 days and All, in that order.
// - presetRange(id, now, timeZone): { from, to } 'YYYY-MM-DD' days in the owner's time zone (#273):
//   to is the day of `now` there, from that day minus the preset's days; All is { from: '', to: '' }
//   (no range); an unknown id is null.
// - fields({ testid, from, to, fromAttrs, toAttrs, presets, active }): the control's markup: a
//   wrapper with the caller's data-testid, preset buttons (data-date-preset="<id>", the one `active`
//   pressed) when `presets`, and the fields (data-testid="date-range-from" / "date-range-to") with
//   the caller's attributes (ids, data-*). The screen wires their `change` and the preset clicks.
// Browser: window.DateRange; Node: module.exports.
// load: early (the screens' panels are built with it as they load)
(function (root) {
  const TZ = typeof module === 'object' && module.exports ? require('../shared/time-zone.js') : root.TimeZone;

  // id → days before today
  const PRESETS = [
    { id: '24h', label: 'Last 24 h', days: 1 },
    { id: '7d', label: 'Last 7 days', days: 7 },
    { id: '30d', label: 'Last 30 days', days: 30 },
    { id: 'all', label: 'All', days: null },
  ];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function presetRange(id, now = new Date(), timeZone = 'UTC') {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    if (!preset.days) return { from: '', to: '' };
    const to = TZ.dayKey(now, timeZone);
    return { from: TZ.shiftDay(to, -preset.days), to };
  }

  function fields({ testid = 'date-range', from = '', to = '', fromAttrs = '', toAttrs = '', presets = false, active = null } = {}) {
    const buttons = presets
      ? `<div class="seg sm date-range-presets" role="group" aria-label="Quick range">${PRESETS.map((p) => `<button type="button" data-date-preset="${p.id}" class="${p.id === active ? 'active' : ''}" aria-pressed="${p.id === active}">${esc(p.label)}</button>`).join('')}</div>`
      : '';
    const field = (label, which, value, attrs) => `<label class="date-range-field small muted">${label} <input type="date" data-testid="date-range-${which}" ${attrs} value="${esc(value)}" /></label>`;
    return `<div class="date-range" data-testid="${esc(testid)}" role="group" aria-label="Date range">${buttons}${field('From', 'from', from, fromAttrs)}${field('To', 'to', to, toAttrs)}</div>`;
  }

  const api = {
    fields,
    PRESETS,
    presetRange,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DateRange = api;
})(typeof window !== 'undefined' ? window : globalThis);
