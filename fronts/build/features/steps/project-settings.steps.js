// Steps of the project's settings (#741): since the old New / Edit project dialog is gone, a project card's
// Edit opens the project's page with its settings open (data-testid="project-settings",
// fronts/analyser/views/project/project-settings.js). features/472-install-scripts.feature and
// fronts/build/features/workflows-repository.feature turn the per-project flags on there.
// Opening Edit reuses projects.steps.js ("I choose Edit on the project {string} in the Projects screen").
//
// What the settings expose (the renderer's contract for these steps):
// - data-testid="project-settings": the settings panel, inside data-testid="project-page";
// - each per-project flag is a role="checkbox" named by its label ("Install dependencies without running
//   their scripts", "Prefer the repository's workflows");
// - data-testid="project-settings-save": Save; a toast "Saved the settings of <name>" confirms it.

const { expect } = require('@playwright/test');
const { Then, When } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const visible = (locator) => locator.filter({ visible: true });
const settings = (page) => visible(page.getByTestId('project-settings')).first();
const setting = (page, label) => settings(page).getByRole('checkbox', { name: label, exact: true });

Then('the project settings show {string} turned {word}', async ({ e2e }, label, state) => {
  const box = setting(e2e.window, label);
  await expect(box, `the project setting "${label}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (state === 'on') await expect(box).toBeChecked();
  else if (state === 'off') await expect(box).not.toBeChecked();
  else throw new Error(`"turned ${state}": expected "on" or "off"`);
});

When('I turn on {string} in the project settings', async ({ e2e }, label) => {
  const box = setting(e2e.window, label);
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await box.check();
});

When('I save the project settings', async ({ e2e }) => {
  await settings(e2e.window).getByTestId('project-settings-save').click();
  await expect(e2e.window.getByText(/^Saved the settings of /).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});
