// Steps of fronts/build/features/workflows-repository.feature (#485): the workflows a repository declares in
// .multiagent/project.yaml (bundled ones by name, its own copies by file workflows/<x>.yaml under
// .multiagent/workflows/), listed on the Workflows screen's Definitions tab in their category sections.
// Opening the screen reuses app.steps.js ("I open {string} in the sidebar").
//
// data-testids (skills/ui-conventions):
//   workflow-category              a category section, data-category="solo|team|intake|release";
//                                  its heading (role heading) is the category's name
//   workflow-category-explanation  the section's one-line explanation
//   workflow-card                  a workspace workflow's card (the existing <article class="wf-card">), data-file
//   repository-workflow            a repository workflow's card (same markup), heading = its name
//   workflow-origin-badge          the card's origin badge, "repository @ <short sha>" for a repository's
//   workflow-acceptance            the card's acceptance state: "Not accepted" / "Accepted ..."
//   workflow-accept                the card's Accept button (a repository workflow not accepted yet)
//   workflows-manifest-error       the screen's report of a malformed repository manifest (role alert or status)
//   nav-workflows-acceptance       #794: the sidebar's orange indicator on the "Definitions" entry: text = the
//                                  count of the current project's repository workflows waiting for acceptance,
//                                  title names them; hidden with none
//   nav-group-workflows-acceptance the same on the "Workflows" group's title, shown only when the group is collapsed
//   workflows-tab-acceptance       the same on the Workflows screen's Definitions tab
//   workflows-awaiting-acceptance  the block at the top of the Definitions page holding the waiting cards; a
//                                  repository-workflow card in it has the class awaiting-acceptance, and once
//                                  accepted the card sits in its category section
//   workflow-acceptance-reason     inside a waiting card, the line saying why: the commit's short sha and "changed"
// An indicator's count joins the accessible name of its button ("Definitions 1"), which entryName of
// app.steps.js allows: no aria-label on an indicator, it would change that name.
//
// The repository is the demo project's folder made a git repository (fixed identity, no machine
// config) with one commit holding the manifest, after the app opened; the app reloads to read it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const root = path.join(__dirname, '..', '..', '..', '..');
const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });

const section = (page, name) => visible(page.getByTestId('workflow-category'))
  .filter({ has: page.getByRole('heading', { name: new RegExp(`^\\s*${escapeRe(name)}\\b`, 'i') }) }).first();
// the card's heading is the workflow's name, then maybe its version ("issue-tracker v0.2.0")
const nameRe = (name) => new RegExp(`^\\s*${escapeRe(name)}(\\s|$)`);
// a workspace workflow's card is workflow-card, a repository workflow's card is repository-workflow
const cardsOf = (scope) => scope.locator('[data-testid="workflow-card"], [data-testid="repository-workflow"]');
const card = (page, name) => visible(cardsOf(page))
  .filter({ has: page.getByRole('heading', { name: nameRe(name) }) }).first();

// git in the project's folder with a fixed identity, never the machine's config
function git(e2e, cwd, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

// Writes the files under the project's folder, commits them on main, keeps the head's sha, reloads the app
async function commitToProject(e2e, files) {
  const folder = e2e.project && e2e.project.folder;
  if (!folder) throw new Error('the demo project has no folder');
  fs.mkdirSync(folder, { recursive: true });
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), content);
  }
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '-m', 'Declare the repository workflows']);
  e2e.repoHead = git(e2e, folder, ['rev-parse', 'HEAD']);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

// The repository's own copy of the bundled issue workflow under another name and category, declared by file
Given('the project\'s repository declares its own workflow {string} in the {string} category', async ({ e2e }, name, category) => {
  const yaml = fs.readFileSync(path.join(root, 'workflows', 'issue.yaml'), 'utf8')
    .replace(/^(\s*name:\s*)issue\s*$/m, `$1${name}`)
    .replace(/^(\s*category:\s*)\S+\s*$/m, `$1${category.toLowerCase()}`);
  await commitToProject(e2e, {
    '.multiagent/project.yaml': `version: 1\nworkflows:\n  - name: ${name}\n    file: workflows/${name}.yaml\n    category: ${category.toLowerCase()}\n`,
    [`.multiagent/workflows/${name}.yaml`]: yaml,
  });
});

Given('the project\'s repository has a malformed workflows manifest', async ({ e2e }) => {
  await commitToProject(e2e, { '.multiagent/project.yaml': 'workflows: [software-development\n  - : : not yaml\n' });
});

// only an accepted workflow is in its section: one waiting for acceptance sits on top of the page (#794)
Then('the workflow {string} is listed in the {string} section with a repository badge at the repository\'s latest commit', async ({ e2e }, name, category) => {
  const short = e2e.repoHead.slice(0, 7);
  const inSection = section(e2e.window, category).getByTestId('repository-workflow')
    .filter({ has: e2e.window.getByRole('heading', { name: nameRe(name) }) });
  await expect(inSection.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(inSection.first().getByTestId('workflow-origin-badge')).toHaveText(new RegExp(`repository\\s*@\\s*${short}`, 'i'));
});

Then('the workflow {string} is not accepted', async ({ e2e }, name) => {
  const c = card(e2e.window, name);
  await expect(c.getByTestId('workflow-acceptance')).toHaveText(/not accepted/i, { timeout: LOAD_TIMEOUT });
  await expect(c.getByTestId('workflow-accept')).toBeEnabled();
});

When('I accept the workflow {string}', async ({ e2e }, name) => {
  await card(e2e.window, name).getByTestId('workflow-accept').click();
});

Then('the workflow {string} is accepted', async ({ e2e }, name) => {
  const c = card(e2e.window, name);
  await expect(c.getByTestId('workflow-acceptance')).toHaveText(/^(?!.*not accepted).*accepted/i, { timeout: LOAD_TIMEOUT });
  await expect(c.getByTestId('workflow-accept')).toHaveCount(0);
});

Then('the Workflows screen reports that the repository\'s manifest is malformed', async ({ e2e }) => {
  const error = visible(e2e.window.getByTestId('workflows-manifest-error')).first();
  await expect(error).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(error).toContainText(/project\.yaml/i);
});

Then('the workflow {string} is listed on the Workflows screen', async ({ e2e }, name) => {
  await expect(card(e2e.window, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// #631: a bundled workflow merged or renamed away; the screen is loaded (some card shows) before checking
Then('the workflow {string} is not listed on the Workflows screen', async ({ e2e }, name) => {
  await expect(visible(cardsOf(e2e.window)).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(cardsOf(e2e.window)).filter({ has: e2e.window.getByRole('heading', { name: nameRe(name) }) })).toHaveCount(0);
});

Then('the {string} section explains {string}', async ({ e2e }, name, text) => {
  const explanation = section(e2e.window, name).getByTestId('workflow-category-explanation');
  await expect(explanation).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(explanation).toContainText(new RegExp(escapeRe(text), 'i'));
});

Then('the {string} section is shown with its explanation', async ({ e2e }, name) => {
  const explanation = section(e2e.window, name).getByTestId('workflow-category-explanation');
  await expect(explanation).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(explanation).not.toHaveText(/^\s*$/);
});

// ---- what waits for the owner's acceptance (#794) -----------------------------------------------------

const indicator = (page, testid) => visible(page.getByTestId(testid));
const groupIndicator = (group) => `nav-group-${group.toLowerCase()}-acceptance`;
const awaitingCard = (page, name) => visible(page.getByTestId('workflows-awaiting-acceptance')).getByTestId('repository-workflow')
  .filter({ has: page.getByRole('heading', { name: nameRe(name) }) });

async function expectCount(page, testid, count) {
  await expect(indicator(page, testid)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(indicator(page, testid)).toHaveText(String(count), { timeout: LOAD_TIMEOUT });
}

async function expectCountNaming(page, testid, count, name) {
  await expectCount(page, testid, count);
  await expect(indicator(page, testid)).toHaveAttribute('title', new RegExp(escapeRe(name)));
}

const expectNoCount = (page, testid) => expect(indicator(page, testid)).toHaveCount(0, { timeout: LOAD_TIMEOUT });

Then('the sidebar shows {int} workflow(s) waiting for acceptance, naming {string}', async ({ e2e }, count, name) => {
  await expectCountNaming(e2e.window, 'nav-workflows-acceptance', count, name);
});

Then('the sidebar shows no workflow waiting for acceptance', async ({ e2e }) => {
  await expectNoCount(e2e.window, 'nav-workflows-acceptance');
});

Then('the {string} menu group shows {int} workflow(s) waiting for acceptance, naming {string}', async ({ e2e }, group, count, name) => {
  await expectCountNaming(e2e.window, groupIndicator(group), count, name);
});

Then('the {string} menu group shows no workflow waiting for acceptance', async ({ e2e }, group) => {
  await expectNoCount(e2e.window, groupIndicator(group));
});

Then('the Definitions tab shows {int} workflow(s) waiting for acceptance', async ({ e2e }, count) => {
  await expectCount(e2e.window, 'workflows-tab-acceptance', count);
});

Then('the Definitions tab shows no workflow waiting for acceptance', async ({ e2e }) => {
  await expectNoCount(e2e.window, 'workflows-tab-acceptance');
});

Then('the workflow {string} is highlighted first, saying which commit changed it', async ({ e2e }, name) => {
  const page = e2e.window;
  const short = e2e.repoHead.slice(0, 7);
  await expect(visible(cardsOf(page)).first().getByRole('heading', { name: nameRe(name) })).toBeVisible({ timeout: LOAD_TIMEOUT });
  const c = awaitingCard(page, name);
  await expect(c).toHaveClass(/awaiting-acceptance/);
  await expect(c.getByTestId('workflow-acceptance')).toHaveText(/not accepted/i);
  const reason = c.getByTestId('workflow-acceptance-reason');
  await expect(reason).toContainText(short);
  await expect(reason).toContainText(/changed/i);
});

Then('the workflow {string} is no longer highlighted', async ({ e2e }, name) => {
  const page = e2e.window;
  const c = card(page, name);
  await expect(c).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(awaitingCard(page, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  await expect(c).not.toHaveClass(/awaiting-acceptance/);
  await expect(c.getByTestId('workflow-acceptance-reason')).toHaveCount(0);
});

// ---- which copy of a workflow a project's run uses (#554) ---------------------------------------------
// data-testid:
//   workflow-runs-line   on a workspace card and on a repository card of the same workflow name, the line
//                        saying which copy a project's run uses: "runs: workspace copy (your models)" on the
//                        workspace card whose edited copy runs; "runs: repository @ <short sha>" on the
//                        repository card whose copy runs; on the card whose copy does not run, a line saying
//                        it does not run for this project ("does not run ..."/"not used ...").
// The workspace's workflows folder is <scratch>/workspace/workflows (seeded with the bundled ones at start).

const workspaceWorkflowsDir = (e2e) => path.join(e2e.scratch, 'workspace', 'workflows');
const workspaceCard = (page, name) => visible(page.getByTestId('workflow-card'))
  .filter({ has: page.getByRole('heading', { name: nameRe(name) }) }).first();
const repositoryCard = (page, name) => visible(page.getByTestId('repository-workflow'))
  .filter({ has: page.getByRole('heading', { name: nameRe(name) }) }).first();
const runsLine = (c) => c.getByTestId('workflow-runs-line');

// The owner's edit of the seeded bundled copy (origin "modified"): its file differs from the seeded one
Given('the workspace holds an edited copy of the workflow {string}', async ({ e2e }, name) => {
  const file = path.join(workspaceWorkflowsDir(e2e), `${name}.yaml`);
  const yaml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(root, 'workflows', `${name}.yaml`), 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${yaml.replace(/\s*$/, '')}\n# edited by the owner: the owner's models\n`);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// The repository's own copy of a bundled workflow under the same name, declared by file
Given('the project\'s repository declares its own copy of the workflow {string}', async ({ e2e }, name) => {
  const yaml = fs.readFileSync(path.join(root, 'workflows', `${name}.yaml`), 'utf8')
    .replace(/^(\s*category:\s*)\S+\s*$/m, '$1intake');
  await commitToProject(e2e, {
    '.multiagent/project.yaml': `version: 1\nworkflows:\n  - name: ${name}\n    file: workflows/${name}.yaml\n    category: intake\n`,
    [`.multiagent/workflows/${name}.yaml`]: yaml,
  });
});

Then('the workspace card of the workflow {string} says a project\'s run uses the workspace copy with the owner\'s models', async ({ e2e }, name) => {
  const line = runsLine(workspaceCard(e2e.window, name));
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveText(/runs:\s*workspace copy\s*\(your models\)/i);
});

Then('the repository card of the workflow {string} says it does not run for this project', async ({ e2e }, name) => {
  const line = runsLine(repositoryCard(e2e.window, name));
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveText(/\b(does not run|not used|doesn't run)\b/i);
  await expect(line).not.toHaveText(/runs:\s*repository/i);
});

Then('the repository card of the workflow {string} says a project\'s run uses it at the repository\'s latest commit', async ({ e2e }, name) => {
  const short = e2e.repoHead.slice(0, 7);
  const line = runsLine(repositoryCard(e2e.window, name));
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveText(new RegExp(`runs:\\s*repository\\s*@\\s*${short}`, 'i'));
});

Then('the workspace card of the workflow {string} says it does not run for this project', async ({ e2e }, name) => {
  const line = runsLine(workspaceCard(e2e.window, name));
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveText(/\b(does not run|not used|doesn't run)\b/i);
  await expect(line).not.toHaveText(/runs:\s*workspace copy/i);
});
