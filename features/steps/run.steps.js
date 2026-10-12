// Steps of features/run.feature (#222): the Start panel, a simulated run of the demo project, its
// gate card; the "Developer effort" field next to "Developer model" (#286). Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

// a simulated run of software-development reaches its first gate in well under a minute
const GATE_TIMEOUT = 120000;

When('I open the Start panel', async ({ e2e }) => {
  await e2e.window.getByTestId('quick-start').click();
  await expect(e2e.window.getByTestId('start-workflow')).toBeVisible();
});

When('I pick {string} for {string}', async ({ e2e }, option, field) => {
  await e2e.window.getByRole('radiogroup', { name: field }).getByRole('radio', { name: option, exact: true }).click();
});

Then('{string} offers {string}, {string} and {string}', async ({ e2e }, field, a, b, c) => {
  const group = e2e.window.getByRole('radiogroup', { name: field });
  for (const name of [a, b, c]) await expect(group.getByRole('radio', { name, exact: true })).toBeVisible();
});

Then('{string} is selected for {string}', async ({ e2e }, option, field) => {
  await expect(e2e.window.getByRole('radiogroup', { name: field }).getByRole('radio', { name: option, exact: true })).toHaveAttribute('aria-checked', 'true');
});

When('I start a simulated run with the task {string}', async ({ e2e }, task) => {
  const page = e2e.window;
  if (!(await page.getByTestId('start-workflow').isVisible())) await page.getByTestId('quick-start').click();
  await page.getByTestId('start-main-input').fill(task);
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

Then('the run is running', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-status')).not.toHaveAttribute('data-status', 'idle', { timeout: 30000 });
});

Then('a gate card waits for my approval', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-gate').first()).toBeVisible({ timeout: GATE_TIMEOUT });
});

Then('the gate card shows its summary and its buttons', async ({ e2e }) => {
  const card = e2e.window.getByTestId('run-gate').first();
  await expect(card).toContainText('Approval required');
  await expect(card).toContainText('step:');
  const buttons = card.getByTestId('run-gate-choice');
  await expect(buttons.first()).toBeEnabled();
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
});

Then('the run shows the pill {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('input-pill').filter({ hasText: text }).first()).toBeVisible({ timeout: 30000 });
});

// #233: Analytics › Run and the run page mark an estimated cost (a timed-out attempt) and an old
// run's stopped attempt ("cost not recorded")
When('I open the {string} Analytics tab', async ({ e2e }, name) => {
  await e2e.window.getByRole('tablist', { name: 'Analytics' }).getByRole('tab', { name, exact: true }).click();
});

// picks the run whose id contains `fragment` (searched first: the list shows the latest 80)
When('I pick the run {string} in Analytics', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await page.getByTestId('an-run-search').fill(fragment);
  const option = page.getByTestId('an-run-pick').locator(`option[value*="${fragment}"]`);
  await expect(option).toHaveCount(1, { timeout: 30000 });
  await page.getByTestId('an-run-pick').selectOption(await option.getAttribute('value'));
  await expect(page.getByTestId('an-run-header')).toContainText(fragment, { timeout: 30000 });
});

Then('the run\'s total cost in Analytics is marked as estimated', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('an-run-total-cost')).toContainText(/estimated/i);
});

Then('the cost of the agent {string} in Analytics is marked as estimated', async ({ e2e }, agent) => {
  await expect(e2e.window.getByTestId('an-agent-cost').filter({ hasText: agent }).first()).toContainText(/estimated/i);
});

// #308: Analytics › Run's "Tokens per agent" counts the sub-agents' model calls in the agent's
// tokens; a bar (data-testid an-agent-tokens) shows "of which sub-agents: n calls, m tokens"
// (data-testid an-agent-subagents) only when the agent's turns started sub-agents
const agentTokens = (page, agent) => page.getByTestId('an-agent-tokens').filter({ hasText: agent }).first();

Then('the tokens of the agent {string} in Analytics show {int} sub-agent calls and their tokens', async ({ e2e }, agent, calls) => {
  const line = agentTokens(e2e.window, agent).getByTestId('an-agent-subagents');
  await expect(line).toBeVisible({ timeout: 30000 });
  await expect(line).toContainText(new RegExp(`of which sub-agents: ${calls} calls?, [\\d.,]+\\s*[kKM]? tokens`));
});

Then('the tokens of the agent {string} in Analytics show its total and its cost per million tokens', async ({ e2e }, agent) => {
  const bar = agentTokens(e2e.window, agent);
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar).toContainText(/\d/);
  await expect(bar).toContainText(/\/M/);
});

Then('the tokens of the agent {string} in Analytics show no sub-agent line', async ({ e2e }, agent) => {
  const bar = agentTokens(e2e.window, agent);
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar.getByTestId('an-agent-subagents')).toHaveCount(0);
  await expect(bar).not.toContainText(/sub-agents/i);
});

When('I open the run from Analytics', async ({ e2e }) => {
  await e2e.window.getByTestId('an-run-header').getByRole('button', { name: 'Open run', exact: true }).click();
});

Then('the run\'s total cost is marked as estimated', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-total-cost')).toContainText(/estimated/i, { timeout: 30000 });
});

Then('the run\'s {string} session shows {string}', async ({ e2e }, agent, text) => {
  const card = e2e.window.getByTestId('run-session-card').filter({ hasText: new RegExp(agent, 'i') }).first();
  await expect(card).toContainText(text, { timeout: 30000 });
});

// #183: a human gate's "Interact with Oracle" button opens the Oracle's drawer beside the gate, with
// a context chip (the run, the issue, the step, the branch) and starter questions about the gate
const gateCard = (page) => page.getByTestId('run-gate').first();
const oracleDrawer = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });
const contextChip = (page) => oracleDrawer(page).getByTestId('oracle-context-chip');

When('I click the gate\'s "Interact with Oracle" button', async ({ e2e }) => {
  const button = gateCard(e2e.window).getByTestId('gate-oracle');
  await expect(button).toHaveAccessibleName(/Interact with Oracle/);
  await button.click();
});

Then('the Oracle drawer opens', async ({ e2e }) => {
  await expect(oracleDrawer(e2e.window)).toBeVisible();
});

// the choices can still be clicked: nothing (the drawer, a backdrop) lies over them
Then('the gate card is still in view with its choices enabled', async ({ e2e }) => {
  const card = gateCard(e2e.window);
  await expect(card).toBeInViewport();
  const choices = card.getByTestId('run-gate-choice');
  expect(await choices.count()).toBeGreaterThanOrEqual(2);
  for (const choice of await choices.all()) {
    await expect(choice).toBeEnabled();
    const onTop = await choice.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop, `the choice "${await choice.textContent()}" is covered`).toBe(true);
  }
});

Then('the Oracle\'s question box shows a context chip naming the gate\'s run and step', async ({ e2e }) => {
  const card = gateCard(e2e.window);
  const runId = await card.getAttribute('data-run');
  const step = (await card.textContent()).match(/step:\s*([\w.-]+)/)?.[1];
  expect(step, 'the gate card names its step').toBeTruthy();
  const chip = contextChip(e2e.window);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`Run ${runId}`);
  await expect(chip).toContainText(step);
});

Then('the Oracle suggests {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const drawer = oracleDrawer(e2e.window);
  for (const name of [a, b, c, d]) await expect(drawer.getByRole('button', { name, exact: true })).toBeEnabled();
});

When('I remove the Oracle\'s context chip', async ({ e2e }) => {
  await contextChip(e2e.window).getByRole('button', { name: /Remove/ }).click();
});

Then('the Oracle\'s question box has no context chip', async ({ e2e }) => {
  await expect(contextChip(e2e.window)).toHaveCount(0);
});

When('I ask the Oracle the suggested question {string}', async ({ e2e }, question) => {
  await oracleDrawer(e2e.window).getByRole('button', { name: question, exact: true }).click();
});

// the simulated Oracle (MULTIAGENT_SIMULATION_ONLY) answers without a model: "Simulated Oracle: ..."
Then('the Oracle shows a simulated answer', async ({ e2e }) => {
  await expect(oracleDrawer(e2e.window)).toContainText('Simulated Oracle', { timeout: 30000 });
});

// #286: the developer's effort (developer_effort: default | low | medium | high | xhigh), a row of
// pills next to "Developer model" wherever the workflow's inputs are drawn (WorkflowInputs.fieldHtml):
// the Start panel, the Assign dialog, a roadmap item's Edit. Found by role (a pill row is a
// radiogroup named by its label); no new data-testid.
const visibleGroup = (page, name) => page.getByRole('radiogroup', { name, exact: true }).filter({ visible: true }).first();

When('I choose the workflow {string} in the Start panel', async ({ e2e }, name) => {
  const page = e2e.window;
  if (!(await page.getByTestId('start-workflow').isVisible())) await page.getByTestId('quick-start').click();
  await page.getByRole('combobox', { name: 'Workflow', exact: true }).selectOption(`${name}.yaml`);
});

// the field right after the other one in the same form; in the Start panel both may sit in
// "Advanced parameters", opened first when the field is hidden there
Then('the field {string} comes right after {string}', async ({ e2e }, field, before) => {
  const page = e2e.window;
  if (!(await visibleGroup(page, before).isVisible())) {
    const advanced = page.getByText('Advanced parameters', { exact: true }).filter({ visible: true });
    if (await advanced.count()) await advanced.first().click();
  }
  await expect(visibleGroup(page, before)).toBeVisible();
  await expect(visibleGroup(page, field)).toBeVisible();
  const next = await visibleGroup(page, before).evaluate((el) => {
    const own = el.closest('.wi-field') || el.parentElement;
    return own?.nextElementSibling?.querySelector('label')?.textContent?.trim() || '';
  });
  expect(next.startsWith(field), `the field after "${before}" is "${next}"`).toBe(true);
});

// each value matches a pill whose label reads as it ("High" → high, "Extra high" or "XHigh" →
// xhigh), in that order and no other pill
Then('{string} offers the choices {string}, {string}, {string}, {string} and {string}', async ({ e2e }, field, a, b, c, d, e) => {
  const radios = visibleGroup(e2e.window, field).getByRole('radio');
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '').replace(/^extra/, 'x');
  await expect(radios).toHaveCount(5);
  expect((await radios.allTextContents()).map(norm)).toEqual([a, b, c, d, e].map(norm));
});
