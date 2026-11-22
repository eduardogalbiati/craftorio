// #329 acceptance tests (written before the code): the interface's catalog and its pure helper.
//
// Contract:
// - packages/shared/i18n/en.json (the English source) and packages/shared/i18n/pt-BR.json: flat objects, key →
//   text, or key → { <Intl.PluralRules category>: text } for a plural ("one", "other", ...).
// - packages/shared/i18n.js, dual-load like packages/shared/time-zone.js (module.exports in Node, window.I18n in
//   the page), exports:
//   t(key, params?, lang?) → string: `{name}` placeholders from params; a plural value picks its form
//   with Intl.PluralRules(lang).select(params.count); a key missing in a language (or a language without
//   a catalog) shows the English text, never the raw key; lang omitted → the current language.
//   setLanguage(lang) / getLanguage(); languages() → the codes with a catalog ('en', 'pt-BR');
//   resolveLanguage(chosen, systemLocale) → chosen when it has a catalog, else the system locale when it
//   has one, else 'en'; formatCost(usd, lang) (US$ with the language's separators), formatNumber(n, lang),
//   formatPercent(ratio, lang).
// - The interface choice is saved as settings.language.interface (next to #327's agents / issues), and
//   "Same as the interface" of the AI agents (packages/shared/language.js agentsLanguage) follows it.
//
// Keys these tests require in both catalogs (the only ones named here):
//   common.cancel          en "Cancel"   pt-BR "Cancelar"
//   settings.tabs.general  en "General"  pt-BR "Geral"
//   common.items_count     en { one: "{count} item", other: "{count} items" }
//                          pt-BR { one: "{count} item", other: "{count} itens" }
// The modules do not exist yet: each test requires them itself.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const CATALOGS = path.join(ROOT, 'packages', 'shared', 'i18n');
const load = () => require('@craftorio/shared/i18n.js');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(CATALOGS, `${lang}.json`), 'utf8'));
const spaces = (s) => String(s).replace(/ | /g, ' ');

// every test leaves the current language as it found it
afterEach(() => {
  try { load().setLanguage('en'); } catch { /* the module does not exist yet */ }
});

test('#329 en.json and pt-BR.json hold the keys these tests rely on', () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  assert.equal(en['common.cancel'], 'Cancel');
  assert.equal(pt['common.cancel'], 'Cancelar');
  assert.equal(en['settings.tabs.general'], 'General');
  assert.equal(pt['settings.tabs.general'], 'Geral');
  assert.deepEqual(en['common.items_count'], { one: '{count} item', other: '{count} items' });
  assert.deepEqual(pt['common.items_count'], { one: '{count} item', other: '{count} itens' });
});

test('#329 t: the English text of a key', () => {
  const { t } = load();
  assert.equal(t('common.cancel', {}, 'en'), 'Cancel');
  assert.equal(t('settings.tabs.general', {}, 'en'), 'General');
});

test('#329 t: the Portuguese text of a key', () => {
  const { t } = load();
  assert.equal(t('common.cancel', {}, 'pt-BR'), 'Cancelar');
  assert.equal(t('settings.tabs.general', {}, 'pt-BR'), 'Geral');
});

test('#329 t: {placeholders} are replaced from params', () => {
  const { t } = load();
  const en = catalog('en');
  const key = Object.keys(en).find((k) => typeof en[k] === 'string' && /\{\w+\}/.test(en[k]));
  assert.ok(key, 'en.json has at least one text with a {placeholder}');
  const names = [...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const params = Object.fromEntries(names.map((n) => [n, `VALUE_${n}`]));
  const out = t(key, params, 'en');
  for (const n of names) assert.ok(out.includes(`VALUE_${n}`), `${key}: {${n}} replaced (got "${out}")`);
  assert.doesNotMatch(out, /\{\w+\}/, `${key}: no placeholder left`);
});

test('#329 t: an English plural picks its form from params.count', () => {
  const { t } = load();
  assert.equal(t('common.items_count', { count: 1 }, 'en'), '1 item');
  assert.equal(t('common.items_count', { count: 2 }, 'en'), '2 items');
});

test('#329 t: a Portuguese plural picks its form from params.count', () => {
  const { t } = load();
  assert.equal(t('common.items_count', { count: 1 }, 'pt-BR'), '1 item');
  assert.equal(t('common.items_count', { count: 2 }, 'pt-BR'), '2 itens');
});

test('#329 t: a language without a catalog shows the English text, never the raw key', () => {
  const { t } = load();
  assert.equal(t('common.cancel', {}, 'xx'), 'Cancel');
  assert.equal(t('common.items_count', { count: 2 }, 'xx'), '2 items');
});

test('#329 t: a key missing in pt-BR shows its English text', () => {
  const { t } = load();
  const en = catalog('en');
  const pt = catalog('pt-BR');
  const missing = Object.keys(en).filter((k) => !(k in pt) && typeof en[k] === 'string' && !/\{\w+\}/.test(en[k]));
  // a complete pt-BR catalog: the fallback is the same path as a language without a catalog
  if (!missing.length) return assert.equal(t('common.cancel', {}, 'xx'), 'Cancel');
  for (const k of missing.slice(0, 5)) assert.equal(t(k, {}, 'pt-BR'), en[k], k);
});

test('#329 t: a key missing everywhere returns a string and does not throw', () => {
  const { t } = load();
  assert.equal(typeof t('no.such.key.329', {}, 'pt-BR'), 'string');
  assert.equal(typeof t('no.such.key.329'), 'string');
});

test('#329 languages(): the codes with a catalog file, English and Portuguese included', () => {
  const { languages } = load();
  const list = Array.from(languages());
  assert.ok(list.includes('en'));
  assert.ok(list.includes('pt-BR'));
  const files = fs.readdirSync(CATALOGS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  assert.deepEqual([...list].sort(), [...files].sort());
});

test('#329 resolveLanguage: the chosen language when it has a catalog', () => {
  const { resolveLanguage } = load();
  assert.equal(resolveLanguage('en', 'pt-BR'), 'en');
  assert.equal(resolveLanguage('pt-BR', 'en-US'), 'pt-BR');
});

test('#329 resolveLanguage: nothing chosen, the computer\'s language when it has a catalog', () => {
  const { resolveLanguage } = load();
  assert.equal(resolveLanguage(undefined, 'pt-BR'), 'pt-BR');
  assert.equal(resolveLanguage('', 'pt-BR'), 'pt-BR');
});

test('#329 resolveLanguage: English when neither the choice nor the computer\'s language has a catalog', () => {
  const { resolveLanguage } = load();
  assert.equal(resolveLanguage('', 'de-DE'), 'en');
  assert.equal(resolveLanguage('xx', 'fr'), 'en');
  assert.equal(resolveLanguage(undefined, undefined), 'en');
});

test('#329 formatCost: US$ with Portuguese separators in pt-BR', () => {
  const { formatCost } = load();
  assert.equal(spaces(formatCost(6.48, 'pt-BR')), 'US$ 6,48');
  assert.ok(spaces(formatCost(6.48, 'en')).includes('6.48'));
});

test('#329 formatNumber: the language\'s separators', () => {
  const { formatNumber } = load();
  assert.equal(spaces(formatNumber(1234.5, 'pt-BR')), '1.234,5');
  assert.equal(spaces(formatNumber(1234.5, 'en')), '1,234.5');
});

test('#329 formatPercent: a ratio as a percentage in the language', () => {
  const { formatPercent } = load();
  const pt = spaces(formatPercent(0.25, 'pt-BR'));
  assert.ok(pt.includes('25') && pt.includes('%'), pt);
  assert.equal(spaces(formatPercent(0.25, 'en')), '25%');
});

test('#329 setLanguage / getLanguage: the current language is t\'s and the formatters\' default', () => {
  const { t, setLanguage, getLanguage, formatNumber } = load();
  setLanguage('pt-BR');
  assert.equal(getLanguage(), 'pt-BR');
  assert.equal(t('common.cancel'), 'Cancelar');
  assert.equal(spaces(formatNumber(1234.5)), '1.234,5');
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('common.cancel'), 'Cancel');
});

test('#329 the AI agents\' "Same as the interface" follows settings.language.interface', () => {
  const { agentsLanguage } = require('@craftorio/shared/language');
  assert.equal(agentsLanguage({ language: { agents: 'interface', interface: 'pt-BR' } }), 'pt-BR');
  assert.equal(agentsLanguage({ language: { agents: 'es', interface: 'pt-BR' } }), 'es');
});

test('#329 i18n.js in the page: window.I18n, loaded by index.html before the scripts that use it', () => {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n.js'), 'utf8'), sandbox);
  assert.ok(sandbox.I18n, 'window.I18n is defined');
  for (const fn of ['t', 'setLanguage', 'getLanguage', 'languages']) assert.equal(typeof sandbox.I18n[fn], 'function', fn);
  const html = fs.readFileSync(pageFileOf('index.html'), 'utf8');
  const at = html.indexOf('<script src="../../../packages/shared/i18n.js"></script>');
  assert.ok(at >= 0, 'index.html loads ../../../packages/shared/i18n.js');
  for (const src of ['../../../packages/shared/setup-model.js', '../../../packages/shared/time-zone.js', 'setup.js', 'views/settings/settings.js']) {
    // by the tail of the tag: the UI kit's scripts carry the package's path prefix (phase 3)
    assert.ok(at < html.indexOf(`${src.startsWith('.') ? '' : '/'}${src}"></script>`), `i18n.js loads before ${src}`);
  }
});
