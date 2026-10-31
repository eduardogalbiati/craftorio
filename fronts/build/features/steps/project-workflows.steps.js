// Steps of fronts/build/features/projects.feature's @issue-486 scenarios: the "Workflows" block of the project
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
const { Given, When, Then } = require('../../../../features/steps/fixtures');

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

// Projects › New project opens the onboarding wizard since #643; the project dialog's Create mode
// (with its Workflows block) is still the header's project selector's "New project…".
When('I start a new project {string} in the folder {string}', async ({ e2e }, name, folderName) => {
  const screen = visible(e2e.window.getByTestId('projects-screen')).first();
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await e2e.window.getByTestId('header-project').selectOption({ label: 'New project…' });
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

// ---- the Ways of working interview (#487, fronts/analyser/features/ways-of-working.feature) ---------------------------
// A project page's "Ways of working" button opens a drawer that runs the seeds/ways-of-working analysis
// (its cost shown first, like Projects › Architecture's analysis), shows the inferred profile with its
// evidence, asks the open questions, proposes a workflow set, and writes it to the repository only on
// "Write to the repository" (.multiagent/workflows/ + .multiagent/project.yaml, not committed).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="project-ways-of-working": the project page's button that opens the interview;
// - data-testid="ways-of-working-drawer": the interview drawer (role="dialog");
// - data-testid="ways-of-working-estimate": the analysis's cost, "≈ US$ <n>" or "no estimate yet",
//   shown before anything runs; "ways-of-working-analyze": the button that starts the analysis;
//   "ways-of-working-cancel": Cancel (closes the drawer, runs nothing); "ways-of-working-close": closes it;
// - data-testid="ways-of-working-profile": the inferred profile, its labels ("Solo: local merge",
//   "Team: ...", "Release: milestone"...); one data-testid="ways-of-working-evidence" per fact behind it;
// - data-testid="ways-of-working-question": one open question, its text naming it ("Validation",
//   "Budget per issue", "Screenshots", "Review rigour", "Release style"), holding one control (a select,
//   a text/number field, or radios/checkboxes) set to the profile's default and enabled;
// - data-testid="ways-of-working-proposed": the proposed set; one data-testid="ways-of-working-proposed-workflow"
//   per workflow, data-category="intake|development|release" and data-name="<workflow name>";
// - the buttons "Open in Builder" / "Write to the repository" (data-testid="ways-of-working-open-builder"
//   / "ways-of-working-write"); the Builder's "Workflow name" field then holds the development workflow's name;
// - data-testid="project-repository-workflow": on the project page, one per workflow the repository's
//   .multiagent/ declares (written by the interview, even uncommitted), its text holding the workflow's name.
// The demo project's folder is made a git repository (fixed identity, no machine config) with a few
// commits of one author on main, then the app reloads; the analysis's runs are seen in the scratch
// workspace's runs/ folder (their records name the ways-of-working seed).

const ANALYSIS_TIMEOUT = 60000;
const CATEGORIES = ['intake', 'development', 'release'];
const projectPageOf = (page) => visible(page.getByTestId('project-page')).first();
const interview = (page) => visible(page.getByTestId('ways-of-working-drawer')).first();
const interviewPart = (page, id) => visible(interview(page).getByTestId(id)).first();
const demoFolder = (e2e) => {
  const folder = e2e.project && e2e.project.folder;
  if (!folder) throw new Error('the demo project has no folder');
  return folder;
};

// the runs of the scratch workspace whose records name the ways-of-working seed
function waysOfWorkingRuns(e2e) {
  const runsDir = path.join(scratchOf(e2e), 'workspace', 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir).filter((id) => ['events.jsonl', 'summary.json', 'meta.json'].some((file) => {
    try { return /ways[-_ ]?of[-_ ]?working/i.test(fs.readFileSync(path.join(runsDir, id, file), 'utf8')); } catch { return false; }
  }));
}

Given('the demo project\'s folder is a git repository where one author commits straight to main', async ({ e2e }) => {
  const folder = demoFolder(e2e);
  fs.mkdirSync(folder, { recursive: true });
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(folder, `CHANGE-${i}.md`), `Change ${i} (simulated data)\n`);
    git(e2e, folder, ['add', '-A']);
    git(e2e, folder, ['commit', '-q', '-m', `Change ${i}`]);
  }
  git(e2e, folder, ['tag', 'v0.1.0']);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

When('I open the Ways of working interview', async ({ e2e }) => {
  const page = projectPageOf(e2e.window);
  await expect(page).toBeVisible({ timeout: LOAD_TIMEOUT });
  await page.getByTestId('project-ways-of-working').first().click();
  await expect(interview(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the interview shows the analysis\'s cost estimate before anything runs', async ({ e2e }) => {
  const estimate = interviewPart(e2e.window, 'ways-of-working-estimate');
  await expect(estimate).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(estimate).toContainText(/≈\s*US\$\s*\d|no estimate yet/i, { timeout: LOAD_TIMEOUT });
  await expect(interviewPart(e2e.window, 'ways-of-working-analyze')).toBeEnabled();
  await expect(visible(interview(e2e.window).getByTestId('ways-of-working-profile'))).toHaveCount(0);
  expect(waysOfWorkingRuns(e2e), 'ways-of-working runs in the workspace').toEqual([]);
});

When('I start the interview\'s analysis', async ({ e2e }) => {
  await interviewPart(e2e.window, 'ways-of-working-analyze').click();
  await expect(interviewPart(e2e.window, 'ways-of-working-profile')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
});

Then('the interview shows the inferred profile as {string} or {string} with its evidence', async ({ e2e }, a, b) => {
  const profile = interviewPart(e2e.window, 'ways-of-working-profile');
  await expect(profile).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(profile).toContainText(new RegExp(`\\b(${escapeRe(a)}|${escapeRe(b)})\\b`));
  const evidence = visible(interview(e2e.window).getByTestId('ways-of-working-evidence'));
  await expect(evidence.first(), 'the profile\'s evidence').toBeVisible({ timeout: LOAD_TIMEOUT });
  const n = await evidence.count();
  for (let i = 0; i < n; i++) await expect(evidence.nth(i)).not.toHaveText(/^\s*$/);
});

Then('the interview asks {string}, {string}, {string}, {string} and {string}, each with a default answer I can change', async ({ e2e }, q1, q2, q3, q4, q5) => {
  const labels = [q1, q2, q3, q4, q5];
  const questions = visible(interview(e2e.window).getByTestId('ways-of-working-question'));
  await expect(questions.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  // only the open questions: none beyond the ones named
  expect(await questions.count(), 'the interview asks only the open questions').toBeLessThanOrEqual(labels.length);
  for (const label of labels) {
    const q = questions.filter({ hasText: new RegExp(escapeRe(label), 'i') }).first();
    await expect(q, `the question "${label}"`).toBeVisible();
    const field = q.locator('select, input:not([type="radio"]):not([type="checkbox"]), textarea').first();
    if (await field.count()) {
      await expect(field, `the default answer of "${label}"`).toBeEnabled();
      await expect(field, `the default answer of "${label}"`).not.toHaveValue('');
    } else {
      const choices = q.locator('input[type="radio"], input[type="checkbox"]');
      await expect(choices.first(), `the answers of "${label}"`).toBeEnabled();
      // a radio group has one answer chosen by default; a single checkbox is its own answer
      if ((await q.locator('input[type="radio"]').count()) > 0) await expect(q.locator('input[type="radio"]:checked'), `the default answer of "${label}"`).toHaveCount(1);
    }
  }
});

Then('the interview proposes an {string}, a {string} and a {string} workflow', async ({ e2e }, c1, c2, c3) => {
  const categories = [c1, c2, c3];
  const set = interviewPart(e2e.window, 'ways-of-working-proposed');
  await expect(set).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  e2e.proposedWorkflows = {};
  for (const category of categories) {
    if (!CATEGORIES.includes(category)) throw new Error(`"${category}": expected one of ${CATEGORIES.join(', ')}`);
    const item = set.locator(`[data-testid="ways-of-working-proposed-workflow"][data-category="${category}"]`).first();
    await expect(item, `the proposed ${category} workflow`).toBeVisible();
    const name = (await item.getAttribute('data-name')) || '';
    expect(name.trim(), `the proposed ${category} workflow's name`).not.toBe('');
    await expect(item).toContainText(name.trim());
    e2e.proposedWorkflows[category] = name.trim();
  }
});

When('I click {string} in the interview', async ({ e2e }, label) => {
  await interview(e2e.window).getByRole('button', { name: label, exact: true }).click();
});

Then('the Builder shows the proposed {string} workflow', async ({ e2e }, category) => {
  const name = e2e.proposedWorkflows && e2e.proposedWorkflows[category];
  if (!name) throw new Error(`no proposed ${category} workflow was seen in the interview`);
  const field = visible(e2e.window.getByRole('textbox', { name: 'Workflow name', exact: true })).first();
  await expect(field).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(field).toHaveValue(name, { timeout: LOAD_TIMEOUT });
});

Then('the project\'s repository has no workflows from the interview', async ({ e2e }) => {
  const folder = demoFolder(e2e);
  expect(fs.existsSync(path.join(folder, '.multiagent', 'workflows')), '.multiagent/workflows/ in the repository').toBe(false);
  expect(fs.existsSync(path.join(folder, '.multiagent', 'project.yaml')), '.multiagent/project.yaml in the repository').toBe(false);
  await expect(visible(e2e.window.getByTestId('project-repository-workflow'))).toHaveCount(0);
});

Then('the project\'s repository holds the proposed workflows and their manifest, not committed', async ({ e2e }) => {
  const folder = demoFolder(e2e);
  const manifest = path.join(folder, '.multiagent', 'project.yaml');
  await expect.poll(() => fs.existsSync(manifest), { timeout: LOAD_TIMEOUT, message: '.multiagent/project.yaml written' }).toBe(true);
  const text = fs.readFileSync(manifest, 'utf8');
  for (const [category, name] of Object.entries(e2e.proposedWorkflows || {})) {
    expect(text, `the manifest declares the ${category} workflow "${name}"`).toContain(name);
  }
  const dir = path.join(folder, '.multiagent', 'workflows');
  expect(fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /\.ya?ml$/i.test(f)), 'workflow files in .multiagent/workflows/').toBe(true);
  // written, not committed: git sees them as new, and HEAD has no .multiagent/
  expect(git(e2e, folder, ['status', '--porcelain', '--untracked-files=all', '--', '.multiagent'])).toMatch(/project\.yaml/);
  expect(git(e2e, folder, ['ls-tree', '-r', '--name-only', 'HEAD', '--', '.multiagent'])).toBe('');
});

When('I close the interview', async ({ e2e }) => {
  await interviewPart(e2e.window, 'ways-of-working-close').click();
  await expect(visible(e2e.window.getByTestId('ways-of-working-drawer'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

When('I cancel the interview', async ({ e2e }) => {
  await interviewPart(e2e.window, 'ways-of-working-cancel').click();
});

Then('the interview is closed', async ({ e2e }) => {
  await expect(visible(e2e.window.getByTestId('ways-of-working-drawer'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('no ways-of-working analysis has run', async ({ e2e }) => {
  // give a run that was wrongly started time to write its folder
  await e2e.window.waitForTimeout(1500);
  expect(waysOfWorkingRuns(e2e), 'ways-of-working runs in the workspace').toEqual([]);
});

Then('the project page lists the proposed workflows as repository workflows', async ({ e2e }) => {
  const page = projectPageOf(e2e.window);
  await expect(page).toBeVisible({ timeout: LOAD_TIMEOUT });
  const listed = visible(page.getByTestId('project-repository-workflow'));
  const names = Object.values(e2e.proposedWorkflows || {});
  expect(names.length, 'proposed workflows seen in the interview').toBeGreaterThan(0);
  for (const name of names) await expect(listed.filter({ hasText: name }).first(), `the repository workflow "${name}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
});
