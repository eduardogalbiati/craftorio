// #785: a recommendation's card shows the workflow and its inputs grouped and readable, each with its
// source and the PO's reason, editable in place; adding it to the roadmap sends only what was chosen.
// Acceptance tests written before the code. Harness: backlog-po-785-harness.js (the whole page, a
// fork-code backend project through api.projectInputHints' `runDefaults`, the answer built by the
// engine's normalizeAnswer).
// Contract the developer provides (chosen here; the ids agreed with the BDD scenarios):
// - po-recommendation-decisions: the block; po-decision-group-run / -tests / -agents: its groups, each
//   titled ("How it runs", "Tests", "Agents"); po-decision-<input key> (po-decision-workflow for the
//   workflow): one line with its label, value, source and the PO's reason;
// - po-decisions-more: "Mais", which shows the advanced lines; po-decisions-edit: "Editar", which
//   expands po-decisions-form and, clicked again, collapses it to the summary;
// - po-decisions-workflow: the workflow <select> of the form, whose fields are WorkflowInputs' (.wi-field);
// - a line changed in the form carries data-changed="true" on the summary;
// - [data-po-act="roadmap"] stays the button, in pt-BR "Colocar no roadmap".
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDrawer, recommendation, click, isHidden, byTestId, textOf, settle } = require('./backlog-po-785-harness');

const REASON = 'E2E off: projeto backend sem UI';
const openCard = (group, options = {}) => openDrawer({ history: recommendation(group), ...options });
const card = (page) => page.$('#po-log .po-group');
const decisions = (page) => byTestId(card(page), 'po-recommendation-decisions');
const line = (page, key) => byTestId(card(page), `po-decision-${key}`);
const form = (page) => byTestId(card(page), 'po-decisions-form');
const keysIn = (page, group) => {
  const box = byTestId(card(page), `po-decision-group-${group}`);
  return Array.from(box?.querySelectorAll('[data-testid^="po-decision-"]') || []).filter((el) => !isHidden(el)).map((el) => el.getAttribute('data-testid').replace('po-decision-', ''));
};
const editOpen = async (page) => click(page, byTestId(card(page), 'po-decisions-edit'), '"Editar"');
const pickOption = (page, key, value) => click(page, form(page)?.querySelector(`.wi-field[data-wi-key="${key}"] [data-wi-pill="${value}"]`) ?? null, `${key}'s ${value}`);
const addToRoadmap = (page) => click(page, card(page).querySelector('[data-po-act="roadmap"]'), '"Colocar no roadmap"');
const addAll = (page) => click(page, page.$('#po-log [data-po-act="roadmap-all"]'), '"Add all to the roadmap"');

// ---- the summary --------------------------------------------------------------------------------------

test('#785 the card shows the decisions block instead of the chip list', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.deepEqual([decisions(page) === null, Array.from(card(page).querySelectorAll('[data-testid="input-pill"]')).length], [false, 0]);
});

test('#785 How it runs groups the workflow, Mode, Validation and Review', { timeout: 30000 }, async () => {
  assert.deepEqual(keysIn(await openCard(), 'run'), ['workflow', 'mode', 'validation', 'review']);
});

test('#785 Tests groups Test order, Unit tests, E2E tests and Screenshots', { timeout: 30000 }, async () => {
  assert.deepEqual(keysIn(await openCard(), 'tests'), ['test_order', 'unit_tests', 'e2e_tests', 'screenshots']);
});

test('#785 Agents groups Developer model and Developer effort', { timeout: 30000 }, async () => {
  assert.deepEqual(keysIn(await openCard(), 'agents'), ['developer_model', 'developer_effort']);
});

test('#785 the groups are titled How it runs, Tests and Agents', { timeout: 30000 }, async () => {
  const page = await openCard();
  const titled = ['run', 'tests', 'agents'].map((g) => textOf(byTestId(card(page), `po-decision-group-${g}`)));
  assert.deepEqual([titled[0].startsWith('How it runs'), titled[1].startsWith('Tests'), titled[2].startsWith('Agents')], [true, true, true]);
});

test('#785 pt-BR: the group titles are translated', { timeout: 30000 }, async () => {
  const page = await openCard({}, { language: 'pt-BR' });
  const text = textOf(byTestId(card(page), 'po-decision-group-run'));
  assert.deepEqual([text === '', text.startsWith('How it runs')], [false, false]);
});

test('#785 a line reads a plain label and value, never the raw key or value', { timeout: 30000 }, async () => {
  const text = textOf(line(await openCard(), 'unit_tests'));
  assert.deepEqual([text.includes('Unit tests'), text.includes('Write and run'), /unit_tests|write_and_run/.test(text)], [true, true, false]);
});

test('#785 the shown value comes from the project over the workflow\'s default', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.deepEqual([textOf(line(page, 'mode')).includes('Fork + PR'), textOf(line(page, 'test_order')).includes('Code first')], [true, true]);
});

test('#785 pt-BR: a project value says "do projeto"', { timeout: 30000 }, async () => {
  assert.equal(textOf(line(await openCard({}, { language: 'pt-BR' }), 'e2e_tests')).includes('do projeto'), true);
});

test('#785 pt-BR: a workflow default says "do workflow"', { timeout: 30000 }, async () => {
  assert.equal(textOf(line(await openCard({}, { language: 'pt-BR' }), 'unit_tests')).includes('do workflow'), true);
});

test('#785 pt-BR: a value the PO chose says "neste item"', { timeout: 30000 }, async () => {
  assert.equal(textOf(line(await openCard({ inputs: { validation: 'validated' } }, { language: 'pt-BR' }), 'validation')).includes('neste item'), true);
});

test('#785 a line shows the PO\'s reason for that input', { timeout: 30000 }, async () => {
  const page = await openCard({ inputs: { e2e_tests: 'off' }, input_reasons: { e2e_tests: REASON } });
  assert.equal(textOf(line(page, 'e2e_tests')).includes(REASON), true);
});

// ---- Mais -----------------------------------------------------------------------------------------------

const ADVANCED = ['ui_folders', 'steps_folders', 'test_command', 'check_command', 'git_platform', 'suite_red_outside_change'];

test('#785 the advanced inputs wait behind "Mais"', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.equal(byTestId(card(page), 'po-decisions-more') === null, false, 'the card has "Mais"');
  assert.deepEqual(ADVANCED.filter((k) => !isHidden(line(page, k))), []);
});

test('#785 "Mais" shows the advanced inputs', { timeout: 30000 }, async () => {
  const page = await openCard();
  await click(page, byTestId(card(page), 'po-decisions-more'), '"Mais"');
  assert.deepEqual(ADVANCED.filter((k) => isHidden(line(page, k))), []);
});

test('#785 pt-BR: the controls read "Mais", "Editar" and "Colocar no roadmap"', { timeout: 30000 }, async () => {
  const page = await openCard({}, { language: 'pt-BR' });
  const texts = [byTestId(card(page), 'po-decisions-more'), byTestId(card(page), 'po-decisions-edit'), card(page).querySelector('[data-po-act="roadmap"]')].map(textOf);
  assert.deepEqual(texts, ['Mais', 'Editar', 'Colocar no roadmap']);
});

// ---- Editar ---------------------------------------------------------------------------------------------

test('#785 the form is closed until "Editar"', { timeout: 30000 }, async () => {
  const page = await openCard();
  assert.deepEqual([byTestId(card(page), 'po-decisions-edit') === null, isHidden(form(page))], [false, true]);
});

test('#785 "Editar" expands the form with the same controls, starting from the shown values', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  const value = (k) => form(page)?.querySelector(`[data-wi-input="${k}"]`)?.value ?? null;
  assert.deepEqual([isHidden(form(page)), value('mode'), value('e2e_tests'), value('unit_tests')], [false, 'fork', 'off', 'write_and_run']);
});

test('#785 the form offers the workflow, starting on the one the PO chose', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  const select = byTestId(form(page), 'po-decisions-workflow');
  assert.equal(select?.value ?? null, 'feature.yaml');
});

test('#785 what the owner set in the form survives a redraw of the drawer', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  page.document.dispatchEvent(new page.dom.classes.Event('backlog:data'));
  await settle(30);
  assert.equal(form(page)?.querySelector('[data-wi-input="e2e_tests"]')?.value ?? null, 'write');
});

test('#785 collapsing shows the summary with the new value', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await editOpen(page);
  assert.deepEqual([isHidden(form(page)), textOf(line(page, 'e2e_tests')).includes('Write')], [true, true]);
});

test('#785 collapsing marks the changed line, and only it', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await editOpen(page);
  const marked = Array.from(decisions(page).querySelectorAll('[data-changed="true"]')).map((el) => el.getAttribute('data-testid'));
  assert.deepEqual(marked, ['po-decision-e2e_tests']);
});

test('#785 pt-BR: a value the owner changed says "neste item"', { timeout: 30000 }, async () => {
  const page = await openCard({}, { language: 'pt-BR' });
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await editOpen(page);
  assert.equal(textOf(line(page, 'e2e_tests')).includes('neste item'), true);
});

// ---- what reaches the roadmap ------------------------------------------------------------------------------

test('#785 an untouched recommendation adds no inputs to the roadmap', { timeout: 30000 }, async () => {
  const page = await openCard();
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{}]);
});

test('#785 opening and closing the form changes nothing that is sent', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await editOpen(page);
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{}]);
});

test('#785 a change in the form sends only that key', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{ e2e_tests: 'write' }]);
});

test('#785 a change joins what the PO chose', { timeout: 30000 }, async () => {
  const page = await openCard({ inputs: { validation: 'validated' } });
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{ validation: 'validated', e2e_tests: 'write' }]);
});

test('#785 a value put back to the shown default is not sent', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await pickOption(page, 'e2e_tests', 'off');
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.inputs), [{}]);
});

test('#785 the workflow changed in the form goes to the roadmap', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  const select = byTestId(form(page), 'po-decisions-workflow');
  assert.equal(select === null, false, 'the form\'s workflow select');
  select.value = 'quick.yaml';
  select.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
  await addToRoadmap(page);
  assert.deepEqual(page.added.map((g) => g.workflow), ['quick.yaml']);
});

test('#785 "Add all to the roadmap" sends the same chosen inputs', { timeout: 30000 }, async () => {
  const page = await openCard();
  await editOpen(page);
  await pickOption(page, 'e2e_tests', 'write');
  await addAll(page);
  assert.deepEqual(page.callsTo('proposeRoadmap').map((a) => a[1].stages[0].items[0].inputs).map((x) => ({ ...x })), [{ e2e_tests: 'write' }]);
});
