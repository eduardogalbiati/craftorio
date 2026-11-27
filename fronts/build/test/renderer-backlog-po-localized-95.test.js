// #95: in pt-BR the Product Owner's recommendation (its decisions, "Mais" lines and "Editar" form) shows a
// bundled workflow's input labels and values with the same texts as the Roadmap item editor
// (WorkflowInputs.localized: workflow_texts.feature_<key>_label / _opt_<value>), while what goes on the
// roadmap stays the option's value. English, and a custom workflow without catalog keys, keep their texts.
// Acceptance tests written before the code. Harness: backlog-po-785-harness.js (the whole page); the
// installed feature.yaml is listed as the app lists a bundled copy (`origin: 'bundled'`), quick.yaml is a
// custom copy of the same inputs (no origin, no catalog keys).
const test = require('node:test');
const assert = require('node:assert/strict');
const { FEATURE, QUICK, openDrawer, recommendation, click, isHidden, byTestId, textOf } = require('./backlog-po-785-harness');

const BUNDLED = { ...FEATURE, origin: 'bundled' };
const openCard = (group = {}, language = 'pt-BR') => openDrawer({
  history: recommendation(group),
  language,
  api: { listWorkflows: async () => [BUNDLED, QUICK] },
});
const card = (page) => page.$('#po-log .po-group');
const line = (page, key) => byTestId(card(page), `po-decision-${key}`);
const valueOf = (page, key) => textOf(line(page, key)?.querySelector('.po-decision-value') ?? null);
const labelOf = (page, key) => textOf(line(page, key)?.querySelector('.po-decision-label') ?? null);
const form = (page) => byTestId(card(page), 'po-decisions-form');
const editToggle = (page) => click(page, byTestId(card(page), 'po-decisions-edit'), '"Editar"');
const pill = (page, key, value) => form(page)?.querySelector(`.wi-field[data-wi-key="${key}"] [data-wi-pill="${value}"]`) ?? null;
const addToRoadmap = (page) => click(page, card(page).querySelector('[data-po-act="roadmap"]'), '"Colocar no roadmap"');

// ---- the decisions summary --------------------------------------------------------------------------------

test('#95 pt-BR: the Tests decisions show the values as the Roadmap does', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.deepEqual(['test_order', 'unit_tests', 'e2e_tests', 'screenshots'].map((k) => valueOf(page, k)),
    ['Código primeiro', 'Escrever e rodar', 'Desligado', 'Desligado']);
});

test('#95 pt-BR: a decision\'s label is the Roadmap\'s too', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.deepEqual([labelOf(page, 'e2e_tests'), labelOf(page, 'screenshots')], ['Testes E2E', 'Capturas de tela']);
});

test('#95 pt-BR: a value the PO chose is shown translated', { timeout: 30000 }, async () => {
  const page = await openCard({ inputs: { e2e_tests: 'write', screenshots: 'changed' } });
  assert.deepEqual([valueOf(page, 'e2e_tests'), valueOf(page, 'screenshots')], ['Escrever', 'Telas alteradas']);
});

test('#95 pt-BR: a "Mais" line shows its value translated', { timeout: 30000 }, async () => {
  const page = await openCard();
  await click(page, byTestId(card(page), 'po-decisions-more'), '"Mais"');
  assert.deepEqual([isHidden(line(page, 'suite_red_outside_change')), valueOf(page, 'suite_red_outside_change')], [false, 'Perguntar']);
});

// ---- the "Editar" form ----------------------------------------------------------------------------------

test('#95 pt-BR: the "Editar" form names the options as the Roadmap does', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editToggle(page);
  assert.deepEqual(['off', 'write', 'write_and_run'].map((v) => textOf(pill(page, 'e2e_tests', v))), ['Desligado', 'Escrever', 'Escrever e rodar']);
});

test('#95 pt-BR: a value picked in the form reads translated once the form is closed', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editToggle(page);
  await click(page, pill(page, 'e2e_tests', 'write'), 'e2e_tests\'s write');
  await editToggle(page);
  assert.equal(valueOf(page, 'e2e_tests'), 'Escrever');
});

// ---- what reaches the roadmap ---------------------------------------------------------------------------

test('#95 pt-BR: a value picked in the form goes to the roadmap as the option\'s value, not its label', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editToggle(page);
  await click(page, pill(page, 'e2e_tests', 'write'), 'e2e_tests\'s write');
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{ e2e_tests: 'write' }]);
});

test('#95 pt-BR: a value the PO chose goes to the roadmap unchanged', { timeout: 30000 }, async () => {
  const page = await openCard({ inputs: { screenshots: 'changed' } });
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => ({ workflow: g.workflow, inputs: g.inputs })), [{ workflow: 'feature.yaml', inputs: { screenshots: 'changed' } }]);
});

// ---- English and custom workflows -------------------------------------------------------------------------

test('#95 English: the bundled workflow keeps its English texts', { timeout: 30000 }, async () => {
  const page = await openCard({}, null);
  assert.deepEqual([labelOf(page, 'e2e_tests'), valueOf(page, 'e2e_tests'), valueOf(page, 'test_order')], ['E2E tests', 'Off', 'Code first']);
});

test('#95 pt-BR: a custom workflow without catalog keys shows its own texts', { timeout: 30000 }, async () => {
  const page = await openCard({ workflow: 'quick.yaml' });
  assert.deepEqual([labelOf(page, 'e2e_tests'), valueOf(page, 'e2e_tests'), valueOf(page, 'test_order')], ['E2E tests', 'Off', 'Code first']);
});
