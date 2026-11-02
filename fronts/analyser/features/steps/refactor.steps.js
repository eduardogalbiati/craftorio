// Steps of projects.feature's Refactor tab without an Architecture report (#354, #357). #730 removed the
// Refactor tab (the findings become issues from the Health tab, views/project/project-health.js) and
// fronts/analyser/features/refactor.feature with it (the Product Owner's ranking, "Dismiss", the cadence
// switch); these two steps stay while projects.feature names them. Locators are roles and data-testid
// only (skills/ui-conventions): #project-panel-refactor, data-testid="refactor-state-no-report" (a link or
// button naming the Architecture tab opens it), "refactor-proposal".

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const tab = (page) => projectPage(page).locator('#project-panel-refactor');
const byId = (page, id) => visible(tab(page).getByTestId(id)).first();

Then('the Refactor tab says the project has no Architecture report yet', async ({ e2e }) => {
  const state = byId(e2e.window, 'refactor-state-no-report');
  await expect(state).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(state).toContainText(/architecture/i);
  await expect(visible(tab(e2e.window).getByTestId('refactor-proposal')), 'no proposal without a report').toHaveCount(0);
});

When('I open the Architecture tab from the Refactor tab', async ({ e2e }) => {
  const state = byId(e2e.window, 'refactor-state-no-report');
  const name = /architecture/i;
  const go = state.getByRole('link', { name }).or(state.getByRole('button', { name })).first();
  await expect(go).toBeVisible({ timeout: LOAD_TIMEOUT });
  await go.click();
});

