// Steps of a project's Overview "Workflows" block (#486, #729) and of the Ways of working interview (#487, #733).
// (#741: the project dialog's Create mode and its #486 steps are gone; creating a project is the wizard only.)
// Opening Projects and a project's page reuses app.steps.js and projects.steps.js.
//
// What the screens expose (the renderer's contract for these steps), skills/ui-conventions:
// - data-testid="project-workflows-block": the Workflows block of the project's Overview
//   (data-testid="project-overview"; the project dialog is gone, #741);
// - #741: the project dialog's Create mode (its categories, hints and "Create one for this project") is gone:
//   creating a project is the new-project wizard only; the steps of that mode below fail with that reason;
// - data-testid="project-default-workflow": in the Overview's block, the project's default workflow's name.
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

const projectOverview = (page) => visible(page.getByTestId('project-page')).first().getByTestId('project-overview').first();
const blockIn = (scope) => scope.getByTestId('project-workflows-block').first();
const overviewBlock = (page) => blockIn(projectOverview(page));
// the scenario's scratch folder (the workspace is <scratch>/workspace)
function scratchOf(e2e) {
  const scratch = e2e.scratch || (process.env.MULTIAGENT_WORKSPACE && path.dirname(process.env.MULTIAGENT_WORKSPACE));
  if (!scratch) throw new Error('no scratch folder: open the app first');
  return scratch;
}

function git(e2e, cwd, args) {
  const config = path.join(scratchOf(e2e), 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

// #741: the project dialog's Create mode is gone (creating a project is the new-project wizard only), and
// with it #486's scenarios that created a project there and their steps.

// #729: the Overview's block no longer lists checkboxes; #486's "checked on the Overview" became
// "a card on the Overview" (steps below: "shows exactly the card(s)", "shows no card", the Default badge).

// ---- the project's workflows as cards (#729, fronts/build/features/project-workflows-729.feature) ----------------------
// The Overview's Workflows block (data-testid="project-workflows-block") shows only the workflows added
// to the project, one card each, no checkbox. What the screen exposes (the renderer's contract):
// - data-testid="pj-wf-card": one card per workflow of the project, data-workflow-id="<workflow name>"
//   (the name kept in the project's `workflows`), its text holding the name and the category;
// - data-testid="pj-wf-default-badge": in the default workflow's card only, text "Default";
// - data-testid="pj-wf-make-default" / "pj-wf-remove": the card's "Make default" / "Remove" buttons;
// - data-testid="pj-wf-add": the block's "+ Add a workflow" button (with or without cards);
// - data-testid="pj-wf-empty": the empty state's text, when the project has no workflow;
// - data-testid="pj-wf-add-dialog": the dialog of installed workflows not on the project (role="dialog"),
//   its search field data-testid="pj-wf-add-search", one data-testid="pj-wf-add-option" per workflow
//   offered, data-workflow-id="<workflow name>"; picking an option adds it and closes the dialog.
// The demo project's workflows are written in the scratch workspace's project record (as #486's Create
// project does: { name, origin, category } and defaultWorkflow), then the app reloads.

const enginePath = (...p) => path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', ...p);
const BUNDLED_CATEGORY = { feature: 'build', fix: 'build', refactor: 'build', release: 'build', issue: 'plan' };
const cards = (page) => overviewBlock(page).getByTestId('pj-wf-card');
const cardOf = (page, name) => overviewBlock(page).locator(`[data-testid="pj-wf-card"][data-workflow-id="${name}"]`);
const addDialog = (page) => visible(page.getByTestId('pj-wf-add-dialog')).first();
const addOptionOf = (page, name) => addDialog(page).locator(`[data-testid="pj-wf-add-option"][data-workflow-id="${name}"]`);
// "a", "a" and "b", "a", "b" and "c" → [a, b, c]
const namesOf = (...names) => names.filter((n) => typeof n === 'string');

async function setDemoWorkflows(e2e, names, defaultWorkflow) {
  if (!e2e.project || !e2e.project.id) throw new Error('no demo project: open the app first');
  const projects = require(enginePath('domains', 'project', 'projects'));
  const workflows = names.map((name) => ({ name, origin: 'bundled', category: BUNDLED_CATEGORY[name] || 'build' }));
  projects.updateProject(path.join(scratchOf(e2e), 'workspace', 'projects'), e2e.project.id, { workflows, defaultWorkflow });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the demo project has the workflows {string} and {string}, with {string} as its default', async ({ e2e }, a, b, def) => {
  await setDemoWorkflows(e2e, [a, b], def);
});

Given('the demo project has no workflow', async ({ e2e }) => {
  await setDemoWorkflows(e2e, [], null);
});

async function expectExactCards(e2e, names) {
  const block = overviewBlock(e2e.window);
  await expect(block).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const name of names) await expect(cardOf(e2e.window, name), `the workflow card "${name}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cards(e2e.window), `only the project's workflows (${names.join(', ')})`).toHaveCount(names.length);
}

Then('the project\'s Workflows block shows exactly the card {string}', async ({ e2e }, a) => {
  await expectExactCards(e2e, namesOf(a));
});

Then('the project\'s Workflows block shows no card {string}', async ({ e2e }, name) => {
  await expect(overviewBlock(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cardOf(e2e.window, name), `no workflow card "${name}"`).toHaveCount(0);
});

Then('the project\'s Workflows block shows exactly the cards {string} and {string}', async ({ e2e }, a, b) => {
  await expectExactCards(e2e, namesOf(a, b));
});

Then('the project\'s Workflows block shows exactly the cards {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  await expectExactCards(e2e, namesOf(a, b, c));
});

Then('the project\'s Workflows block lists no workflow as a checkbox', async ({ e2e }) => {
  const block = overviewBlock(e2e.window);
  await expect(block).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(block.getByRole('checkbox')).toHaveCount(0);
});

Then('the workflow card {string} has the {string} badge', async ({ e2e }, name, label) => {
  const badge = cardOf(e2e.window, name).getByTestId('pj-wf-default-badge');
  await expect(badge, `the "${label}" badge on "${name}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(badge).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`, 'i'));
  // one default per project
  await expect(overviewBlock(e2e.window).getByTestId('pj-wf-default-badge')).toHaveCount(1);
});

Then('the workflow card {string} has no {string} badge', async ({ e2e }, name, label) => {
  const card = cardOf(e2e.window, name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('pj-wf-default-badge'), `no "${label}" badge on "${name}"`).toHaveCount(0);
});

Then('the workflow card {string} shows the category {string} and offers {string} and {string}', async ({ e2e }, name, category, makeDefault, remove) => {
  const card = cardOf(e2e.window, name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(name);
  await expect(card).toContainText(new RegExp(`\\b${escapeRe(category)}\\b`, 'i'));
  await expect(card.getByTestId('pj-wf-make-default')).toHaveText(new RegExp(`^\\s*${escapeRe(makeDefault)}\\s*$`));
  await expect(card.getByTestId('pj-wf-make-default')).toBeEnabled();
  await expect(card.getByTestId('pj-wf-remove')).toHaveText(new RegExp(`^\\s*${escapeRe(remove)}\\s*$`));
  await expect(card.getByTestId('pj-wf-remove')).toBeEnabled();
});

Then('the project\'s Workflows block looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(overviewBlock(e2e.window)).toHaveScreenshot(name);
});

When('I click {string} in the project\'s Workflows block', async ({ e2e }, label) => {
  const add = overviewBlock(e2e.window).getByTestId('pj-wf-add');
  await expect(add).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`), { timeout: LOAD_TIMEOUT });
  await add.click();
  await expect(addDialog(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the add-a-workflow dialog offers {string}', async ({ e2e }, name) => {
  await expect(addOptionOf(e2e.window, name), `"${name}" offered`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the add-a-workflow dialog offers {string} and {string}', async ({ e2e }, a, b) => {
  for (const name of [a, b]) await expect(addOptionOf(e2e.window, name), `"${name}" offered`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the add-a-workflow dialog does not offer {string}', async ({ e2e }, name) => {
  await expect(addOptionOf(e2e.window, name), `"${name}" not offered`).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the add-a-workflow dialog does not offer {string} or {string}', async ({ e2e }, a, b) => {
  await expect(addDialog(e2e.window).getByTestId('pj-wf-add-option').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const name of [a, b]) await expect(addOptionOf(e2e.window, name), `"${name}" not offered`).toHaveCount(0);
});

When('I search {string} in the add-a-workflow dialog', async ({ e2e }, text) => {
  await addDialog(e2e.window).getByTestId('pj-wf-add-search').fill(text);
});

When('I pick {string} in the add-a-workflow dialog', async ({ e2e }, name) => {
  await addOptionOf(e2e.window, name).click();
});

Then('the add-a-workflow dialog is closed', async ({ e2e }) => {
  await expect(visible(e2e.window.getByTestId('pj-wf-add-dialog'))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the project\'s Workflows block says {string}', async ({ e2e }, text) => {
  const empty = overviewBlock(e2e.window).getByTestId('pj-wf-empty');
  await expect(empty).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(empty).toContainText(text);
});

Then('the project\'s Workflows block shows no workflow card', async ({ e2e }) => {
  await expect(overviewBlock(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cards(e2e.window)).toHaveCount(0);
});

Then('the project\'s Workflows block offers {string}', async ({ e2e }, label) => {
  const add = overviewBlock(e2e.window).getByTestId('pj-wf-add');
  await expect(add).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(add).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await expect(add).toBeEnabled();
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

// ---- #733: the drawer opens on the project's last analysis -------------------------------------------------------------
// With a saved ways-of-working analysis (the onboarding's profile job, or an Analyze in the drawer) the drawer opens
// on it with no click: ways-of-working-profile (its evidence), the "Open questions" section (a region of that
// name, as today), ways-of-working-proposed; a line "Analyzed on <date>"; a secondary button "Analyze again"
// (not the footer's primary). With none: the first screen, its intro (data-testid="ways-of-working-intro", NEW),
// the cost and Analyze, and no "Analyzed on".
const ANALYZED_ON = /Analyzed on\s+\S*\d/i;

Then('the interview shows the saved profile with its evidence, its open questions and the proposed workflows', async ({ e2e }) => {
  const drawer = interview(e2e.window);
  // no click: the saved analysis shows as the drawer opens
  await expect(interviewPart(e2e.window, 'ways-of-working-profile')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  const evidence = visible(drawer.getByTestId('ways-of-working-evidence'));
  await expect(evidence.first(), 'the profile\'s evidence').toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(evidence.first()).not.toHaveText(/^\s*$/);
  await expect(drawer.getByRole('region', { name: 'Open questions', exact: true }), 'the open questions').toBeVisible();
  const proposed = interviewPart(e2e.window, 'ways-of-working-proposed');
  await expect(proposed).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(visible(proposed.getByTestId('ways-of-working-proposed-workflow')).first(), 'a proposed workflow').toBeVisible();
});

Then('the interview says when the repository was analyzed', async ({ e2e }) => {
  await expect(visible(interview(e2e.window).getByText(ANALYZED_ON)).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the interview does not say when the repository was analyzed', async ({ e2e }) => {
  const drawer = interview(e2e.window);
  await expect(drawer).toBeVisible();
  await expect(visible(drawer.getByText(/Analyzed on/i))).toHaveCount(0);
  await expect(visible(drawer.getByRole('button', { name: /Analyze again/i }))).toHaveCount(0);
});

Then('the interview offers {string} as a secondary action', async ({ e2e }, label) => {
  const button = visible(interview(e2e.window).getByRole('button', { name: label, exact: true })).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toBeEnabled();
  await expect(button, `"${label}" is not the primary action`).not.toHaveClass(/\bprimary\b/);
});

Then('the interview introduces the analysis', async ({ e2e }) => {
  const intro = interviewPart(e2e.window, 'ways-of-working-intro');
  await expect(intro).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(intro).toHaveText(/\S/);
});
