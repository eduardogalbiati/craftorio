// Steps of fronts/build/features/projects.feature (#354): Projects back in the menu (Code & Build, before
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

const fs = require('fs');
const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

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

// #643: Projects › New project opens the project wizard (onboarding.steps.js); Edit keeps the dialog.
// data-testid="projects-empty": the Projects screen's empty state (no project yet), holding its own
// "New project" button; the header's "New project" comes first in the screen (its page head).
Then('the Projects screen says there is no project yet', async ({ e2e }) => {
  await expect(projectsScreen(e2e.window).getByTestId('projects-empty')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When("I choose New project in the Projects screen's empty state", async ({ e2e }) => {
  await projectsScreen(e2e.window).getByTestId('projects-empty').getByRole('button', { name: 'New project', exact: true }).click();
});

When("I choose New project in the Projects screen's header", async ({ e2e }) => {
  const screen = projectsScreen(e2e.window);
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await screen.getByRole('button', { name: 'New project', exact: true }).first().click();
});

Then('the project dialog is for editing {string} with the repository {string}', async ({ e2e }, name, repo) => {
  const dialog = projectDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(dialog.getByRole('heading', { name: 'Edit project', exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/^\s*Name\b/).first()).toHaveValue(name);
  await expect(dialog.getByLabel(/^\s*Git repository\b/).first()).toHaveValue(repo);
});

When('I save the project dialog', async ({ e2e }) => {
  await projectDialog(e2e.window).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(visible(e2e.window.getByTestId('project-dialog'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// ---- #741: an unfinished onboarding resumes at its step; a card's Edit opens the project's settings -------
// What the Projects screen exposes (to be added by #741):
// - data-testid="project-onboarding-unfinished": on a project card whose onboarding (the new-project wizard)
//   was closed before Finish, the badge "Onboarding not finished", next to it a role="button" named
//   "Continue" that reopens the wizard at the step it was left on, with its picks;
// - a card's "Edit" opens the project's settings: the project page (project-page) showing
//   data-testid="project-settings" (its settings section or tab), never the old New / Edit project dialog.

const unfinishedBadge = (card) => card.getByTestId('project-onboarding-unfinished');

Then('the project {string} on the Projects screen says its onboarding is not finished and offers Continue', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(unfinishedBadge(card)).toBeVisible();
  await expect(unfinishedBadge(card)).toContainText('Onboarding not finished');
  await expect(card.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});

Then('the project {string} on the Projects screen does not say its onboarding is not finished', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(unfinishedBadge(card)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
});

When('I continue the onboarding of the project {string} from the Projects screen', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await card.getByRole('button', { name: 'Continue', exact: true }).click();
});

// Edit, without expecting the old dialog (what opens is checked by the next step)
When('I choose Edit on the project {string} in the Projects screen', async ({ e2e }, name) => {
  const card = projectCard(projectsScreen(e2e.window), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
});

Then('the settings of the project {string} are open', async ({ e2e }, name) => {
  const page = projectPage(e2e.window);
  await expect(page).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
  await expect(visible(page.getByTestId('project-settings')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the project dialog is not shown', async ({ e2e }) => {
  await expect(visible(e2e.window.getByTestId('project-dialog'))).toHaveCount(0);
});

// ---- #742: removing a project can delete its folder -----------------------------------------------------
// What the Remove project dialog exposes (the app's confirm dialog, data-testid="confirm-modal"):
// - a role="checkbox" named "Also delete the folder <path>" (its label holds the project's folder), unchecked
//   when the dialog opens; its "Remove" button removes the project from the list, and with the box ticked
//   deletes the folder too (unticked: the folder stays, as before #742).
// The project's folder is read from the app (window.api.listProjects) when Remove is chosen, then checked on
// the disk of the scenario's scratch workspace.

const confirmModal = (page) => page.getByTestId('confirm-modal');
const deleteFolderBox = (page) => confirmModal(page).getByRole('checkbox', { name: /^\s*Also delete the folder\b/ });

When('I choose Remove on the project {string} in the Projects screen', async ({ e2e }, name) => {
  const page = e2e.window;
  const card = projectCard(projectsScreen(page), name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  const folder = await page.evaluate(async (n) => (await window.api.listProjects()).find((p) => p.name === n)?.folder || null, name);
  if (!folder) throw new Error(`the project "${name}" has no folder`);
  expect(fs.existsSync(folder), `the folder of "${name}" exists before Remove`).toBe(true);
  e2e.projectFolders = { ...(e2e.projectFolders || {}), [name]: folder };
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(confirmModal(page)).toBeVisible();
});

Then('the Remove project dialog offers to also delete the folder of {string}, unticked', async ({ e2e }, name) => {
  const folder = e2e.projectFolders?.[name];
  if (!folder) throw new Error(`choose Remove on the project "${name}" first`);
  const box = deleteFolderBox(e2e.window);
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await expect(confirmModal(e2e.window)).toContainText(folder);
});

When('I tick "Also delete the folder" in the Remove project dialog', async ({ e2e }) => {
  await deleteFolderBox(e2e.window).check();
  await expect(deleteFolderBox(e2e.window)).toBeChecked();
});

When('I confirm the Remove project dialog', async ({ e2e }) => {
  const modal = confirmModal(e2e.window);
  await modal.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: LOAD_TIMEOUT });
});

Then('the Projects screen no longer lists the project {string}', async ({ e2e }, name) => {
  await expect(projectsScreen(e2e.window).getByTestId('project-card').filter({ hasText: name })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the folder of the project {string} is still on the disk', async ({ e2e }, name) => {
  const folder = e2e.projectFolders?.[name];
  if (!folder) throw new Error(`choose Remove on the project "${name}" first`);
  // the removal has had time to delete it, if it wrongly did
  await e2e.window.waitForTimeout(500);
  expect(fs.existsSync(folder), `the folder ${folder}`).toBe(true);
});

Then('the folder of the project {string} is gone from the disk', async ({ e2e }, name) => {
  const folder = e2e.projectFolders?.[name];
  if (!folder) throw new Error(`choose Remove on the project "${name}" first`);
  await expect.poll(() => fs.existsSync(folder), { message: `the folder ${folder} is deleted`, timeout: LOAD_TIMEOUT }).toBe(false);
});
