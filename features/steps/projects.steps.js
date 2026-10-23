// Steps of features/projects.feature (#354): Projects back in the menu (Code & Build, before
// Backlog), out of Settings; the Projects screen's cards; a project's page with its tabs Overview,
// Conflict map, Architecture and Refactor; the one-line "Conflict map: in Projects › <project>"
// link that replaces the Roadmap's panel and Analytics › Performance's "Files most runs edit"; the
// project dialog's per-project settings of features/472-install-scripts.feature (#472).
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="settings-tabs": the Settings tab bar (its tabs are buttons named by their label);
// - data-testid="projects-screen": the Projects screen, its header buttons "Open folder" and
//   "New project"; data-testid="project-card": one card per project, holding its name;
// - data-testid="project-page": a project's page, its name in a heading; its tabs are a
//   role="tablist" (named in the interface language, "Project" or "Projeto"), each a role="tab" with
//   aria-selected;
// - data-testid="project-overview": the Overview tab (folder, repository, unpushed commits, runs);
// - data-testid="project-conflict-map": the Conflict map tab (its state says when the folder is not a
//   git repository);
// - data-testid="project-architecture-empty" / "project-refactor-empty": the empty states of the
//   Architecture and Refactor tabs;
// - data-testid="conflict-map-link": the one-line link on the Roadmap and on Analytics › Performance.
// - (#472) a project card's "Edit" button opens the project dialog, data-testid="project-dialog"
//   (the New / Edit project modal card); its per-project settings are checkboxes named by their label
//   ("Install dependencies without running their scripts"); its "Save" button saves and closes it.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectsScreen = (page) => visible(page.getByTestId('projects-screen')).first();
const projectCard = (projects, name) => projects.getByTestId('project-card').filter({ hasText: name }).first();
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
// the tablist is named in the interface language (pt-BR "Projeto"): the page has one tablist, found by role
const projectTabs = (page) => projectPage(page).getByRole('tablist');
const projectTab = (page, name) => projectTabs(page).getByRole('tab', { name, exact: true });
const conflictMapLink = (page, text) => visible(page.getByTestId('conflict-map-link')).filter({ hasText: text }).first();

Then('Settings has no {string} tab', async ({ e2e }, name) => {
  const tabs = visible(e2e.window.getByTestId('settings-tabs')).first();
  await expect(tabs.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name, exact: true })).toHaveCount(0);
});

Then('the Projects screen offers {string} and {string}', async ({ e2e }, a, b) => {
  const screen = projectsScreen(e2e.window);
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const name of [a, b]) {
    await expect(screen.getByRole('button', { name, exact: true }).first(), `the Projects screen's "${name}"`).toBeVisible();
  }
});

Then('the Projects screen lists the project {string}', async ({ e2e }, name) => {
  await expect(projectCard(projectsScreen(e2e.window), name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('I open the project {string} from the Projects screen', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the card's title, not one of its buttons (Start workflow, Open folder…)
  await card.getByText(name, { exact: true }).first().click();
});

Then('the project page of {string} is open', async ({ e2e }, name) => {
  const page = projectPage(e2e.window);
  await expect(page).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
});

Then('the project page of {string} has the tabs {string}, {string}, {string} and {string}', async ({ e2e }, name, a, b, c, d) => {
  const page = projectPage(e2e.window);
  await expect(page).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
  const tabs = projectTabs(e2e.window).getByRole('tab');
  await expect(tabs).toHaveText([a, b, c, d].map((t) => new RegExp(`^\\s*${escapeRe(t)}\\s*$`)));
});

When('I open the {string} project tab', async ({ e2e }, name) => {
  await projectTab(e2e.window, name).click();
});

Then('the project tab {string} is selected', async ({ e2e }, name) => {
  await expect(projectTab(e2e.window, name)).toHaveAttribute('aria-selected', 'true', { timeout: LOAD_TIMEOUT });
});

Then('the Overview shows the repository {string} and {int} commits not pushed', async ({ e2e }, repo, n) => {
  const overview = visible(projectPage(e2e.window).getByTestId('project-overview')).first();
  await expect(overview).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(overview).toContainText(repo);
  await expect(overview).toContainText(new RegExp(`(^|\\D)${n} commits?\\b`), { timeout: LOAD_TIMEOUT });
});

Then('the Conflict map tab says the project folder is not a git repository', async ({ e2e }) => {
  const tab = visible(projectPage(e2e.window).getByTestId('project-conflict-map')).first();
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(tab).toContainText(/not a git repository/i, { timeout: LOAD_TIMEOUT });
});

Then('the project tab {string} shows an empty state mentioning {string}', async ({ e2e }, name, word) => {
  const empty = visible(projectPage(e2e.window).getByTestId(`project-${name.toLowerCase()}-empty`)).first();
  await expect(empty).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(empty).toContainText(new RegExp(escapeRe(word), 'i'));
});

Then('the screen shows the link {string}', async ({ e2e }, text) => {
  await expect(conflictMapLink(e2e.window, text)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the screen does not show {string}', async ({ e2e }, text) => {
  await expect(visible(e2e.window.getByText(text))).toHaveCount(0);
});

Then('the Roadmap draws no Conflict map panel', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('roadmap-stage').first()).toBeVisible();
  await expect(visible(e2e.window.getByTestId('conflict-map'))).toHaveCount(0);
});

When('I follow the link {string}', async ({ e2e }, text) => {
  const link = conflictMapLink(e2e.window, text);
  await link.scrollIntoViewIfNeeded();
  await link.click();
});

// ---- the project dialog's per-project settings (#472) -------------------------------------------------

const projectDialog = (page) => visible(page.getByTestId('project-dialog')).first();
const dialogSetting = (page, label) => projectDialog(page).getByRole('checkbox', { name: label, exact: true });

When('I edit the project {string} from the Projects screen', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(projectDialog(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the project dialog shows {string} turned {word}', async ({ e2e }, label, state) => {
  const box = dialogSetting(e2e.window, label);
  await expect(box, `the project setting "${label}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (state === 'on') await expect(box).toBeChecked();
  else if (state === 'off') await expect(box).not.toBeChecked();
  else throw new Error(`"turned ${state}": expected "on" or "off"`);
});

When('I turn on {string} in the project dialog', async ({ e2e }, label) => {
  await dialogSetting(e2e.window, label).check();
});

When('I save the project dialog', async ({ e2e }) => {
  await projectDialog(e2e.window).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(visible(e2e.window.getByTestId('project-dialog'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
