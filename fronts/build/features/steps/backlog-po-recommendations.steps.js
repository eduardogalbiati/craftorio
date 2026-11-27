// Steps of fronts/build/features/product-owner.feature's #785 scenarios: the Product Owner's simpler drawer
// (three suggestions, the others behind "+ opções", no toggle, no options before the answer) and its
// recommendations (grouped decisions, editable in place) whose roadmap item keeps only what was chosen.
// #95: in pt-BR the drawer's decisions and its "Editar" form show the inputs' labels and values translated, as
// the Roadmap item editor does ("Testes E2E", "Desligado", "Escrever"); the roadmap keeps `off` / `write`.
// Reuses backlog.steps.js ("I open the Product Owner", "I click the suggested question {string}", "the
// Product Owner answers", "I open the Roadmap"), run.steps.js ("I pick {string} for {string}", "{string} is
// selected for {string}") and roadmap-item-inputs.steps.js ("I edit the inputs of the roadmap item {string}").
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps), inside the drawer (aside "Product Owner"):
// - po-pill (exists): each suggestion; po-suggestion-more: the "+ opções" pill, not a po-pill itself;
// - po-recommendation-decisions: a recommendation's grouped decisions; po-decision-group-run / -tests /
//   -agents: the groups; po-decision-<input key>: one line (label, value, source text); po-decisions-more:
//   "Mais"; po-decisions-edit: "Editar"; po-decisions-form: the expanded form (WorkflowInputs' controls);
// - the button that puts a recommendation on the roadmap, disabled once it is there (as today).
// In the Roadmap item editor (group "Editar as entradas deste item"):
// - input-<input key> (exists): the control; workflow-input-source-<input key>: its source label.

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const poPills = (page) => poDrawer(page).getByTestId('po-pill');
const morePill = (page) => poDrawer(page).getByTestId('po-suggestion-more');
const decisions = (page) => poDrawer(page).getByTestId('po-recommendation-decisions');
const decision = (page, name) => poDrawer(page).getByTestId(`po-decision-${inputKey(name)}`);
const itemEditor = (page) => page.getByTestId('roadmap-item').getByRole('group', { name: 'Editar as entradas deste item', exact: true });

// the inputs of feature.yaml the scenarios name, by their label: English, or pt-BR as the Roadmap and the drawer
// show them (#95: WorkflowInputs.localized, workflow_texts.feature_<key>_label)
const INPUT_KEYS = {
  'Capturas de tela': 'screenshots',
  'Comando de testes': 'test_command',
  'Developer model': 'developer_model',
  'E2E tests': 'e2e_tests',
  Mode: 'mode',
  'Modelo do desenvolvedor': 'developer_model',
  Modo: 'mode',
  'Ordem dos testes': 'test_order',
  Screenshots: 'screenshots',
  'Test command': 'test_command',
  'Test order': 'test_order',
  'Testes E2E': 'e2e_tests',
};
const GROUPS = { Agents: 'agents', 'How it runs': 'run', Tests: 'tests' };
const CONTROLS = { Editar: 'po-decisions-edit', Mais: 'po-decisions-more' };

function inputKey(name) {
  expect(INPUT_KEYS[name], `the input "${name}" (known: ${Object.keys(INPUT_KEYS).join(', ')})`).toBeTruthy();
  return INPUT_KEYS[name];
}

// ---- the drawer before the answer ---------------------------------------------------------------------

Then('the Product Owner suggests only {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  await expect(poPills(e2e.window)).toHaveText([a, b, c], { timeout: LOAD_TIMEOUT });
});

Then('the Product Owner offers more suggestions behind {string}', async ({ e2e }, label) => {
  await expect(morePill(e2e.window)).toHaveText(label);
});

// the toggle's two buttons: "Registrar uma issue" stays only as a suggestion
Then("the Product Owner's drawer has no toggle between planning and registering an issue", async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await expect(poPills(e2e.window).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer.getByRole('button', { name: 'Planejar o backlog', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Registrar uma issue', exact: true })).toHaveCount(1);
});

Then("the Product Owner's drawer shows no options before its answer", async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await expect(poPills(e2e.window).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer.getByTestId('po-workflow')).toBeHidden();
  await expect(drawer.getByTestId('po-workflow-options')).toBeHidden();
  for (const text of ['Planejar com', 'Mostrar mais opções']) await expect(drawer.getByText(text, { exact: true }).filter({ visible: true }), `"${text}"`).toHaveCount(0);
  for (const name of ['Validation', 'Unit tests', 'E2E tests', 'Screenshots']) await expect(drawer.getByRole('radiogroup', { name }), `the option "${name}"`).toHaveCount(0);
});

When("I open the Product Owner's other suggestions", async ({ e2e }) => {
  await morePill(e2e.window).click();
});

Then('the Product Owner also suggests', async ({ e2e }, table) => {
  for (const { suggestion } of table.hashes()) await expect(poPills(e2e.window).filter({ hasText: suggestion }), `the suggestion "${suggestion}"`).toBeVisible();
});

// ---- a recommendation ----------------------------------------------------------------------------------

async function expectDecision(line, value, source) {
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(value);
  await expect(line).toContainText(source);
}

Then('the recommendation names the workflow {string}', async ({ e2e }, title) => {
  await expect(decisions(e2e.window).getByTestId('po-decision-group-run')).toContainText(title, { timeout: LOAD_TIMEOUT });
});

Then('the recommendation shows these decisions, with no input chips', async ({ e2e }, table) => {
  const page = e2e.window;
  for (const { group, decision: name, value, source } of table.hashes()) {
    expect(GROUPS[group], `the group "${group}" (known: ${Object.keys(GROUPS).join(', ')})`).toBeTruthy();
    await expectDecision(decisions(page).getByTestId(`po-decision-group-${GROUPS[group]}`).getByTestId(`po-decision-${inputKey(name)}`), value, source);
  }
  await expect(poDrawer(page).getByTestId('input-pill')).toHaveCount(0);
});

Then('the recommendation does not show the decision {string}', async ({ e2e }, name) => {
  await expect(decisions(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(decision(e2e.window, name)).toBeHidden();
});

Then("the recommendation's decision {string} shows {string}, marked {string}", async ({ e2e }, name, value, source) => {
  await expectDecision(decision(e2e.window, name), value, source);
});

When('I open {string} on the recommendation', async ({ e2e }, label) => {
  const page = e2e.window;
  expect(CONTROLS[label], `the control "${label}" (known: ${Object.keys(CONTROLS).join(', ')})`).toBeTruthy();
  await poDrawer(page).getByTestId(CONTROLS[label]).click();
  if (label === 'Editar') await expect(poDrawer(page).getByTestId('po-decisions-form')).toBeVisible();
});

// the button is disabled once the recommendation is on the roadmap
When('I put the recommendation on the roadmap with {string}', async ({ e2e }, name) => {
  const button = poDrawer(e2e.window).getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toBeDisabled({ timeout: LOAD_TIMEOUT });
});

When('I close the Product Owner', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await drawer.getByRole('button', { name: /^(Close|Fechar)/ }).first().click();
  await expect(drawer).toBeHidden();
});

// ---- the Roadmap item editor ---------------------------------------------------------------------------

// the value shown by the input's control: a box, a row of pills or a select (WorkflowInputs.kind)
Then('the item editor shows {string} for {string}, marked {string}', async ({ e2e }, value, name, source) => {
  const form = itemEditor(e2e.window);
  const key = inputKey(name);
  const control = form.getByTestId(`input-${key}`);
  await expect(control).toBeAttached({ timeout: LOAD_TIMEOUT });
  const box = await control.evaluate((el) => el.tagName === 'INPUT' && el.type === 'text');
  if (box) await expect(control).toHaveValue(value);
  else await expect(form.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { checked: true }).or(control.locator('option:checked'))).toHaveText(value);
  await expect(form.getByTestId(`workflow-input-source-${key}`)).toHaveText(source);
});
