// #329 packages/shared/i18n.js in the page (window.I18n): the browser cannot list a folder, so its
// languages are a constant that must stay equal to the files of packages/shared/i18n/; its catalogs are
// read with a synchronous request next to the script (file:// and the server alike); the first paint
// uses the language the page last showed (localStorage 'interfaceLanguage'), else the computer's.
// Evaluated in a vm sandbox with a fake XMLHttpRequest that reads the requested file from disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL, fileURLToPath } = require('url');

const ROOT = path.join(__dirname, '..', '..', '..');
const I18N_JS = path.join(ROOT, 'packages', 'shared', 'i18n.js');
const CATALOG_DIR = path.join(ROOT, 'packages', 'shared', 'i18n');

/** Loads i18n.js as the page does; returns { I18n, t, requests } (requests: { url, async }). */
function loadPage({ cached = null, systemLanguage = 'en-US', failing = [] } = {}) {
  const requests = [];
  class FakeXHR {
    open(method, url, async) { this.url = url; requests.push({ method, url: String(url), async }); }
    send() {
      const file = fileURLToPath(this.url);
      if (failing.some((lang) => file.endsWith(`${lang}.json`))) throw new Error('blocked');
      this.status = 200;
      this.responseText = fs.readFileSync(file, 'utf8');
    }
  }
  const sandbox = {
    console: { error() {}, log() {} },
    XMLHttpRequest: FakeXHR,
    URL,
    Intl,
    document: { currentScript: { src: pathToFileURL(I18N_JS).href } },
    navigator: { language: systemLanguage },
    localStorage: { getItem: (k) => (k === 'interfaceLanguage' ? cached : null), setItem() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(I18N_JS, 'utf8'), sandbox);
  return { I18n: sandbox.I18n, t: sandbox.t, requests };
}

const catalogFiles = () => fs.readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

test('#329 the page lists exactly the languages that have a catalog file', () => {
  const { I18n } = loadPage();
  assert.deepEqual(Array.from(I18n.languages()).sort(), catalogFiles());
});

test('#329 the page reads a catalog next to the script, synchronously, and t() shows its text', () => {
  const { I18n, requests } = loadPage();
  assert.equal(I18n.t('settings.tabs.general', null, 'pt-BR'), 'Geral');
  assert.equal(I18n.t('settings.tabs.general', null, 'en'), 'General');
  const urls = requests.map((r) => r.url.replace(/\\/g, '/'));
  assert.ok(urls.some((u) => u.endsWith('/packages/shared/i18n/pt-BR.json')), urls.join(', '));
  assert.ok(urls.some((u) => u.endsWith('/packages/shared/i18n/en.json')), urls.join(', '));
  assert.equal(requests.every((r) => r.async === false), true, 'every catalog request is synchronous');
});

test('#329 the page reads each catalog once', () => {
  const { I18n, requests } = loadPage();
  I18n.t('common.cancel', null, 'pt-BR');
  I18n.t('settings.tabs.general', null, 'pt-BR');
  I18n.t('common.cancel', null, 'pt-BR');
  const ptRequests = requests.filter((r) => r.url.endsWith('pt-BR.json')).length;
  assert.equal(ptRequests, 1);
});

test('#329 a Portuguese catalog that does not load shows the English text, never the raw key', () => {
  const { I18n } = loadPage({ failing: ['pt-BR'] });
  assert.equal(I18n.t('common.cancel', null, 'pt-BR'), 'Cancel');
});

test('#329 first paint: the language the page last showed, even when the computer\'s differs', () => {
  const { I18n, t } = loadPage({ cached: 'pt-BR', systemLanguage: 'en-US' });
  assert.equal(I18n.getLanguage(), 'pt-BR');
  assert.equal(t('common.cancel'), 'Cancelar');
});

test('#329 first paint with nothing remembered: the computer\'s language when it has a catalog, else English', () => {
  assert.equal(loadPage({ systemLanguage: 'pt-BR' }).I18n.getLanguage(), 'pt-BR');
  assert.equal(loadPage({ systemLanguage: 'de-DE' }).I18n.getLanguage(), 'en');
  assert.equal(loadPage({ cached: 'xx', systemLanguage: 'en-US' }).I18n.getLanguage(), 'en');
});

test('#329 the AI agents\' "Same as the interface" is English while no interface language is saved', () => {
  // the chosen behaviour (decisions #327/#329): the engine never guesses the computer's language
  const { agentsLanguage } = require('../language');
  assert.equal(agentsLanguage({ language: { agents: 'interface' } }), 'en');
  assert.equal(agentsLanguage({ language: {} }), 'en');
  assert.equal(agentsLanguage({}), 'en');
});
