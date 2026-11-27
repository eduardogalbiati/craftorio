// #110 acceptance, written before the code: Settings › General › Language's "Issues" select defaults to English; it
// must default to the interface language, as the AI agents' select does ("Same as the interface"). Seams:
// - the group's markup (packages/ui-kit/views/settings/settings-language.js, window.LanguageSettings.markup) in a vm
//   sandbox with the real Select and Language modules, as renderer-settings-language-327.test.js loads it: the option
//   selected in the Issues select names Português (Brasil) (either the language itself or "Same as the interface
//   (Português (Brasil))", whichever value the change saves);
// - packages/shared/language.js issuesLanguage(settings): the language the engine writes issues, PRs and commits in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

function loadView(settings, pageLanguage) {
  const I18n = require('@craftorio/shared/i18n.js');
  I18n.setLanguage(pageLanguage);
  const sandbox = {
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    $: () => null,
    state: { settings },
    api: { setSettings: async (p) => p },
    console,
    I18n,
    t: (...a) => I18n.t(...a),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(__dirname, '..', 'select.js'), sandbox);
  vm.runInContext(read(ROOT, 'packages', 'shared', 'language.js'), sandbox);
  vm.runInContext(read(__dirname, '..', 'views', 'settings', 'settings-language.js'), sandbox);
  assert.ok(sandbox.LanguageSettings, 'window.LanguageSettings is defined');
  return String(sandbox.LanguageSettings.markup(settings));
}

// the selected option of the select with this data-testid: { value, label }
function selectedOf(html, testid) {
  const sel = new RegExp(`<select[^>]*data-testid="${testid}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(sel, `a select with data-testid ${testid}`);
  const options = [...sel[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], label: m[3], selected: /\bselected\b/.test(m[2]) }));
  const chosen = options.filter((o) => o.selected);
  assert.equal(chosen.length, 1, 'one option selected');
  return { value: chosen[0].value, label: chosen[0].label };
}

test.afterEach(() => require('@craftorio/shared/i18n.js').setLanguage('en'));

test('#110 Settings › Language: with the interface saved as pt-BR and no Issues setting, Issues shows Português (Brasil)', () => {
  const html = loadView({ language: { interface: 'pt-BR' } }, 'pt-BR');
  const { value, label } = selectedOf(html, 'settings-language-issues');
  assert.equal(label.includes('Português (Brasil)'), true, `selected: ${value} "${label}"`);
});

test('#110 Settings › Language: with nothing saved and the page in pt-BR, Issues shows Português (Brasil)', () => {
  const html = loadView({}, 'pt-BR');
  const { value, label } = selectedOf(html, 'settings-language-issues');
  assert.equal(label.includes('Português (Brasil)'), true, `selected: ${value} "${label}"`);
});

test('#110 issuesLanguage: no Issues setting follows the interface language (pt-BR), as agentsLanguage does', () => {
  const Language = require('@craftorio/shared/language.js');
  assert.equal(Language.issuesLanguage({ language: { interface: 'pt-BR' } }), 'pt-BR');
});

test('#110 guard: a chosen Issues language stays as chosen', () => {
  const Language = require('@craftorio/shared/language.js');
  assert.equal(Language.issuesLanguage({ language: { interface: 'pt-BR', issues: 'es' } }), 'es');
  const { value } = selectedOf(loadView({ language: { interface: 'pt-BR', issues: 'es' } }, 'pt-BR'), 'settings-language-issues');
  assert.equal(value, 'es');
});
