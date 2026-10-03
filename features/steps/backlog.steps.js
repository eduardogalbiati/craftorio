// Steps of features/backlog.feature and features/visual.feature (#222): the Backlog's Board (list,
// kanban) and Roadmap on the demo project, and their visual baselines. Locators are roles and
// data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const board = (page) => page.getByTestId('backlog-board');

When('I open the Board as a kanban', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(board(page)).toBeVisible();
});

When('I open the Roadmap', async ({ e2e }) => {
  await e2e.window.getByRole('tab', { name: 'Roadmap', exact: true }).click();
});

Then('the board shows the column {string}', async ({ e2e }, name) => {
  await expect(board(e2e.window).getByRole('heading', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
});

Then('the board shows the issue {string}', async ({ e2e }, title) => {
  await expect(board(e2e.window).getByRole('link', { name: title, exact: true })).toBeVisible();
});

Then('the board shows the label {string}', async ({ e2e }, label) => {
  await expect(board(e2e.window).getByText(label, { exact: true }).first()).toBeVisible();
});

Then('the roadmap shows at least {int} stages', async ({ e2e }, n) => {
  const stages = e2e.window.getByTestId('roadmap-stage');
  await expect(stages.first()).toBeVisible();
  expect(await stages.count()).toBeGreaterThanOrEqual(n);
});

Then('the roadmap shows the item {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByTestId('roadmap-item').filter({ hasText: title }).first()).toBeVisible();
});

// the demo roadmap's item whose start was refused (#196)
const refused = (page) => page.getByTestId('roadmap-item').filter({ has: page.getByRole('button', { name: 'Retry', exact: true }) }).first();

Then('a refused item offers Retry and Skip, enabled', async ({ e2e }) => {
  const item = refused(e2e.window);
  await expect(item.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(item.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
});

Then('the roadmap bar says why the start was refused and offers {string}', async ({ e2e }, button) => {
  const page = e2e.window;
  await expect(page.getByText(/Could not start #\d+/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
});

When('I click {string} in the roadmap bar', async ({ e2e }, button) => {
  await e2e.window.getByRole('button', { name: button, exact: true }).click();
});

Then('the refused item is in view', async ({ e2e }) => {
  await expect(refused(e2e.window)).toBeInViewport();
});

Then('the board looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(board(e2e.window)).toHaveScreenshot(name);
});
