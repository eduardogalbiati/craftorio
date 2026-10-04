// Steps of features/run.feature (#222): the Start panel, a simulated run of the demo project, its
// gate card. Locators are roles and data-testid only (skills/ui-conventions).

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
  await expect(e2e.window.getByTestId('run-status')).not.toHaveText('idle', { timeout: 30000 });
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
