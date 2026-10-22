// Steps of features/474-workflows-are-code.feature (#474, SEC-9): workflows, skills and seeds are
// code. The Workflows screen's notice (data-testid="workflows-code-notice": "workflows, skills and
// seeds are code; install only ones you trust") and the one-time warning on the first import or save
// of a file that is not bundled (data-testid="code-trust-warning", role="dialog"; its confirm button
// saves, Cancel saves nothing), remembered per file by its fingerprint. A not-bundled workflow is a
// copy of a bundled one under another file name in <scratch>/workspace/workflows (origin "custom").
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { LOAD_TIMEOUT } = require('../support/run-screen');

const root = path.join(__dirname, '..', '..');
const TRUST_TEXT = /install only (the )?ones you trust/i;
const workflowsDir = (e2e) => path.join(e2e.scratch, 'workspace', 'workflows');
const codeWarning = (page) => page.getByTestId('code-trust-warning').filter({ visible: true });
const readWorkflow = (e2e, file) => {
  try { return fs.readFileSync(path.join(workflowsDir(e2e), file), 'utf8'); } catch { return ''; }
};

Then('the Workflows screen notes that workflows, skills and seeds are code, to install only ones you trust', async ({ e2e }) => {
  const notice = e2e.window.getByTestId('workflows-code-notice').filter({ visible: true });
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(/workflows, skills and seeds are code/i);
  await expect(notice).toContainText(TRUST_TEXT);
});

// a copy of the bundled run-retrospective.yaml under another file and name: not bundled, never confirmed
Given('the workspace\'s workflows folder has a workflow {string} that is not bundled', async ({ e2e }, file) => {
  const name = file.replace(/\.ya?ml$/, '');
  const yaml = fs.readFileSync(path.join(root, 'workflows', 'run-retrospective.yaml'), 'utf8')
    .replace(/^(\s*name:\s*)run-retrospective\s*$/m, `$1${name}`);
  fs.mkdirSync(workflowsDir(e2e), { recursive: true });
  fs.writeFileSync(path.join(workflowsDir(e2e), file), yaml);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

When('I open the workflow {string} in the builder', async ({ e2e }, file) => {
  const select = e2e.window.getByRole('combobox', { name: 'Open a workflow in the builder', exact: true });
  await expect(select.locator(`option[value="${file}"]`)).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await select.selectOption(file);
  await expect(e2e.window.getByRole('textbox', { name: 'Description', exact: true })).toBeEditable({ timeout: LOAD_TIMEOUT });
});

When('I set the builder\'s description to {string}', async ({ e2e }, text) => {
  await e2e.window.getByRole('textbox', { name: 'Description', exact: true }).fill(text);
});

When('I save the workflow in the builder', async ({ e2e }) => {
  await e2e.window.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).click();
});

Then('a warning says workflows, skills and seeds are code, to install only ones you trust', async ({ e2e }) => {
  const warning = codeWarning(e2e.window);
  await expect(warning).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(warning).toHaveAttribute('role', /^(alert)?dialog$/);
  await expect(warning).toContainText(/code/i);
  await expect(warning).toContainText(TRUST_TEXT);
});

// the warning's confirm button: any button of the dialog but Cancel
When('I confirm the code warning', async ({ e2e }) => {
  const warning = codeWarning(e2e.window);
  await expect(warning).toBeVisible({ timeout: LOAD_TIMEOUT });
  await warning.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
  await expect(warning).toHaveCount(0);
});

Then('no code warning shows', async ({ e2e }) => {
  await expect(codeWarning(e2e.window)).toHaveCount(0);
});

Then('the workflow file {string} holds {string}', async ({ e2e }, file, text) => {
  await expect.poll(() => readWorkflow(e2e, file), { timeout: LOAD_TIMEOUT }).toContain(text);
});

Then('the workflow file {string} does not hold {string}', async ({ e2e }, file, text) => {
  expect(readWorkflow(e2e, file)).not.toContain(text);
});
