// #85 Settings › Execution › Base check shows Off when nothing is saved, and its help says the check is
// off by default. Acceptance tests written before the code.
//
// Seams: the Settings markup (packages/ui-kit/views/settings/settings-markup.js window.SettingsMarkup,
// drawn in a vm with the real packages/ui-kit/select.js and the English catalog), settings.js's fill of
// the select from state.settings (pulled out of the source, as renderer-settings.test.js does for the
// control channel switch), the settings a new workspace reads (packages/engine/domains/workspace/settings.js
// readSettings), the catalogs packages/shared/i18n/en.json and pt-BR.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { t } = require('./settings-source-329');

const DIR = path.join(__dirname, '..', 'views', 'settings');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'i18n', `${lang}.json`), 'utf8'));

// the base check select's options as [value, selected] from the drawn markup
function drawnBaseCheckSelect() {
  const sandbox = { t, selfHealingHtml: () => '', appUpdateHtml: () => '', console };
  sandbox.window = sandbox;
  sandbox.Select = require('../select');
  vm.createContext(sandbox);
  vm.runInContext(read('settings-markup.js'), sandbox);
  const html = String(sandbox.SettingsMarkup());
  const select = /<select\b[^>]*id="set-base-check-on-red"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, 'the base check select (id="set-base-check-on-red") is in the markup');
  return [...select[1].matchAll(/<option\b([^>]*)>/g)].map((m) => [/value="([^"]*)"/.exec(m[1])?.[1] ?? null, /\sselected\b/.test(m[1])]);
}

// settings.js's fill of the select from `settings`, run in a sandbox → the value it shows
function filledValue(settings) {
  const fill = /\$\('#set-base-check-on-red'\)\.value = [^\n]*/.exec(read('settings.js'));
  assert.ok(fill, 'the base check select\'s fill not found in settings.js: the source moved');
  const el = { value: '' };
  const sandbox = { state: { settings }, $: (sel) => (sel === '#set-base-check-on-red' ? el : null) };
  vm.createContext(sandbox);
  vm.runInContext(fill[0], sandbox);
  return String(el.value);
}

test('#85 Settings › Execution › Base check: the markup selects Off', () => {
  const selected = drawnBaseCheckSelect().filter(([, on]) => on).map(([v]) => v);
  assert.deepEqual(selected, ['off']);
});

test('#85 Settings › Execution › Base check: a new workspace (no settings.json) shows Off', (t2) => {
  const { readSettings } = require('@craftorio/engine/domains/workspace/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-85-'));
  t2.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(filledValue(readSettings({ settings: path.join(dir, 'settings.json') })), 'off');
});

test('#85 Settings › Execution › Base check: settings without baseCheck show Off', () => {
  assert.equal(filledValue({}), 'off');
});

test('#85 Settings › Execution › Base check: a saved fix shows fix, a saved issue shows issue, a saved off shows off', () => {
  assert.deepEqual(['fix', 'issue', 'off'].map((onRed) => filledValue({ baseCheck: { onRed } })), ['fix', 'issue', 'off']);
});

test('#85 the base check help says it is off by default (en)', () => {
  assert.match(catalog('en')['settings.base.on_red_help'], /off by default/i);
});

test('#85 the base check help says it is off by default (pt-BR)', () => {
  assert.match(catalog('pt-BR')['settings.base.on_red_help'], /(deslig|desativ)\w* por padr[ãa]o/i);
});
