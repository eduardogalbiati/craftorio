// Steps of features/app.feature and features/settings.feature (#222): open the app, move through the
// sidebar, Settings. Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const sidebar = (page) => page.getByRole('navigation');
// a sidebar item by its label; a count badge may follow it ("Backlog 2")
const navItem = (page, name) => sidebar(page).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+\\d+)?$`) });

Given('the app is open', async ({ e2e }) => {
  await e2e.open();
});

Given('the app is open in the {word} theme', async ({ e2e }, theme) => {
  await e2e.open({ theme });
});

When('I open {string} in the sidebar', async ({ e2e }, name) => {
  await navItem(e2e.window, name).click();
});

When('I reload the app', async ({ e2e }) => {
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the sidebar offers {string}', async ({ e2e }, name) => {
  await expect(navItem(e2e.window, name)).toBeVisible();
});

Then('the run status shows {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('run-status')).toHaveText(text);
});

Then('the Start a workflow button is enabled', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('quick-start')).toBeEnabled();
});

When('I open the {string} settings tab', async ({ e2e }, name) => {
  await e2e.window.getByRole('button', { name, exact: true }).click();
});

When('I choose {string} as the default development workflow', async ({ e2e }, file) => {
  // fails when the workflow is not offered
  await e2e.window.getByTestId('settings-default-workflow').selectOption(file);
});

Then('the default development workflow is {string}', async ({ e2e }, file) => {
  await expect(e2e.window.getByRole('combobox', { name: 'Default development workflow' })).toHaveValue(file);
});
