// #329 acceptance tests (written before the code): dates and times shown in words follow the
// interface language. packages/shared/time-zone.js (re-exported by src/domains/analytics/time-zone.js) keeps its fixed
// machine formats (dayKey, formatDate '2026-10-04', formatTime '22:14': keys and inputs, #273) and adds
//   formatLocale(t, options, tz, lang) → string: the instant as Intl.DateTimeFormat(lang, options)
//   writes it, in the zone (zoneOf(tz)); lang omitted → the interface language
//   (packages/shared/i18n.js getLanguage()), never undefined / navigator.language.
// Fixed instant: 2026-10-04 22:14 UTC.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../src/domains/analytics/time-zone');
const AT = Date.UTC(2026, 9, 4, 22, 14);

afterEach(() => {
  try { require('@multiagent/shared/i18n.js').setLanguage('en'); } catch { /* the module does not exist yet */ }
});

test('#329 formatLocale: a short date in pt-BR is dd/mm/yyyy, in English m/d/yy', () => {
  const { formatLocale } = load();
  assert.equal(formatLocale(AT, { dateStyle: 'short' }, 'UTC', 'pt-BR'), '04/10/2026');
  assert.equal(formatLocale(AT, { dateStyle: 'short' }, 'UTC', 'en'), '10/4/26');
});

test('#329 formatLocale: month names in the language, in the given zone', () => {
  const { formatLocale } = load();
  assert.match(formatLocale(AT, { month: 'long', day: 'numeric' }, 'UTC', 'pt-BR'), /4 de outubro/);
  assert.match(formatLocale(AT, { month: 'long', day: 'numeric' }, 'UTC', 'en'), /October 4/);
  // 22:14 UTC is already the 5th in Tokyo
  assert.match(formatLocale(AT, { month: 'long', day: 'numeric' }, 'Asia/Tokyo', 'pt-BR'), /5 de outubro/);
});

test('#329 formatLocale: without a language, the interface language set in i18n.js', () => {
  const { formatLocale } = load();
  require('@multiagent/shared/i18n.js').setLanguage('pt-BR');
  assert.equal(formatLocale(AT, { dateStyle: 'short' }, 'UTC'), '04/10/2026');
  require('@multiagent/shared/i18n.js').setLanguage('en');
  assert.equal(formatLocale(AT, { dateStyle: 'short' }, 'UTC'), '10/4/26');
});
