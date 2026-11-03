// Steps of fronts/build/features/backlog.feature (#445) and backlog-plan-roadmap-605.feature (#446): the
// plain queue is retired, so the Backlog never draws a queue bar (data-testid="queue-bar") nor the
// "Queue: #n failed: resume to start the next issues." alert, whatever a failed roadmap run did.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;

const alerts = (page) => page.getByTestId('page-alerts').filter({ visible: true }).first();
const shownAlert = (page) => alerts(page).getByTestId('page-alert').filter({ visible: true }).first();

Then('the Backlog shows no queue bar', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-item').or(page.getByTestId('backlog-list')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('queue-bar').filter({ visible: true })).toHaveCount(0);
});

Then('the alerts no longer show {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(page.getByTestId('page-alert').filter({ hasText: text }).filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  // nor behind the arrows: every alert is walked through once
  const counter = alerts(page).getByTestId('alerts-counter');
  if (await counter.count()) {
    const total = Number((await counter.innerText()).trim().split('/')[1]) || 1;
    for (let k = 0; k < total; k += 1) {
      await expect(shownAlert(page)).not.toContainText(text);
      await alerts(page).getByRole('button', { name: 'Next alert', exact: true }).click();
    }
  }
});
