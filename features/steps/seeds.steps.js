// Steps of features/seeds.feature (#360): the Seeds section of a project's Architecture tab.
// Locators are data-testid and roles only (skills/ui-conventions).
//
// What the section exposes (contract-360, renderer): data-testid="seeds-section"; one row
// "seed-<id>" per seed with its status "seed-status-<id>" (Never run, Running, Stale, Tool available,
// or the error) and the buttons "seed-run-<id>" (Run), "seed-open-<id>" (Open result),
// "seed-history-<id>" (History), "seed-make-tool-<id>" (Make it a tool); Open result shows the page in
// the iframe "seed-frame" whose sandbox has neither allow-same-origin nor allow-top-navigation and
// whose srcdoc carries a CSP with default-src 'none'. A recorded tool is set through the renderer api
// (window.api.setSeedTool), so the step does not depend on where the service stores it.

const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const LOAD_TIMEOUT = 30000;
const RUN_TIMEOUT = 60000;
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const section = (page) => visible(projectPage(page).getByTestId('seeds-section')).first();
const row = (page, id) => section(page).getByTestId(`seed-${id}`);
const status = (page, id) => section(page).getByTestId(`seed-status-${id}`);

// The project's id, read from the scratch workspace's project entries
function projectId(e2e, name) {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const project = projects.listProjects(ws.projects).find((p) => p.name === name);
  if (!project) throw new Error(`no project named ${name} in the scratch workspace`);
  return project.id;
}

Given('the project {string} has the tool {string} recorded for the seed {string}', async ({ e2e }, name, command, seedId) => {
  const id = projectId(e2e, name);
  const res = await e2e.window.evaluate((args) => window.api.setSeedTool(args), { projectId: id, seedId, command });
  expect(res && res.tool, 'the recorded tool').toBe(command);
});

Then('the Seeds section lists the seed {string} as {string}', async ({ e2e }, id, text) => {
  await expect(section(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row(e2e.window, id)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(status(e2e.window, id)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

When('I run the seed {string}', async ({ e2e }, id) => {
  const button = row(e2e.window, id).getByTestId(`seed-run-${id}`);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await button.click();
});

Then('the status of the seed {string} no longer says {string}', async ({ e2e }, id, text) => {
  await expect(status(e2e.window, id)).not.toContainText(text, { timeout: RUN_TIMEOUT });
  await expect(status(e2e.window, id)).not.toContainText(/running/i, { timeout: RUN_TIMEOUT });
});

When('I open the result of the seed {string}', async ({ e2e }, id) => {
  const button = row(e2e.window, id).getByTestId(`seed-open-${id}`);
  await expect(button).toBeEnabled({ timeout: RUN_TIMEOUT });
  await button.click();
});

Then('the seed result is shown in a sandboxed frame', async ({ e2e }) => {
  const frame = visible(e2e.window.getByTestId('seed-frame')).first();
  await expect(frame).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(frame).toHaveAttribute('sandbox', /.*/);
  const sandbox = (await frame.getAttribute('sandbox')) || '';
  expect(sandbox, 'the frame cannot reach the app').not.toMatch(/allow-same-origin/);
  expect(sandbox, 'the frame cannot navigate the app').not.toMatch(/allow-top-navigation/);
  await expect(frame, 'the result page has no network').toHaveAttribute('srcdoc', /default-src 'none'/);
  const body = e2e.window.frameLocator('[data-testid="seed-frame"]').locator('body');
  await expect(body, 'the result page has content').not.toBeEmpty({ timeout: LOAD_TIMEOUT });
});

When('I click {string} on the seed {string}', async ({ e2e }, label, id) => {
  await expect(section(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = row(e2e.window, id).getByTestId(`seed-make-tool-${id}`);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(label);
  await button.click();
});

Then('the app says the tool issue for {string} is only a preview', async ({ e2e }, id) => {
  const inRow = row(e2e.window, id).getByText(/preview/i);
  const toast = visible(e2e.window.getByRole('status').or(e2e.window.getByRole('alert'))).filter({ hasText: /preview/i });
  await expect(inRow.or(toast).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});
