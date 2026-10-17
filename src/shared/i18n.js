// The interface language (#329): the catalogs of src/shared/i18n/ (en.json, the English source, and
// one file per translation: key → text, or key → { <Intl.PluralRules category>: text } for a plural)
// and the one helper every screen, the service's OS notifications and the desktop dialogs use.
// Settings › General › Language › Interface saves settings.language.interface; unset, the computer's
// language when it has a catalog, else English (resolveLanguage). User content, workflow YAML texts,
// agents' messages, engine errors and logs are never translated.
// - t(key, params?, lang?): the text in lang (the current language when omitted), `{name}` replaced
//   from params, a plural's form picked from params.count; a key missing in a language shows the
//   English text, a key missing everywhere the key itself;
// - setLanguage(lang) / getLanguage(); languages(): the codes with a catalog;
// - resolveLanguage(chosen, systemLocale): the language to show ('pt' or 'pt-PT' find 'pt-BR');
// - formatNumber(n, lang?, options?), formatPercent(ratio, lang?), formatCost(usd, lang?, digits = 2):
//   the language's separators; costs stay in US$ ('US$ 6,48' in Portuguese, '$6.48' in English);
// - onChange(fn) / notify(): open screens redraw when the language changes (interface-language.js).
// Browser: window.I18n and window.t, the catalogs read once with a sync request next to this file
// (file:// and the server alike), the first language from localStorage 'interfaceLanguage' else
// navigator.language; Node: module.exports, the catalogs read from disk.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const ENGLISH = 'en';
  // the page cannot list a folder: keep it equal to the files of src/shared/i18n/ (test/i18n-329)
  const PAGE_LANGUAGES = ['en', 'pt-BR'];
  const base = !node && typeof document !== 'undefined' && document.currentScript ? new URL('i18n/', document.currentScript.src).href : null;
  const catalogs = new Map();
  let current = ENGLISH;
  let listed = null;

  function languages() {
    if (!node) return PAGE_LANGUAGES.slice();
    if (!listed) {
      listed = require('fs').readdirSync(require('path').join(__dirname, 'i18n'))
        .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    }
    return listed.slice();
  }

  function readCatalog(lang) {
    try {
      if (node) return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'i18n', `${lang}.json`), 'utf8'));
      if (!base || typeof XMLHttpRequest === 'undefined') return {};
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${base}${lang}.json`, false);
      xhr.send();
      return JSON.parse(xhr.responseText);
    } catch (e) {
      console.error(`i18n: the ${lang} catalog did not load: ${e.message}`);
      return {};
    }
  }

  const has = (lang) => typeof lang === 'string' && languages().includes(lang);
  function catalogOf(lang) {
    if (!has(lang)) return null;
    if (!catalogs.has(lang)) catalogs.set(lang, readCatalog(lang));
    return catalogs.get(lang);
  }

  function pluralOf(value, lang, count) {
    let form = 'other';
    try { form = new Intl.PluralRules(lang).select(Number(count)); } catch { /* an unknown language: other */ }
    return value[form] ?? value.other;
  }

  function t(key, params, lang) {
    const code = lang || current;
    const own = catalogOf(code)?.[key];
    const value = own ?? catalogOf(ENGLISH)?.[key];
    const used = own != null ? code : ENGLISH;
    let text = value == null ? key : typeof value === 'object' ? pluralOf(value, used, params?.count) : value;
    if (params) text = String(text).replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])));
    return String(text);
  }

  /** The chosen language when it has a catalog, else the computer's (or its base language's), else English. */
  function resolveLanguage(chosen, systemLocale) {
    if (has(chosen)) return chosen;
    const sys = String(systemLocale || '').replace('_', '-').toLowerCase();
    if (!sys) return ENGLISH;
    const list = languages();
    return list.find((l) => l.toLowerCase() === sys)
      || list.find((l) => l.split('-')[0].toLowerCase() === sys.split('-')[0])
      || ENGLISH;
  }

  const setLanguage = (lang) => { current = has(lang) ? lang : ENGLISH; };
  const getLanguage = () => current;

  const numberFormat = (lang, options) => {
    try { return new Intl.NumberFormat(lang || current, options); } catch { return new Intl.NumberFormat(ENGLISH, options); }
  };
  const formatNumber = (n, lang, options) => numberFormat(lang, options).format(Number(n) || 0);
  const formatPercent = (ratio, lang, options) => numberFormat(lang, { style: 'percent', maximumFractionDigits: 1, ...options }).format(Number(ratio) || 0);
  const formatCost = (usd, lang, digits = 2) => numberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(usd) || 0);

  // open screens redraw when the language changes (src/renderer/interface-language.js)
  const listeners = [];
  const onChange = (fn) => { listeners.push(fn); };
  function notify() {
    for (const fn of listeners) { try { fn(current); } catch (e) { console.error(e); } }
  }

  const api = {
    formatCost,
    formatNumber,
    formatPercent,
    getLanguage,
    languages,
    notify,
    onChange,
    resolveLanguage,
    setLanguage,
    t,
  };
  if (node) module.exports = api;
  else {
    root.I18n = api;
    root.t = t; // the renderer's templates call t directly
    // the first paint: the language the page last showed, else the computer's (interface-language.js
    // applies the saved setting once the settings are loaded)
    let cached = null;
    try { cached = root.localStorage?.getItem('interfaceLanguage'); } catch { /* no storage */ }
    setLanguage(resolveLanguage(cached, root.navigator?.language));
  }
})(typeof window !== 'undefined' ? window : globalThis);
