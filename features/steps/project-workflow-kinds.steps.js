// Steps of features/790-791-project-workflow-kinds.feature (#790, #791): the default workflow from the
// project and its manifest, and the Product Owner's kinds. Reuses the wizard's steps (onboarding.steps.js),
// the drawer's (fronts/build/features/steps/backlog.steps.js), "I open the project {string} from the
// Projects screen" (projects.steps.js) and "I choose the project {string} in the header" (app.steps.js).
// The plan is the simulated Product Owner's: one group per issue here, classified from the labels.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps), inside the drawer (aside "Product Owner"):
// - po-recommendation: a recommendation's card (`.po-group`), holding its issue links (title = the issue's);
// - po-kind-summary: the plan's summary by kind; po-kind-group-<kind>: the section of a kind's recommendations;
// - on a recommendation: po-kind-badge (data-kind), po-kind-control with po-kind-choice-feature / -fix / -other
//   (aria-pressed), and, once Other is chosen, po-kind-other-select: a select whose option values are workflow
//   files (select.js makes it searchable); po-decision-workflow and po-decision-mode (exist, #785);
// - the combobox "Workflow of the filed issue" next to Create + roadmap (exists), its default marked "(default)".
// On the project page: project-kind-workflow-feature / -fix, selects whose option values are workflow files.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { fileOf } = require('../support/workflows');

const root = path.join(__dirname, '..', '..');
const engine = (...p) => require(path.join(root, 'packages', 'engine', ...p));
const LOAD_TIMEOUT = 30000;
const KINDS = { Feature: 'feature', Fix: 'fix', Other: 'other' };
const stem = (name) => fileOf(name).replace(/\.yaml$/, '');

function kindOf(label) {
  expect(KINDS[label], `the kind "${label}" (known: ${Object.keys(KINDS).join(', ')})`).toBeTruthy();
  return KINDS[label];
}

// a git commit of everything in `folder` (fixed identity, no machine config)
function commitAll(scratch, folder) {
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Declare the repository workflows']);
}

function writeFiles(folder, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), text);
  }
}

const openWorkspace = (e2e) => engine('domains', 'workspace', 'workspace').setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });

// a project of the workspace, by name
function projectNamed(e2e, name) {
  const project = engine('domains', 'project', 'projects').listProjects(openWorkspace(e2e).projects).find((p) => p.name === name);
  expect(project, `the project "${name}"`).toBeTruthy();
  return project;
}

// The project's synced backlog, as a sync leaves it; issues: [{ title, labels }]. The Backlog and the
// Product Owner read it when they open, so the app needs no reload.
function writeBacklog(e2e, name, issues) {
  const project = projectNamed(e2e, name);
  const { taskProgress } = engine('domains', 'backlog', 'backlog');
  const { backlog: dir } = openWorkspace(e2e);
  const now = new Date().toISOString();
  const list = issues.map(({ title, labels = [] }, i) => ({
    number: i + 1, title, state: 'open', labels: labels.map((label) => ({ name: label })), body: '', url: `${project.repo}/issues/${i + 1}`,
    author: 'octocat', assignees: [], tasks: taskProgress(''), createdAt: now, updatedAt: now,
  }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo: project.repo, syncedAt: now, issues: list, epics: [], epicsError: null }, null, 2));
}

// ---- #790: the manifest's default --------------------------------------------------------------------

// the default is listed last: the first build workflow of the manifest is another one
Given('a local git repository whose manifest has {string} as its default workflow is ready to import', async ({ e2e }, name) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const folder = path.join(e2e.scratch, 'folders', 'sample-repo');
  writeFiles(folder, {
    'README.md': '# sample-repo\n',
    'package.json': JSON.stringify({ name: 'sample-repo', private: true, scripts: { test: 'node -e ""' } }, null, 2),
    '.multiagent/project.yaml': `version: 1\ndefault: ${stem(name)}\nworkflows:\n  - name: feature\n    category: solo\n  - name: ${stem(name)}\n    category: solo\n`,
  });
  commitAll(e2e.scratch, folder);
  e2e.localRepo = pathToFileURL(folder).href;
});

Given('the backlog of {string} has the open issue {string}', async ({ e2e }, name, title) => {
  writeBacklog(e2e, name, [{ title }]);
});

Then("the Product Owner's workflow select shows {string} as the default", async ({ e2e }, name) => {
  const select = poDrawer(e2e.window).getByRole('combobox', { name: 'Workflow of the filed issue', exact: true });
  await expect(select).toHaveValue(fileOf(name), { timeout: LOAD_TIMEOUT });
  await expect(select.locator('option:checked')).toContainText('(default)');
});

Then('Settings has no {string} control', async ({ e2e }, label) => {
  const page = e2e.window;
  await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveCount(0);
  await expect(page.getByText(label, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByTestId('settings-default-workflow')).toHaveCount(0);
});

// ---- #791: the project's workflow per kind -----------------------------------------------------------

// What a clone of this repository leaves: a checkout whose manifest maps the kinds, its workflows on the
// project. Its own workflow is a copy of a bundled one that takes a task, under another name.
Given('the workspace has a project {string} whose repository declares its own workflow {string}, with {string} for Features and {string} in {word} mode for Fixes', async ({ e2e }, name, own, feature, fix, mode) => {
  const projects = engine('domains', 'project', 'projects');
  const dir = openWorkspace(e2e).projects;
  const created = await projects.createProject(dir, { name, description: 'A project with kinds (simulated data)' });
  const workflows = [
    { name: stem(feature), origin: 'manifest', category: 'solo' },
    { name: stem(fix), origin: 'manifest', category: 'fix' },
    { name: own, file: `workflows/${own}.yaml`, origin: 'manifest', category: 'solo' },
  ];
  const project = projects.updateProject(dir, created.id, { repo: `https://github.com/example/${name}`, workflows, defaultWorkflow: stem(feature) });
  const yaml = fs.readFileSync(path.join(root, 'workflows', 'test-backfill.yaml'), 'utf8').replace(/^(\s*name:\s*)test-backfill\s*$/m, `$1${own}`);
  writeFiles(project.folder, {
    '.multiagent/project.yaml': [
      'version: 1',
      `default: ${stem(feature)}`,
      'kinds:',
      `  feature: { name: ${stem(feature)} }`,
      `  fix: { name: ${stem(fix)}, mode: ${mode.toLowerCase()} }`,
      'workflows:',
      ...workflows.flatMap((w) => [`  - name: ${w.name}`, ...(w.file ? [`    file: ${w.file}`] : []), `    category: ${w.category}`]),
      '',
    ].join('\n'),
    [`.multiagent/workflows/${own}.yaml`]: yaml,
  });
  commitAll(e2e.scratch, project.folder);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Given('the backlog of {string} has the open bug {string} and the open issue {string}', async ({ e2e }, name, bug, title) => {
  writeBacklog(e2e, name, [{ title: bug, labels: ['bug'] }, { title }]);
});

// ---- the plan ----------------------------------------------------------------------------------------

function poDrawer(page) {
  return page.getByRole('complementary', { name: 'Product Owner', exact: true });
}
const recommendation = (page, title) => poDrawer(page).getByTestId('po-recommendation').filter({ has: page.getByTitle(title, { exact: true }) });
const otherSelect = (page, title) => recommendation(page, title).getByTestId('po-kind-other-select');

async function expectWorkflow(page, title, workflow) {
  await expect(recommendation(page, title).getByTestId('po-decision-workflow')).toContainText(workflow, { ignoreCase: true, timeout: LOAD_TIMEOUT });
}

Then('the plan sums up its runs as {string}', async ({ e2e }, text) => {
  await expect(poDrawer(e2e.window).getByTestId('po-kind-summary')).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the plan lists the issue {string} under {string}', async ({ e2e }, title, label) => {
  const group = poDrawer(e2e.window).getByTestId(`po-kind-group-${kindOf(label)}`);
  await expect(group.getByTitle(title, { exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the recommendation for {string} shows the {string} badge', async ({ e2e }, title, label) => {
  const badge = recommendation(e2e.window, title).getByTestId('po-kind-badge');
  await expect(badge).toHaveAttribute('data-kind', kindOf(label), { timeout: LOAD_TIMEOUT });
  await expect(badge).toContainText(label);
});

Then('the recommendation for {string} runs the workflow {string}', async ({ e2e }, title, workflow) => {
  await expectWorkflow(e2e.window, title, workflow);
});

Then('the recommendation for {string} runs the workflow {string} in {string} mode', async ({ e2e }, title, workflow, mode) => {
  await expectWorkflow(e2e.window, title, workflow);
  await expect(recommendation(e2e.window, title).getByTestId('po-decision-mode')).toContainText(mode);
});

// the list of every workflow opens only with Other
Then('the recommendation for {string} offers {string}, {string} and {string}, with {string} selected', async ({ e2e }, title, a, b, c, selected) => {
  const control = recommendation(e2e.window, title).getByTestId('po-kind-control');
  for (const label of [a, b, c]) {
    const choice = control.getByTestId(`po-kind-choice-${kindOf(label)}`);
    await expect(choice).toContainText(label, { timeout: LOAD_TIMEOUT });
    await expect(choice).toHaveAttribute('aria-pressed', String(label === selected));
  }
  if (selected !== 'Other') await expect(otherSelect(e2e.window, title)).toBeHidden();
});

When('I choose {string} on the recommendation for {string}', async ({ e2e }, label, title) => {
  await recommendation(e2e.window, title).getByTestId(`po-kind-choice-${kindOf(label)}`).click();
});

Then('the workflow list of the recommendation for {string} offers', async ({ e2e }, title, table) => {
  const select = otherSelect(e2e.window, title);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  const offered = await select.locator('option').evaluateAll((options) => options.map((o) => o.value));
  expect(offered).toEqual(expect.arrayContaining(table.hashes().map(({ workflow }) => fileOf(workflow))));
});

When('I pick {string} from the workflow list of the recommendation for {string}', async ({ e2e }, workflow, title) => {
  await otherSelect(e2e.window, title).selectOption(fileOf(workflow));
});

// ---- the project page's Workflows block --------------------------------------------------------------

const kindWorkflow = (page, label) => page.getByTestId('project-page').filter({ visible: true }).first().getByTestId(`project-kind-workflow-${kindOf(label)}`);

Then("the project's {string} workflow is {string}", async ({ e2e }, label, workflow) => {
  await expect(kindWorkflow(e2e.window, label)).toHaveValue(fileOf(workflow), { timeout: LOAD_TIMEOUT });
});

When("I change the project's {string} workflow to {string}", async ({ e2e }, label, workflow) => {
  await kindWorkflow(e2e.window, label).selectOption(fileOf(workflow));
});
