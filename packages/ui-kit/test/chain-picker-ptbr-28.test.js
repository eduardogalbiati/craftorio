// #28 acceptance, written before the code: the "Quando terminar" select of packages/ui-kit/chain-picker.js (its
// option labels come from packages/shared/chain-model.js) follows the interface language. chain-picker.js is
// evaluated in a vm sandbox with the real ChainModel and the shared I18n set to pt-BR; the select's options are
// read back from the markup it writes.
//
// The contract assumed here: in pt-BR none of the four options shows its English label (Nothing / Start a
// workflow with it / Ask the Product Owner to place it in the roadmap / Plan the issues (Roadmap)), nor a raw
// catalog key; each option has a non-empty label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const ChainModel = require('@craftorio/shared/chain-model');

const ENGLISH = ['Nothing', 'Start a workflow with it', 'Ask the Product Owner to place it in the roadmap', 'Plan the issues (Roadmap)'];

function actionOptionsInPortuguese() {
  const el = {
    innerHTML: '',
    querySelector: (sel) => (sel === '[data-cp-action]' || sel === '[data-cp-wf]' ? {} : null),
    querySelectorAll: () => [],
  };
  const sandbox = { ChainModel, WorkflowInputs: { label: (k) => k }, api: {}, I18n, t: I18n.t, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chain-picker.js'), 'utf8'), sandbox);
  const before = I18n.getLanguage();
  I18n.setLanguage('pt-BR');
  try {
    sandbox.ChainPicker.mount(el, { workflows: () => [], source: () => ({ name: 'issue', outputs: { issues: {} } }) });
  } finally {
    I18n.setLanguage(before);
  }
  const select = /<select[^>]*data-cp-action[^>]*>([\s\S]*?)<\/select>/.exec(el.innerHTML);
  assert.ok(select, 'the picker writes a [data-cp-action] select');
  return [...select[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2].trim()]);
}

test('#28 pt-BR "Quando terminar": no option shows its English label', () => {
  const options = actionOptionsInPortuguese();
  assert.deepEqual(options.map(([v]) => v), ['none', 'workflow', 'product_owner', 'queue']);
  assert.deepEqual(options.filter(([, label]) => ENGLISH.includes(label)).map(([v]) => v), []);
});

test('#28 pt-BR "Quando terminar": every option has a label, none a raw catalog key', () => {
  const options = actionOptionsInPortuguese();
  assert.deepEqual(options.filter(([, label]) => !label || /^[a-z_]+\.[a-z0-9_.]+$/.test(label)).map(([v]) => v), []);
});
