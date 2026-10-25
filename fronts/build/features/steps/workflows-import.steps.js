// Steps of fronts/build/features/workflows-import.feature (#488): importing a workflow on the Workflows screen's
// Definitions tab. The file is chosen through the screen's file input (setInputFiles, the native
// chooser never opens); the fixtures are features/fixtures/workflows/*.yaml. Opening the screen
// reuses app.steps.js ("I open {string} in the sidebar").
//
// data-testids (skills/ui-conventions):
//   workflow-import-file     the Definitions tab's <input type="file"> behind the Import button
//   workflow-import-dialog   the confirmation before writing (role dialog): what the workflow does
//                            (steps, agents and their tools, action: commands, ship, requires) and
//                            "a workflow is code that runs on this machine"; a name textbox (label
//                            "Name"), buttons Cancel and Import (and Replace when the name exists)
//   workflow-import-errors   the loader's reasons for a rejected import (role alert), nothing written
//   workflow-card            a workspace workflow's card, data-file="<file>.yaml" (existing)
//   workflow-origin-badge    the card's origin badge, "Custom" for an imported workflow (today only the
//                            repository badge carries it: the default / modified / custom ones get it)
// The workspace's workflows folder is <scratch>/workspace/workflows; its file list is kept when the
// import starts, to check that a cancelled or refused import wrote nothing.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');
const { LOAD_TIMEOUT } = require('../../../../features/support/run-screen');

const fixtures = path.join(__dirname, '..', '..', '..', '..', 'features', 'fixtures', 'workflows');
const workflowsDir = (e2e) => path.join(e2e.scratch, 'workspace', 'workflows');
const listWorkflows = (e2e) => {
  try { return fs.readdirSync(workflowsDir(e2e)).sort(); } catch { return []; }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const importDialog = (page) => page.getByTestId('workflow-import-dialog').filter({ visible: true });
const cardOf = (page, file) => page.locator(`[data-testid="workflow-card"][data-file="${file}"]`).filter({ visible: true });

When('I import the workflow file {string} from the Workflows screen', async ({ e2e }, file) => {
  e2e.workflowsBeforeImport = listWorkflows(e2e);
  const input = e2e.window.getByTestId('workflow-import-file');
  await expect(input).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await input.setInputFiles(path.join(fixtures, file));
});

Then('the import warning says a workflow is code that runs on this machine', async ({ e2e }) => {
  const dialog = importDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(dialog).toHaveAttribute('role', /^(alert)?dialog$/);
  await expect(dialog).toContainText(/\bcode\b/i);
  await expect(dialog).toContainText(/runs on this machine/i);
});

Then('the import warning lists the step {string}, the agent {string} with the tool {string} and the command {string}', async ({ e2e }, step, agent, tool, command) => {
  const dialog = importDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(dialog).toContainText(step);
  await expect(dialog).toContainText(new RegExp(`${escapeRe(agent)}[\\s\\S]*\\b${escapeRe(tool)}\\b`));
  await expect(dialog).toContainText(command);
});

When('I import it under the name {string}', async ({ e2e }, name) => {
  const dialog = importDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await dialog.getByRole('textbox', { name: /name/i }).fill(name);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

When('I cancel the import warning', async ({ e2e }) => {
  const dialog = importDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the workflow file {string} is listed on the Workflows screen as a custom workflow', async ({ e2e }, file) => {
  const card = cardOf(e2e.window, file);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('workflow-origin-badge')).toHaveText(/custom/i);
});

Then('no workflow file {string} is listed on the Workflows screen', async ({ e2e }, file) => {
  // the screen is loaded (some workflow card shows) before checking this one is absent
  await expect(e2e.window.getByTestId('workflow-card').filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cardOf(e2e.window, file)).toHaveCount(0);
});

Then('the workspace\'s workflows folder holds {string}', async ({ e2e }, file) => {
  await expect.poll(() => listWorkflows(e2e), { timeout: LOAD_TIMEOUT }).toContain(file);
});

Then('the workspace\'s workflows folder is unchanged', async ({ e2e }) => {
  expect(listWorkflows(e2e)).toEqual(e2e.workflowsBeforeImport);
});

Then('the import is refused, saying the step {string} references an unknown agent {string}', async ({ e2e }, step, agent) => {
  const errors = e2e.window.getByTestId('workflow-import-errors').filter({ visible: true }).first();
  await expect(errors).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(errors).toContainText(step);
  await expect(errors).toContainText(/unknown agent/i);
  await expect(errors).toContainText(agent);
  // nothing offers to write it: no Import button, or a disabled one
  const importButton = importDialog(e2e.window).getByRole('button', { name: 'Import', exact: true });
  if (await importButton.count()) await expect(importButton).toBeDisabled();
});
