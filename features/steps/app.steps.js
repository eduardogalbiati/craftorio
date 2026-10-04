// Steps of features/app.feature, features/settings.feature and features/navigation.feature (#222,
// #254, #264): open the app, move through the sidebar's menu (grouped by the flow: Home, Plan &
// Design, Code & Build, Workflows, AI, Night watch, Settings; a group's title collapses it), the
// header (project selector, Oracle, notifications bell), the Workflows screen's tabs, Settings.
// Locators are roles and data-testid only (skills/ui-conventions).
// #254: a menu group is a role="group" named by its title, holding its title's toggle button
// (aria-expanded, named like the group) and its items' buttons; the header's project selector is a
// <select> with data-testid="header-project" (accessible name "Project").

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sidebar = (page) => page.getByRole('navigation');
const header = (page) => page.getByRole('banner');
// a sidebar entry by its label; a count badge may follow it ("Backlog 2")
const entryName = (name) => new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`);
const navItem = (page, name) => sidebar(page).getByRole('button', { name: entryName(name) });
const menuGroup = (page, name) => sidebar(page).getByRole('group', { name, exact: true });
const groupToggle = (page, name) => menuGroup(page, name).getByRole('button', { name, exact: true });
const workflowsTabs = (page) => page.getByRole('tablist', { name: 'Workflows', exact: true });

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

Then('the sidebar does not offer {string}', async ({ e2e }, name) => {
  await expect(navItem(e2e.window, 'Home')).toBeVisible();
  await expect(navItem(e2e.window, name)).toHaveCount(0);
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

// ---- the menu by the flow (#254) ---------------------------------------------------------------------

// | entry | items |: an entry is a group's title (its items comma-separated) or a single item (no
// items); the entries follow each other top to bottom in the table's order
Then('the sidebar reads, top to bottom:', async ({ e2e }, table) => {
  const page = e2e.window;
  let lastY = -Infinity;
  for (const row of table.hashes()) {
    const items = String(row.items || '').split(',').map((s) => s.trim()).filter(Boolean);
    const entry = items.length ? groupToggle(page, row.entry) : navItem(page, row.entry);
    await expect(entry, `the sidebar's entry "${row.entry}"`).toBeVisible();
    const box = await entry.boundingBox();
    expect(box.y, `"${row.entry}" comes after the entry above it`).toBeGreaterThan(lastY);
    lastY = box.y;
    for (const item of items) {
      await expect(menuGroup(page, row.entry).getByRole('button', { name: entryName(item) }), `"${item}" in the group "${row.entry}"`).toBeVisible();
    }
  }
});

Then('{string} is the top entry of the sidebar', async ({ e2e }, name) => {
  const page = e2e.window;
  const top = await navItem(page, name).boundingBox();
  expect(top, `the sidebar's entry "${name}"`).not.toBeNull();
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    const box = await button.boundingBox();
    if (box) expect(box.y).toBeGreaterThanOrEqual(top.y);
  }
});

When('I collapse the {string} menu group', async ({ e2e }, name) => {
  const toggle = groupToggle(e2e.window, name);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

Then('the {string} menu group is collapsed, hiding {string}', async ({ e2e }, name, item) => {
  const page = e2e.window;
  await expect(groupToggle(page, name)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuGroup(page, name).getByRole('button', { name: entryName(item) })).toBeHidden();
});

Then('the Workflows screen is on its {string} tab', async ({ e2e }, name) => {
  await expect(workflowsTabs(e2e.window).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
});

// ---- the header: project selector, Oracle, notifications (#254) --------------------------------------

const projectSelect = (page) => header(page).getByTestId('header-project');

// A second project, with its own synced backlog of one open issue, added to the scratch workspace;
// the app reloads to read the project list again
Given('the workspace has a second project {string} whose backlog has the open issue {string}', async ({ e2e }, name, title) => {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const { taskProgress } = require(path.join(root, 'src', 'backlog'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const repo = `https://github.com/example/${name}`;
  const created = await projects.createProject(ws.projects, { name, description: 'A second project (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, { repo });
  const now = new Date().toISOString();
  const issue = { number: 1, title, state: 'open', labels: [], body: '', url: `${repo}/issues/1`, author: 'octocat', assignees: [], tasks: taskProgress(''), createdAt: now, updatedAt: now };
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo, syncedAt: now, issues: [issue], epics: [], epicsError: null }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the header shows the project {string}', async ({ e2e }, name) => {
  const select = projectSelect(e2e.window);
  await expect(select).toBeVisible();
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toBe(name);
});

When('I choose the project {string} in the header', async ({ e2e }, name) => {
  await projectSelect(e2e.window).selectOption({ label: name });
});

When('I open the notifications from the header bell', async ({ e2e }) => {
  await header(e2e.window).getByRole('button', { name: /^Notifications\b/ }).click();
});

Then('the notification centre is open', async ({ e2e }) => {
  await expect(e2e.window.getByRole('dialog', { name: 'Notifications', exact: true })).toBeVisible();
});

Then('the header offers {string}', async ({ e2e }, name) => {
  await expect(header(e2e.window).getByRole('button', { name: entryName(name) })).toBeVisible();
});

// ---- no Supervisor in the header (#264) ---------------------------------------------------------------

// every screen the menu opens (a group's title only collapses its group: skipped)
Then('no screen of the menu shows a {string} button in the header', async ({ e2e }, name) => {
  const page = e2e.window;
  const items = [];
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    if ((await button.getAttribute('aria-expanded')) !== null) continue;
    items.push((await button.innerText()).replace(/\s+\d+$/, '').trim());
  }
  expect(items.length, 'the menu has screens').toBeGreaterThan(5);
  for (const item of items) {
    await navItem(page, item).click();
    await expect(header(page).getByRole('button', { name: new RegExp(escapeRe(name)) }), `the header on "${item}"`).toHaveCount(0);
  }
});
