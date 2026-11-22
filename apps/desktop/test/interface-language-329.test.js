// #329 packages/ui-kit/interface-language.js: window.InterfaceLanguage.apply(settings) shows the
// interface language of the settings (else the computer's when it has a catalog, else English),
// remembers it for the next first paint, paints index.html's static data-i18n hooks and, only when the
// language changed, redraws the window (menu labels, screens, shell, then I18n.notify()). A pushed
// 'settings:changed' applies the new settings in every window.
// Evaluated in a vm sandbox with a small fake document and a fresh copy of packages/shared/i18n.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'interface-language.js'), 'utf8');
const I18N_PATH = require.resolve('@craftorio/shared/i18n.js');

/** A fresh i18n instance (its language and listeners are module state). */
function freshI18n() {
  delete require.cache[I18N_PATH];
  const I18n = require(I18N_PATH);
  delete require.cache[I18N_PATH];
  return I18n;
}

function setup({ systemLanguage = 'en-US' } = {}) {
  const I18n = freshI18n();
  const calls = { relabelNav: 0, redrawMarkup: 0, render: 0, notify: 0 };
  I18n.onChange(() => { calls.notify += 1; });
  const stored = {};
  const hooks = {
    text: { dataset: { i18n: 'common.cancel' }, textContent: '' },
    title: { dataset: { i18nTitle: 'settings.tabs.general' }, title: '' },
    aria: { dataset: { i18nAriaLabel: 'settings.tabs.general' }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
  };
  const bySelector = {
    '[data-i18n]': [hooks.text],
    '[data-i18n-title]': [hooks.title],
    '[data-i18n-aria-label]': [hooks.aria],
  };
  let pushed = null;
  const sandbox = {
    console,
    I18n,
    t: I18n.t,
    navigator: { language: systemLanguage },
    localStorage: { setItem(k, v) { stored[k] = v; }, getItem: (k) => stored[k] ?? null },
    document: { documentElement: {}, querySelectorAll: (sel) => bySelector[sel] || [] },
    api: { onSettingsChanged(fn) { pushed = fn; } },
    state: { settings: {} },
    render() { calls.render += 1; },
    ViewRegistry: {
      relabelNav() { calls.relabelNav += 1; },
      redrawMarkup() { calls.redrawMarkup += 1; },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, I18n, calls, stored, hooks, push: (s) => pushed(s), apply: (s) => sandbox.InterfaceLanguage.apply(s) };
}

const counts = (calls) => ({ ...calls });

test('#329 choosing Portuguese redraws the window once: menu, screens, shell and the listeners', () => {
  const env = setup();
  env.apply({ language: { interface: 'pt-BR' } });
  assert.deepEqual(counts(env.calls), { relabelNav: 1, redrawMarkup: 1, render: 1, notify: 1 });
  assert.equal(env.I18n.getLanguage(), 'pt-BR');
  assert.equal(env.sandbox.document.documentElement.lang, 'pt-BR');
});

test('#329 applying the same language again redraws nothing', () => {
  const env = setup();
  env.apply({ language: { interface: 'pt-BR' } });
  env.apply({ language: { interface: 'pt-BR' } });
  assert.deepEqual(counts(env.calls), { relabelNav: 1, redrawMarkup: 1, render: 1, notify: 1 });
});

test('#329 the shown language is remembered for the next first paint', () => {
  const env = setup();
  env.apply({ language: { interface: 'pt-BR' } });
  assert.equal(env.stored.interfaceLanguage, 'pt-BR');
  env.apply({ language: { interface: 'en' } });
  assert.equal(env.stored.interfaceLanguage, 'en');
});

test('#329 the static hooks of index.html are painted in the language', () => {
  const env = setup();
  env.apply({ language: { interface: 'pt-BR' } });
  assert.equal(env.hooks.text.textContent, 'Cancelar');
  assert.equal(env.hooks.title.title, 'Geral');
  assert.equal(env.hooks.aria.attrs['aria-label'], 'Geral');
});

test('#329 nothing chosen: the computer\'s language when it has a catalog', () => {
  const env = setup({ systemLanguage: 'pt-BR' });
  env.apply({ language: {} });
  assert.equal(env.I18n.getLanguage(), 'pt-BR');
  assert.equal(env.calls.render, 1);
});

test('#329 nothing chosen and a computer language without a catalog: English, the window is not redrawn', () => {
  const env = setup({ systemLanguage: 'de-DE' });
  env.apply({});
  assert.equal(env.I18n.getLanguage(), 'en');
  assert.deepEqual(counts(env.calls), { relabelNav: 0, redrawMarkup: 0, render: 0, notify: 0 });
  assert.equal(env.hooks.text.textContent, 'Cancel');
});

test('#329 a pushed settings:changed applies the new language and keeps the settings', () => {
  const env = setup();
  const settings = { language: { interface: 'pt-BR', agents: 'interface' } };
  env.push(settings);
  assert.equal(env.I18n.getLanguage(), 'pt-BR');
  assert.equal(env.sandbox.state.settings.language.interface, 'pt-BR');
  assert.equal(env.calls.render, 1);
});
