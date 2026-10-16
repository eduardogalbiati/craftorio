// #327 / #328 acceptance tests (written before the code): Settings › General › Language, drawn from its
// own file src/renderer/views/settings/settings-language.js (like settings-phone.js), which exposes
// window.LanguageSettings = { markup(settings), patch(settings, kind, value) }:
// - markup: the group's HTML, with an "AI agents" select (data-testid settings-language-agents:
//   "Same as the interface" (value "interface", the default) then every language) and an "Issues"
//   select (data-testid settings-language-issues: every language, English by default), options from
//   src/shared/language.js LANGUAGES, the saved values selected;
// - patch: what Save sends to settings:set, both values together ({ language: { agents, issues } }).
// Run in a vm sandbox with the real Select (src/renderer/select.js) and Language modules; compared as
// strings. settings.js mounts it in General next to Time zone, and index.html loads both scripts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

function loadView({ settings = {} } = {}) {
  const sandbox = {
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    $: () => null,
    state: { settings },
    api: { setSettings: async (p) => p },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(renderer, 'select.js'), sandbox);
  vm.runInContext(read(__dirname, '..', 'src', 'shared', 'language.js'), sandbox);
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
  assert.deepEqual(opts[0], { value: 'interface', label: 'Same as the interface', selected: true });
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
  assert.match(html, /<script src="\.\.\/shared\/language\.js"><\/script>/);
  assert.match(html, /<script src="views\/settings\/settings-language\.js"><\/script>/);
  assert.ok(html.indexOf('views/settings/settings-language.js') < html.indexOf('views/settings/settings.js'), 'loaded before settings.js');
});
