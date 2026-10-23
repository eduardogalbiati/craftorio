// Steps of features/projects.feature's @issue-486 scenarios: the "Workflows" block of the project
// dialog (Create project, once a repository URL or a folder is given) and of a project's Overview.
// With a workflows manifest in the repository (.multiagent/project.yaml at HEAD, #485) its workflows
// come pre-checked in their categories and nothing is asked; without one, a picker of the bundled and
// workspace workflows by category, none checked, a one-line hint per category, and a
// "Create one for this project" button. The project's default workflow is the first solo/team one checked.
// Opening Projects and a project's page reuses app.steps.js and projects.steps.js.
//
// What the screens expose (the renderer's contract for these steps), skills/ui-conventions:
// - data-testid="project-workflows-block": the Workflows block, in the project dialog
//   (data-testid="project-dialog") and in the project's Overview (data-testid="project-overview");
// - data-testid="project-workflows-category": one category group in the block, data-category="<key>",
//   its name in a role="heading" ("Solo", "Team", "Intake", "Release", "Build", "Plan", "Monitor"...);
// - data-testid="project-workflows-category-hint": the group's one-line hint (non-empty);
// - each workflow is a role="checkbox" named by its label, which starts with the workflow's name;
// - data-testid="project-workflows-create": the "Create one for this project" button (no manifest only);
// - data-testid="project-default-workflow": in the Overview's block, the project's default workflow's name.
// The dialog's fields are found by their labels ("Name", "Folder"), its submit by "Create project".
//
// The folders are made under the scenario's scratch folder (e2e.scratch, next to the workspace that
// MULTIAGENT_WORKSPACE points to); a repository one is a git repository (fixed identity, no machine
// config) with one commit holding the manifest.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
// a workflow's checkbox label starts with its name ("software-development", maybe a description after)
const nameRe = (name) => new RegExp(`^\\s*${escapeRe(name)}(\\s|$)`);

const projectDialog = (page) => visible(page.getByTestId('project-dialog')).first();
const projectOverview = (page) => visible(page.getByTestId('project-page')).first().getByTestId('project-overview').first();
const blockIn = (scope) => scope.getByTestId('project-workflows-block').first();
const dialogBlock = (page) => blockIn(projectDialog(page));
const overviewBlock = (page) => blockIn(projectOverview(page));
// a category's heading is its section name, which may carry the group's name ("Build" is "Code & Build", the Workflows screen's section)
const categoryIn = (page, block, name) => block.getByTestId('project-workflows-category')
  .filter({ has: page.getByRole('heading', { name: new RegExp(`\\b${escapeRe(name)}\\b`, 'i') }) }).first();
const workflowBox = (scope, name) => scope.getByRole('checkbox', { name: nameRe(name) }).first();

// the scenario's folders, under its scratch folder (the workspace is <scratch>/workspace)
function scratchOf(e2e) {
  const scratch = e2e.scratch || (process.env.MULTIAGENT_WORKSPACE && path.dirname(process.env.MULTIAGENT_WORKSPACE));
  if (!scratch) throw new Error('no scratch folder: open the app first');
  return scratch;
}
const folderOf = (e2e, name) => path.join(scratchOf(e2e), 'folders', name);

function git(e2e, cwd, args) {
  const config = path.join(scratchOf(e2e), 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

Given('a local folder {string} without a workflows manifest', async ({ e2e }, name) => {
  const folder = folderOf(e2e, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
});

Given('a local git repository {string} whose workflows manifest lists {string} as {string} and {string} as {string}', async ({ e2e }, name, a, catA, b, catB) => {
  const folder = folderOf(e2e, name);
  fs.mkdirSync(path.join(folder, '.multiagent'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'),
    `version: 1\nworkflows:\n  - name: ${a}\n    category: ${catA}\n  - name: ${b}\n    category: ${catB}\n`);
  git(e2e, folder, ['init', '-q', '-b', 'main']);
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '-m', 'Declare the workflows']);
});

When('I start a new project {string} in the folder {string}', async ({ e2e }, name, folderName) => {
  const screen = visible(e2e.window.getByTestId('projects-screen')).first();
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await screen.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = projectDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await dialog.getByLabel(/^\s*Name\b/).first().fill(name);
  const folder = dialog.getByLabel(/^\s*Folder\b/).first();
  await folder.fill(folderOf(e2e, folderName));
  // leaving the field is when the dialog looks at the folder
  await folder.press('Tab');
  await expect(dialogBlock(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the project dialog shows a Workflows block', async ({ e2e }) => {
  const block = dialogBlock(e2e.window);
  await expect(block).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(block).toContainText(/Workflows/);
});

Then('the Workflows block lists {string} under {string}, {word}', async ({ e2e }, name, category, state) => {
  const group = categoryIn(e2e.window, dialogBlock(e2e.window), category);
  await expect(group, `the "${category}" category of the Workflows block`).toBeVisible({ timeout: LOAD_TIMEOUT });
  const box = workflowBox(group, name);
  await expect(box, `the workflow "${name}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (state === 'checked') await expect(box).toBeChecked();
  else if (state === 'unchecked') await expect(box).not.toBeChecked();
  else throw new Error(`"${state}": expected "checked" or "unchecked"`);
});

Then('no workflow is checked in the Workflows block', async ({ e2e }) => {
  const boxes = dialogBlock(e2e.window).getByRole('checkbox');
  await expect(boxes.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await expect(boxes.nth(i)).not.toBeChecked();
});

Then('every category of the Workflows block has a one-line hint', async ({ e2e }) => {
  const groups = dialogBlock(e2e.window).getByTestId('project-workflows-category');
  await expect(groups.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const hint = groups.nth(i).getByTestId('project-workflows-category-hint');
    await expect(hint).toHaveCount(1);
    await expect(hint).not.toHaveText(/^\s*$/);
  }
});

Then('the Workflows block offers {string}', async ({ e2e }, label) => {
  const button = dialogBlock(e2e.window).getByTestId('project-workflows-create');
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
});

Then('the Workflows block does not offer {string}', async ({ e2e }, label) => {
  const block = dialogBlock(e2e.window);
  await expect(block.getByRole('checkbox').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(block.getByTestId('project-workflows-create'))).toHaveCount(0);
  await expect(visible(block.getByRole('button', { name: label }))).toHaveCount(0);
});

When('I check the workflow {string} in the Workflows block', async ({ e2e }, name) => {
  await workflowBox(dialogBlock(e2e.window), name).check();
});

When('I create the project', async ({ e2e }) => {
  await projectDialog(e2e.window).getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(visible(e2e.window.getByTestId('project-dialog'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the Overview\'s Workflows block shows {string} {word}', async ({ e2e }, name, state) => {
  const block = overviewBlock(e2e.window);
  await expect(block).toBeVisible({ timeout: LOAD_TIMEOUT });
  const box = workflowBox(block, name);
  await expect(box, `the workflow "${name}" on the Overview`).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (state === 'checked') await expect(box).toBeChecked();
  else if (state === 'unchecked') await expect(box).not.toBeChecked();
  else throw new Error(`"${state}": expected "checked" or "unchecked"`);
});

Then('the project\'s default workflow is {string}', async ({ e2e }, name) => {
  const def = overviewBlock(e2e.window).getByTestId('project-default-workflow');
  await expect(def).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(def).toContainText(name);
});
