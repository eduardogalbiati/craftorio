// #327 / #328 acceptance tests (written before the code): Settings › General › Language, drawn from its
// own file apps/desktop/renderer/views/settings/settings-language.js (like settings-phone.js), which exposes
// window.LanguageSettings = { markup(settings), patch(settings, kind, value) }:
// - markup: the group's HTML, with an "AI agents" select (data-testid settings-language-agents:
//   "Same as the interface" (value "interface", the default) then every language) and an "Issues"
//   select (data-testid settings-language-issues: every language, English by default), options from
//   packages/shared/language.js LANGUAGES, the saved values selected;
// - patch: what Save sends to settings:set, both values together ({ language: { agents, issues } }).
// Run in a vm sandbox with the real Select (apps/desktop/renderer/select.js) and Language modules; compared as
// strings. settings.js mounts it in General next to Time zone, and index.html loads both scripts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderer = path.join(__dirname, '..', 'renderer');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// #329: the page's window.I18n (packages/shared/i18n.js; its Node instance here, with the catalogs) and a
// bare `t` alias, when the module exists
function i18nGlobals() {
  try {
    const I18n = require('@multiagent/shared/i18n.js');
    return { I18n, t: (...a) => I18n.t(...a) };
  } catch { return {}; }
}

function loadView({ settings = {} } = {}) {
  const sandbox = {
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    $: () => null,
    state: { settings },
    api: { setSettings: async (p) => p },
    console,
    ...i18nGlobals(),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(renderer, 'select.js'), sandbox);
  vm.runInContext(read(__dirname, '..', '..', '..', 'packages', 'shared', 'language.js'), sandbox);
  vm.runInContext(read(renderer, 'views', 'settings', 'settings-language.js'), sandbox);
  assert.ok(sandbox.LanguageSettings, 'window.LanguageSettings is defined');
  return sandbox;
}

// the options of the select with this data-testid: [{ value, label, selected }]
function optionsOf(html, testid) {
  const sel = new RegExp(`<select[^>]*data-testid="${testid}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(sel, `a select with data-testid ${testid}`);
  return [...sel[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
    .map((m) => ({ value: m[1], label: m[3], selected: /\bselected\b/.test(m[2]) }));
}

const LANGUAGE_CODES = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ko'];

test('#327 the Language group has an "AI agents" and an "Issues" select', () => {
  const html = loadView().LanguageSettings.markup({});
  assert.match(html, /Language/);
  assert.match(html, /AI agents/);
  assert.match(html, /Issues/);
});

test('#327 AI agents: "Same as the interface" first (value interface), then every language; selected by default', () => {
  const opts = optionsOf(loadView().LanguageSettings.markup({}), 'settings-language-agents');
  // #424 adds the language it resolves to after the label ("Same as the interface (English)")
  assert.deepEqual({ ...opts[0], label: opts[0].label.startsWith('Same as the interface') }, { value: 'interface', label: true, selected: true });
  assert.deepEqual(opts.slice(1).map((o) => o.value), LANGUAGE_CODES);
  assert.equal(opts.find((o) => o.value === 'pt-BR').label, 'Português (Brasil)');
});

test('#328 Issues: every language and no "Same as the interface"; English selected by default', () => {
  const opts = optionsOf(loadView().LanguageSettings.markup({}), 'settings-language-issues');
  assert.deepEqual(opts.map((o) => o.value), LANGUAGE_CODES);
  assert.deepEqual(opts.filter((o) => o.selected).map((o) => o.value), ['en']);
});

test('#327 the saved languages are the selected options', () => {
  const settings = { language: { agents: 'pt-BR', issues: 'es' } };
  const html = loadView({ settings }).LanguageSettings.markup(settings);
  assert.deepEqual(optionsOf(html, 'settings-language-agents').filter((o) => o.selected).map((o) => o.value), ['pt-BR']);
  assert.deepEqual(optionsOf(html, 'settings-language-issues').filter((o) => o.selected).map((o) => o.value), ['es']);
});

test('#327 changing one select saves both values as settings.language', () => {
  const { LanguageSettings } = loadView();
  assert.deepEqual(JSON.parse(JSON.stringify(LanguageSettings.patch({ language: { agents: 'interface', issues: 'es' } }, 'agents', 'pt-BR'))),
    { language: { agents: 'pt-BR', issues: 'es' } });
  assert.deepEqual(JSON.parse(JSON.stringify(LanguageSettings.patch({}, 'issues', 'pt-BR'))),
    { language: { agents: 'interface', issues: 'pt-BR' } });
});

test('#327 settings.js mounts the Language group in General, and index.html loads its scripts', () => {
  const settingsSrc = read(renderer, 'views', 'settings', 'settings.js');
  assert.match(settingsSrc, /LanguageSettings/);
  const html = read(renderer, 'index.html');
  assert.match(html, /<script src="\.\.\/\.\.\/\.\.\/packages\/shared\/language\.js"><\/script>/);
  assert.match(html, /<script src="views\/settings\/settings-language\.js"><\/script>/);
  assert.ok(html.indexOf('views/settings/settings-language.js') < html.indexOf('views/settings/settings.js'), 'loaded before settings.js');
});

// ---- #329 the Interface select, and Settings drawn in the interface language --------------------
// The group gets an "Interface" select (data-testid settings-language-interface): the languages with a
// catalog (I18n.languages()), the saved settings.language.interface selected, else the language the
// page runs in (I18n.getLanguage(): the computer's when it has a catalog, else English). A change saves
// settings.language.interface with the other two values. Settings' markup (every script of
// views/settings/, in index.html's order) is drawn with I18n.t: in pt-BR the General tab reads "Geral".
const loadI18n = () => require('@multiagent/shared/i18n.js');

function settingsMarkup(lang) {
  const I18n = loadI18n();
  I18n.setLanguage(lang);
  try {
    const defs = [];
    const sandbox = loadView();
    sandbox.registerView = (def) => { defs.push(def); };
    const html = read(renderer, 'index.html');
    const scripts = [...html.matchAll(/<script src="(views\/settings\/[^"]+)"><\/script>/g)].map((m) => m[1])
      .filter((src) => src !== 'views/settings/settings-language.js');
    for (const src of scripts) vm.runInContext(read(renderer, ...src.split('/')), sandbox, { filename: src });
    const def = defs.find((d) => d.id === 'settings');
    assert.ok(def, 'settings registers its view');
    return typeof def.markup === 'function' ? def.markup() : def.markup;
  } finally {
    I18n.setLanguage('en');
  }
}

test('#329 the Language group has an Interface select listing the languages with a catalog', () => {
  const { languages } = loadI18n();
  const opts = optionsOf(loadView().LanguageSettings.markup({}), 'settings-language-interface');
  const values = opts.map((o) => o.value);
  assert.ok(values.includes('en') && values.includes('pt-BR'), values.join(', '));
  assert.deepEqual([...values].sort(), Array.from(languages()).sort());
});

test('#329 Interface: the saved settings.language.interface is selected', () => {
  const settings = { language: { agents: 'interface', issues: 'en', interface: 'pt-BR' } };
  const html = loadView({ settings }).LanguageSettings.markup(settings);
  assert.deepEqual(optionsOf(html, 'settings-language-interface').filter((o) => o.selected).map((o) => o.value), ['pt-BR']);
});

test('#329 Interface: nothing saved, the language the page runs in is selected', () => {
  const I18n = loadI18n();
  I18n.setLanguage('pt-BR');
  try {
    const html = loadView().LanguageSettings.markup({});
    assert.deepEqual(optionsOf(html, 'settings-language-interface').filter((o) => o.selected).map((o) => o.value), ['pt-BR']);
  } finally {
    I18n.setLanguage('en');
  }
});

test('#329 Interface: a change saves settings.language.interface with the agents and issues values', () => {
  const { LanguageSettings } = loadView();
  const patch = JSON.parse(JSON.stringify(LanguageSettings.patch({ language: { agents: 'es', issues: 'fr' } }, 'interface', 'pt-BR')));
  assert.deepEqual(patch, { language: { agents: 'es', issues: 'fr', interface: 'pt-BR' } });
  // changing the agents' language keeps the saved interface language
  const kept = JSON.parse(JSON.stringify(LanguageSettings.patch({ language: { agents: 'interface', issues: 'en', interface: 'pt-BR' } }, 'agents', 'es')));
  assert.deepEqual(kept, { language: { agents: 'es', issues: 'en', interface: 'pt-BR' } });
});

// ---- #424 "Same as the interface" names the language it resolves to -------------------------------
// The AI agents' default option reads "Same as the interface (<language>)": the saved interface
// language, else the language the page runs in (the computer's when it has a catalog, else English),
// named as Language.labelOf names it; the text comes from the catalog through t().
const agentsDefault = (settings, lang = 'en') => {
  const I18n = loadI18n();
  I18n.setLanguage(lang);
  try {
    return optionsOf(loadView({ settings }).LanguageSettings.markup(settings), 'settings-language-agents')[0];
  } finally {
    I18n.setLanguage('en');
  }
};

test('#424 interface unset, the page in English: "Same as the interface (English)"', () => {
  const opt = agentsDefault({});
  assert.equal(opt.value, 'interface');
  assert.ok(opt.label.startsWith('Same as the interface'), opt.label);
  assert.ok(opt.label.includes('(English)'), opt.label);
});

test('#424 interface saved as pt-BR, the page still in English: "Same as the interface (Português (Brasil))"', () => {
  const opt = agentsDefault({ language: { agents: 'interface', interface: 'pt-BR' } });
  assert.ok(opt.label.startsWith('Same as the interface'), opt.label);
  assert.ok(opt.label.includes('(Português (Brasil))'), opt.label);
});

test('#424 interface unset, the page in pt-BR (the computer\'s language): the label names Português (Brasil), in Portuguese', () => {
  const opt = agentsDefault({}, 'pt-BR');
  assert.equal(opt.value, 'interface');
  assert.ok(opt.label.includes('Português (Brasil)'), opt.label);
  assert.doesNotMatch(opt.label, /Same as the interface/);
  assert.notEqual(opt.label, loadI18n().t('settings.language.same_as_interface', null, 'pt-BR'), 'the resolved language is named');
});

test('#424 an explicit agents language: the default option still names the interface\'s language, the explicit one stays selected', () => {
  const settings = { language: { agents: 'es', interface: 'pt-BR' } };
  const I18n = loadI18n();
  try {
    const opts = optionsOf(loadView({ settings }).LanguageSettings.markup(settings), 'settings-language-agents');
    assert.ok(opts[0].label.includes('Português (Brasil)'), opts[0].label);
    assert.deepEqual(opts.filter((o) => o.selected).map((o) => o.value), ['es']);
  } finally {
    I18n.setLanguage('en');
  }
});

test('#329 Settings in pt-BR: the General tab reads "Geral"; in English "General"', () => {
  const pt = settingsMarkup('pt-BR');
  assert.match(pt, />\s*Geral\s*</);
  assert.doesNotMatch(pt, />\s*General\s*</);
  assert.match(settingsMarkup('en'), />\s*General\s*</);
});
