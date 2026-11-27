// #95: the Product Owner's "Editar" form and the Roadmap item editor draw a bundled workflow's inputs from
// WorkflowInputs.localized(wf). A choice input keeps the control its own (English) texts give it: a language
// whose labels are longer (pt-BR "Escrever e rodar", 16 characters, over the pills' limit) never turns the
// pills into a select, and one whose labels are shorter never turns a select into pills. Booleans and
// `multiple` inputs keep their own controls; a custom workflow without catalog keys is drawn as it is.
// Seam: WorkflowInputs.fieldHtml (the control's markup: .wi-kind-<kind>, role="radiogroup", <select>) on the
// real workflows/feature.yaml.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const I18n = require('@craftorio/shared/i18n');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = (origin = 'bundled') => {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'feature.yaml'), 'utf8'));
  return { ...doc, name: doc.metadata.name, description: doc.metadata.description, file: 'feature.yaml', ...(origin ? { origin } : {}) };
};
const field = (wf, key) => WorkflowInputs.fieldHtml(key, wf.inputs[key]);
const kindOf = (html) => (html.match(/wi-kind-([a-z]+)/) || [])[1] || null;
const pillTexts = (html) => Array.from(html.matchAll(/role="radio"[^>]*>([^<]*)</g), (m) => m[1]);
const choiceKeys = (wf) => Object.keys(wf.inputs).filter((k) => Array.isArray(wf.inputs[k].enum) && !wf.inputs[k].multiple);

test.afterEach(() => I18n.setLanguage('en'));

test('#95 pt-BR: E2E tests, Unit tests and Test order stay pills with the translated texts', () => {
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(load());
  const html = ['e2e_tests', 'unit_tests', 'test_order'].map((k) => field(shown, k));
  assert.deepEqual(html.map((h) => [kindOf(h), h.includes('role="radiogroup"'), h.includes('<select')]), [['pills', true, false], ['pills', true, false], ['pills', true, false]]);
  assert.deepEqual(pillTexts(html[0]), ['Desligado', 'Escrever', 'Escrever e rodar']);
});

test('#95 pt-BR: Review stays a select, as its English labels make it', () => {
  const english = kindOf(field(WorkflowInputs.localized(load()), 'review'));
  I18n.setLanguage('pt-BR');
  const html = field(WorkflowInputs.localized(load()), 'review');
  assert.deepEqual([english, kindOf(html), html.includes('<select')], ['select', 'select', true]);
});

test('#95 pt-BR: every choice input of feature.yaml keeps the control of its English texts', () => {
  const raw = load();
  const own = Object.fromEntries(choiceKeys(raw).map((k) => [k, kindOf(field(raw, k))]));
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(raw);
  assert.deepEqual(Object.fromEntries(choiceKeys(raw).map((k) => [k, kindOf(field(shown, k))])), own);
});

test('#95 pt-BR: a boolean input stays a switch and a multiple one stays a group of toggles', () => {
  const raw = load();
  const bool = Object.keys(raw.inputs).find((k) => raw.inputs[k].type === 'boolean');
  const multi = Object.keys(raw.inputs).find((k) => Array.isArray(raw.inputs[k].enum) && raw.inputs[k].multiple);
  assert.deepEqual([typeof bool, typeof multi], ['string', 'string'], 'feature.yaml has a boolean and a multiple input');
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(raw);
  assert.deepEqual([kindOf(field(shown, bool)), kindOf(field(shown, multi))], ['switch', 'multi']);
});

test('#95 pt-BR: a custom workflow without catalog keys is drawn with its own texts and controls', () => {
  const custom = load(null);
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(custom);
  assert.deepEqual(choiceKeys(custom).filter((k) => field(shown, k) !== field(custom, k)), []);
});

test('#95 pt-BR: localizing twice gives the same controls and texts', () => {
  I18n.setLanguage('pt-BR');
  const once = WorkflowInputs.localized(load());
  const twice = WorkflowInputs.localized(once);
  assert.deepEqual(choiceKeys(once).filter((k) => field(twice, k) !== field(once, k)), []);
});

test('#95 English: the localized workflow draws every input as the file does', () => {
  const raw = load();
  const shown = WorkflowInputs.localized(raw);
  assert.deepEqual(Object.keys(raw.inputs).filter((k) => kindOf(field(shown, k)) !== kindOf(field(raw, k))), []);
});
