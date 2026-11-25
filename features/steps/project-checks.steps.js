// Steps of features/50-project-checks.feature (#50): the checks found in a project (its linter and type
// checker) shown before a run, on the project's settings and in the Start panel.
// Opening the project's settings and the Start panel reuses fronts/build/features/steps/projects.steps.js and
// run.steps.js; Save and a setting's checkbox are project-settings.steps.js's.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - inside data-testid="project-settings" (existing):
//   - data-testid="project-check-commands" (NEW): the commands found in the project's folder, each as it
//     would run ("npm run lint", "npm run typecheck");
//   - a textbox named "Check commands" (NEW): the owner's own commands, instead of the ones found;
//   - a checkbox named "Run the project's checks" (NEW), on by default: off runs none;
// - data-testid="start-check-commands" (NEW): in the Start panel, for a workflow with the check step, the
//   commands the run will use, or that they are off (data-state="off"); refreshed after the project's settings
//   are saved, whatever was read before.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const visible = (locator) => locator.filter({ visible: true });
const settings = (page) => visible(page.getByTestId('project-settings')).first();
const found = (page) => settings(page).getByTestId('project-check-commands');
const startChecks = (page) => visible(page.getByTestId('start-check-commands')).first();

// the demo project's folder (features/support/app.js seeds its package.json): two scripts that run on their
// own (no dependency to install) and no `check` script
Given('the demo project has a lint script and a typecheck script, and no check script', async ({ e2e }) => {
  const folder = e2e.project?.folder;
  if (!folder) throw new Error('the demo project has no folder: open the app on the demo workspace first');
  fs.mkdirSync(folder, { recursive: true });
  for (const name of ['lint', 'typecheck']) fs.writeFileSync(path.join(folder, `${name}.js`), `console.log('${name}: ok');\n`);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({
    name: 'demo-app',
    private: true,
    scripts: { start: 'node server.js', lint: 'node lint.js', typecheck: 'node typecheck.js' },
  }, null, 2));
});

Then('the project settings show the checks found {string} and {string}', async ({ e2e }, a, b) => {
  const list = found(e2e.window);
  await expect(list).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const command of [a, b]) await expect(list).toContainText(command, { timeout: LOAD_TIMEOUT });
});

When('I change the project\'s check commands to {string}', async ({ e2e }, command) => {
  const box = settings(e2e.window).getByRole('textbox', { name: 'Check commands', exact: true });
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await box.fill(command);
});

When('I turn off {string} in the project settings', async ({ e2e }, label) => {
  const box = settings(e2e.window).getByRole('checkbox', { name: label, exact: true });
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await box.uncheck();
});

Then('the Start panel shows the check {string}', async ({ e2e }, command) => {
  const checks = startChecks(e2e.window);
  await expect(checks).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(checks).toContainText(command, { timeout: LOAD_TIMEOUT });
});

// asked after a step that saw what the panel does show, so it is drawn by now
Then('the Start panel does not show the check {string}', async ({ e2e }, command) => {
  await expect(startChecks(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(startChecks(e2e.window)).not.toContainText(command);
});

Then('the Start panel says the project\'s checks are off', async ({ e2e }) => {
  const checks = startChecks(e2e.window);
  await expect(checks).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(checks).toHaveAttribute('data-state', 'off', { timeout: LOAD_TIMEOUT });
  await expect(checks).toContainText(/\boff\b/i);
});
