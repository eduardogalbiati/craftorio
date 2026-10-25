// The owner's time zone (#273): Settings › General › Time zone saves an IANA zone in the workspace
// (settings.timeZone; unset, the computer's). Every day, week, night or month cut and every visible
// time goes through this file, in that zone; events and files keep their UTC ISO stamps.
// Each function takes the instant (epoch ms, ISO string or Date) and the zone as its last argument;
// an unknown zone falls back to UTC, a missing one to the computer's.
// - dayKey / monthKey: 'YYYY-MM-DD' / 'YYYY-MM' of the instant's local day / month;
// - startOfDay / startOfWeek (Monday) / startOfMonth / nextDay / nextMonth / startOfDayKey(key):
//   epoch ms of a local midnight;
// - shiftDay(key, n): a day key n days later (calendar math, no zone);
// - formatTime ('22:14'), formatDate ('2026-10-04'), formatDateTime ('2026-10-04 22:14'),
//   offsetLabel ('UTC-03:00'), titleOf (a tooltip naming the zone), nowLine (the agents' turn line);
// - formatLocale(t, options, tz, lang): the instant in words (Intl options) in the interface language
//   (#329, src/shared/i18n.js) unless lang is given ('04/10/2026' in pt-BR, '10/4/26' in English);
// - inputValue / parseInput: a datetime-local field's value in the zone; nextAt(h, mi): the next local h:mi;
// - zones(): the IANA list for the Settings select; current(): the renderer's zone (state.settings);
//   onChange(fn) / notify(): open screens redraw when the zone is loaded or changed.
// Browser: window.TimeZone; Node: module.exports (src/domains/analytics/time-zone.js re-exports it).
(function (root) {
  const DAY_MS = 864e5;
  const formatters = new Map();

  /** The computer's zone ('UTC' when the runtime cannot say). */
  function systemZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }

  /** A usable zone: the given one when the runtime knows it, UTC when not, the computer's when none is given. */
  function zoneOf(tz) {
    if (!tz) return systemZone();
    formatterOf(tz);
    return formatters.get(tz) ? tz : 'UTC';
  }

  function formatterOf(tz) {
    if (!formatters.has(tz)) {
      let f = null;
      try {
        f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { f = null; }
      formatters.set(tz, f);
    }
    return formatters.get(tz) || formatterOf('UTC');
  }

  const msOf = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : t == null ? Date.now() : Date.parse(t));
  const pad = (n) => String(n).padStart(2, '0');

  /** The instant's local wall clock: { y, m, d, h, mi, s } (numbers), or null for an invalid instant. */
  function partsOf(t, tz) {
    const ms = msOf(t);
    if (!Number.isFinite(ms)) return null;
    const p = {};
    for (const { type, value } of formatterOf(zoneOf(tz)).formatToParts(new Date(ms))) p[type] = value;
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
  }

  /** The zone's offset from UTC at the instant, in ms (Sao Paulo: -3 h). */
  function offsetAt(ms, tz) {
    const p = partsOf(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (ms - (((ms % 1000) + 1000) % 1000));
  }

  /** Epoch ms of a local wall-clock time (month 1-12; days past the month's end roll over). */
  function epochOf(y, m, d, tz, h = 0, mi = 0) {
    const wall = Date.UTC(y, m - 1, d, h, mi);
    if (!Number.isFinite(wall)) return NaN;
    // the candidates from the offsets in force a day before and a day after (a change is never closer)
    const candidates = [wall - offsetAt(wall - DAY_MS, tz), wall - offsetAt(wall + DAY_MS, tz)];
    // the instant whose local clock reads the wall time (twice when the clocks go back: the earlier);
    // none inside a DST gap (the time does not exist): shifted forward by the gap, like Date does
    const reads = (t) => { const p = partsOf(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) === wall; };
    const found = candidates.filter(reads);
    return found.length ? Math.min(...found) : Math.max(...candidates);
  }

  function dayKey(t, tz) {
    const p = partsOf(t, tz);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : '';
  }

  function monthKey(t, tz) {
    const p = partsOf(t, tz);
    return p ? `${p.y}-${pad(p.m)}` : '';
  }

  function startOfDay(t, tz) {
    const p = partsOf(t, tz);
    return p ? epochOf(p.y, p.m, p.d, tz) : NaN;
  }

  function nextDay(t, tz) {
    const p = partsOf(t, tz);
    return p ? epochOf(p.y, p.m, p.d + 1, tz) : NaN;
  }

  /** The local Monday midnight of the instant's week. */
  function startOfWeek(t, tz) {
    const p = partsOf(t, tz);
    if (!p) return NaN;
    const back = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
    return epochOf(p.y, p.m, p.d - back, tz);
  }

  function startOfMonth(t, tz) {
    const p = partsOf(t, tz);
    return p ? epochOf(p.y, p.m, 1, tz) : NaN;
  }

  function nextMonth(t, tz) {
    const p = partsOf(t, tz);
    return p ? epochOf(p.y, p.m + 1, 1, tz) : NaN;
  }

  /** Epoch ms of the local midnight that starts the day `key` ('YYYY-MM-DD'). */
  function startOfDayKey(key, tz) {
    const [y, m, d] = String(key).split('-').map(Number);
    return epochOf(y, m, d, tz);
  }

  /** A datetime-local input's value ('YYYY-MM-DDTHH:MM') of the instant, in the zone. */
  function inputValue(t, tz) {
    const s = formatDateTime(t, tz);
    return s ? s.replace(' ', 'T') : '';
  }

  /** Epoch ms of a datetime-local value ('YYYY-MM-DDTHH:MM') read in the zone (NaN when it is not one). */
  function parseInput(value, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? epochOf(+m[1], +m[2], +m[3], tz, +m[4], +m[5]) : NaN;
  }

  /** The next local hh:mm after `now` (today's when still ahead, else tomorrow's), as epoch ms. */
  function nextAt(h, mi, tz, now = Date.now()) {
    const p = partsOf(now, tz);
    const t = epochOf(p.y, p.m, p.d, tz, h, mi);
    return t > msOf(now) ? t : epochOf(p.y, p.m, p.d + 1, tz, h, mi);
  }

  /** A day key n days after `key` ('2026-10-04', -1 → '2026-10-03'). */
  function shiftDay(key, n) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  function formatTime(t, tz) {
    const p = partsOf(t, tz);
    return p ? `${pad(p.h)}:${pad(p.mi)}` : '';
  }

  const formatDate = dayKey;

  function formatDateTime(t, tz) {
    const p = partsOf(t, tz);
    return p ? `${dayKey(t, tz)} ${pad(p.h)}:${pad(p.mi)}` : '';
  }

  // the interface language (#329), at call time: in the browser i18n.js is a separate script
  const i18n = () => (typeof module === 'object' && module.exports ? require('./i18n') : root.I18n);

  /** The instant in words, as Intl.DateTimeFormat(lang, options) writes it in the zone; lang: the interface language when omitted. */
  function formatLocale(t, options, tz, lang) {
    const ms = msOf(t);
    if (!Number.isFinite(ms)) return '';
    const locale = lang || i18n()?.getLanguage() || 'en';
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: zoneOf(tz) }).format(new Date(ms));
  }

  /** 'UTC-03:00' at the instant. */
  function offsetLabel(t, tz) {
    const ms = msOf(t);
    if (!Number.isFinite(ms)) return '';
    const off = Math.round(offsetAt(ms, tz) / 6e4);
    const a = Math.abs(off);
    return `UTC${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }

  /** A tooltip for a shown time: '2026-10-04 22:14 America/Sao_Paulo (UTC-03:00)'. */
  function titleOf(t, tz) {
    const s = formatDateTime(t, tz);
    return s ? `${s} ${zoneOf(tz)} (${offsetLabel(t, tz)})` : '';
  }

  /** The line an agent's turn context carries (a line per turn, not the system prompt: the prompt cache stays). */
  function nowLine(tz, now = Date.now()) {
    return `Owner's time zone: ${zoneOf(tz)} (${offsetLabel(now, tz)}); local time now: ${formatDateTime(now, tz)}. Report times in this zone; event stamps ending in Z are UTC.`;
  }

  /** The IANA zones for a select (the runtime's list, the given ones and UTC included), sorted. */
  function zones(...extra) {
    let list = [];
    try { list = Intl.supportedValuesOf('timeZone'); } catch { list = []; }
    return [...new Set([...list, 'UTC', systemZone(), ...extra.filter(Boolean)])].sort();
  }

  /** The renderer's zone: the workspace setting (state.settings, app.js), else the computer's. */
  function current() {
    const g = typeof state !== 'undefined' ? state : {};
    return zoneOf(g.settings?.timeZone);
  }

  // open screens that show times redraw when the zone is loaded or changed (app.js, Settings)
  const listeners = [];
  const onChange = (fn) => { listeners.push(fn); };
  let notified = null;
  function notify() {
    const zone = current();
    if (zone === notified) return;
    notified = zone;
    for (const fn of listeners) { try { fn(zone); } catch (e) { console.error(e); } }
  }

  const api = {
    current,
    dayKey,
    formatDate,
    formatDateTime,
    formatLocale,
    formatTime,
    inputValue,
    monthKey,
    nextAt,
    nextDay,
    nextMonth,
    notify,
    nowLine,
    offsetLabel,
    onChange,
    parseInput,
    shiftDay,
    startOfDay,
    startOfDayKey,
    startOfMonth,
    startOfWeek,
    systemZone,
    titleOf,
    zoneOf,
    zones,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimeZone = api;
})(typeof window !== 'undefined' ? window : globalThis);
