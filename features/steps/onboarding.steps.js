// Steps of features/onboarding.feature (#641, onboarding step 4 of docs/work/first-project-onboarding/plan.md):
// the new-project wizard (fronts/build/views/projects/project-wizard.js) and the onboarding's progress
// tray. Opening the app reuses app.steps.js ("the app is open").
//
// What the screens expose (the renderer's contract for these steps), skills/ui-conventions:
// - data-testid="project-wizard": the wizard; its steps carry data-step="start|repository|analysis|review",
//   the current one aria-current="step";
// - wizard-source-import / wizard-source-new: step 1's cards; wizard-next / wizard-back / wizard-close;
// - wizard-repo, wizard-name: step 2's inputs; wizard-provider; wizard-import-status;
// - wizard-error (data-error="no-access" | "clone-failed"), with a role="button" named /Retry/;
//   wizard-cli-warning (gh / glab missing: a warning, the import goes on);
// - wizard-cost, wizard-cost-total and its part data-part="projectMap" (#730: no "ranking"); wizard-analyze, wizard-skip;
// - data-testid="onboarding-tray": the progress tray, outside the wizard; each project a
//   data-testid="tray-item" with data-status="cloning|analyzing|ready|analyzed|failed", holding the
//   project's name, and when failed the reason in words and a role="button" named /Retry/.
//
// A reachable repository without network: a local git repository under the scenario's scratch folder,
// imported by its file:// URL (git ls-remote and git clone accept it; no provider, so no gh / glab check).
//
// #642 (onboarding step 5): the review and the project page's "Next steps" card.
// - data-testid="wizard-review": the review step's body; wizard-review-city (the project's city),
//   wizard-review-backlog (the backlog), wizard-review-refactors (the refactor backlog), its rows
//   data-testid="wizard-review-refactor", each a role="checkbox" named by the refactor's title (the pick),
//   the file's score (0 to 100) and its quadrant (Danger Zone, Cowboy Code, Fertile Ground, Healthy Closure);
//   wizard-review-idea: the idea's text field; wizard-finish: Finish (any time, never waits for an analysis);
// - data-testid="project-next-steps": the card on the project page, its entries links or buttons named by
//   what they do (the refactors to the roadmap, the first idea, the refactor cadence); next-steps-dismiss.
// An analysis still running: another holder of the analysis slot (packages/engine/engine/machine-slot.js) in
// a folder of the scenario's own (MULTIAGENT_LOCKS_DIR), so the project map waits and the analysis stays on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the access check (git ls-remote, up to 30 s in the engine) and a local clone
const IMPORT_TIMEOUT = 45000;

const wizard = (page) => page.getByTestId('project-wizard');
const currentStep = (page) => wizard(page).locator('[aria-current="step"]').first();
const tray = (page) => page.getByTestId('onboarding-tray');
// the name is its own element (the tray's <strong>), read as text with no word after it: "missing-641failed" has no \b
const trayItem = (page, name) => tray(page).getByTestId('tray-item').filter({ has: page.getByText(name, { exact: true }) });
// an amount of money ("$0.42", "$ 1", "0.42 USD") or an estimate said unknown (onboarding-model's
// costSummary: a missing estimate is null, never $0)
const AMOUNT = /\$\s?\d|\d(\.\d+)?\s*USD\b|unknown|not known|no estimate/i;

// a source file with branches (a measurable complexity), its version n so later commits change it
const sourceFile = (n) => `function route(kind, value) {\n  if (kind === 'a') return value + ${n};\n  if (kind === 'b') { for (let i = 0; i < value; i++) if (i % 2) return i; }\n  switch (kind) { case 'c': return -value; case 'd': return value * 2; default: return ${n}; }\n}\nmodule.exports = { route };\n`;

// a git repository with one commit (fixed identity, no machine config); withCode: a few source files
// and more commits on one of them, so the analysis has files to score (complexity and churn)
function makeRepository(scratch, name, { withCode = false } = {}) {
  const folder = path.join(scratch, 'folders', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e ""' } }, null, 2));
  if (withCode) {
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'src', 'router.js'), sourceFile(0));
    fs.writeFileSync(path.join(folder, 'src', 'util.js'), 'const add = (a, b) => a + b;\nmodule.exports = { add };\n');
  }
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  if (withCode) {
    for (let n = 1; n <= 3; n++) {
      fs.writeFileSync(path.join(folder, 'src', 'router.js'), sourceFile(n));
      git(['commit', '-q', '-am', `Change the router (${n})`]);
    }
  }
  return pathToFileURL(folder).href;
}

Given('a local git repository is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo');
});

Given('a local git repository with some code is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo', { withCode: true });
});

// the app's machine slots in a folder of this scenario's own (never the machine's: no other run waits),
// where the analysis slot is held by this test process (alive, so never stale) until the app closes
Given("the app is open while another analysis holds the machine's analysis slot", async ({ e2e }) => {
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-e2e-locks-'));
  const slots = require('@multiagent/engine/engine/machine-slot');
  fs.writeFileSync(slots.slotFile(slots.ANALYSIS_SLOT, locks), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'e2e-642', started: Date.now(), holder: 'another analysis (e2e)' }));
  await e2e.open({ env: { MULTIAGENT_LOCKS_DIR: locks } });
  const close = e2e.close;
  e2e.close = async () => { await close(); fs.rmSync(locks, { recursive: true, force: true }); };
});

// The page global opens the wizard directly; Projects › New project and the Setup's last step also
// open it since #643 (features/setup-projects-onboarding.feature drives those paths). #726: the app is
// ready when its sidebar shows, whatever the interface language (no wait on the English "Home")
When('I open the project wizard', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').first().getByRole('button').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => typeof window.ProjectWizard?.open === 'function', null, { timeout: LOAD_TIMEOUT });
  await page.evaluate(() => window.ProjectWizard.open());
  await expect(wizard(page)).toBeVisible();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'start');
});

When('I choose to import a repository in the wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-source-import').click();
  // a card may move on by itself, or wait for Next
  if ((await currentStep(page).getAttribute('data-step')) === 'start') await wizard(page).getByTestId('wizard-next').click();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'repository');
});

async function enterRepository(page, repo, name) {
  await wizard(page).getByTestId('wizard-repo').fill(repo);
  await wizard(page).getByTestId('wizard-name').fill(name);
}

When('I enter the repository {string} and the project name {string}', async ({ e2e }, repo, name) => {
  await enterRepository(e2e.window, repo, name);
});

When('I enter the local repository and the project name {string}', async ({ e2e }, name) => {
  if (!e2e.localRepo) throw new Error('no local repository: use "a local git repository is ready to import" first');
  await enterRepository(e2e.window, e2e.localRepo, name);
});

When('I go to the next step of the wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-next').click();
});

Then('the wizard is on its {string} step', async ({ e2e }, step) => {
  await expect(currentStep(e2e.window)).toHaveAttribute('data-step', step, { timeout: IMPORT_TIMEOUT });
});

Then('the wizard says the repository could not be reached and offers to retry', async ({ e2e }) => {
  const error = wizard(e2e.window).getByTestId('wizard-error');
  await expect(error).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(error).toHaveAttribute('data-error', 'no-access');
  await expect(error).toContainText(/could not be reached/i);
  await expect(error.getByRole('button', { name: /Retry/ })).toBeVisible();
});

Then('the progress tray shows the project {string} as failed with its reason and a Retry', async ({ e2e }, name) => {
  const item = trayItem(e2e.window, name);
  await expect(item).toHaveAttribute('data-status', 'failed', { timeout: IMPORT_TIMEOUT });
  await expect(item).toContainText(/could not be reached/i);
  await expect(item.getByRole('button', { name: /Retry/ })).toBeVisible();
});

Then('the progress tray shows the project {string} as {word}', async ({ e2e }, name, status) => {
  await expect(trayItem(e2e.window, name)).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
});

// #730: the project map is the only paid part (no refactor ranking)
Then('the wizard shows the analysis cost in total and for the project map', async ({ e2e }) => {
  const cost = wizard(e2e.window).getByTestId('wizard-cost');
  await expect(cost).toBeVisible();
  await expect(cost.getByTestId('wizard-cost-total')).toContainText(AMOUNT);
  const row = cost.locator('[data-part="projectMap"]');
  await expect(row, "the cost's project map part").toBeVisible();
  await expect(row).toContainText(AMOUNT);
});

Then('the wizard offers to start the analysis', async ({ e2e }) => {
  // #725: the analysis starts from the workflows column's "Analyze the repository" choice
  // ("Analyze and continue", wizard-analyze, is gone).
  const analyze = wizard(e2e.window).getByTestId('wizard-workflows-choice-analyze');
  await expect(analyze).toBeEnabled();
  await expect(analyze).toContainText(/Analyze the repository/i);
});

When('I skip the analysis for later', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-skip').click();
});

// a confirm, if closing asks one, is accepted (the import goes on in the tray either way)
When('I close the project wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-close').click();
  const confirm = page.getByTestId('confirm-modal');
  // the wizard has closed, or a confirm asks first
  await expect.poll(async () => (await confirm.isVisible()) || !(await wizard(page).isVisible())).toBe(true);
  if (await confirm.isVisible()) {
    await confirm.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
    await expect(confirm).toBeHidden();
  }
});

// #643: opened from the Setup's last step or Projects › New project (not the old project dialog)
Then('the project wizard is open on its first step', async ({ e2e }) => {
  const page = e2e.window;
  await expect(wizard(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(currentStep(page)).toHaveAttribute('data-step', 'start');
  await expect(page.getByTestId('project-dialog').filter({ visible: true })).toHaveCount(0);
});

Then('the project wizard is not shown', async ({ e2e }) => {
  await expect(wizard(e2e.window)).toBeHidden();
});

// ---- #669: step 1 as in docs/work/first-project-onboarding/images/mock-1.jpg -----------------------------
// - the title is a heading of the wizard, the intro line its own text;
// - data-testid="wizard-steps": the numbered steps, each a data-testid="wizard-step-pill" reading its
//   number then its label ("1 Start"), the current one aria-current="step";
// - each card of step 1 (wizard-source-import / wizard-source-new) holds a data-testid="wizard-card-icon"
//   and its points as list items; Create new project is disabled (or aria-disabled);
// - data-testid="wizard-other-sources": "Other sources:" and its links (or buttons) named by the source;
// - data-testid="wizard-footer": wizard-cancel (Cancel, left) and wizard-next (Next, right).

const sourceCard = (page, title) => wizard(page).locator('[data-testid^="wizard-source-"]').filter({ hasText: title });
const otherSources = (page) => wizard(page).getByTestId('wizard-other-sources');
const otherSource = (page, name) => otherSources(page).getByRole('link', { name, exact: true })
  .or(otherSources(page).getByRole('button', { name, exact: true }));
const footer = (page) => wizard(page).getByTestId('wizard-footer');

Then("the wizard's title reads {string}", async ({ e2e }, title) => {
  await expect(wizard(e2e.window).getByRole('heading', { name: title, exact: true })).toBeVisible();
});

Then('the wizard says {string}', async ({ e2e }, text) => {
  await expect(wizard(e2e.window).getByText(text, { exact: true })).toBeVisible();
});

Then("the wizard's steps read {string}, {string}, {string} and {string}, numbered from 1, with {string} current", async ({ e2e }, a, b, c, d, current) => {
  const pills = wizard(e2e.window).getByTestId('wizard-steps').getByTestId('wizard-step-pill');
  const labels = [a, b, c, d];
  await expect(pills).toHaveText(labels.map((label, i) => new RegExp(`^\\s*${i + 1}\\s*${escapeRe(label)}\\s*$`)));
  for (const label of labels) {
    const pill = pills.filter({ hasText: label });
    if (label === current) await expect(pill, `the step "${label}" is current`).toHaveAttribute('aria-current', 'step');
    else await expect(pill, `the step "${label}" is not current`).not.toHaveAttribute('aria-current', 'step');
  }
});

Then("the wizard's {string} card has an icon and the points {string}, {string} and {string}", async ({ e2e }, title, a, b, c) => {
  const card = sourceCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('wizard-card-icon')).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveText([a, b, c]);
});

Then("the wizard's {string} card cannot be chosen", async ({ e2e }, title) => {
  await expect(sourceCard(e2e.window, title)).toBeDisabled();
});

// #632: Create new project is enabled (mock-1 no longer marks it "soon")
Then("the wizard's {string} card can be chosen", async ({ e2e }, title) => {
  const card = sourceCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card).toBeEnabled();
  await expect(card).not.toHaveAttribute('aria-disabled', 'true');
  await expect(card).not.toContainText(/\bsoon\b/i);
});

Then('the wizard offers the other sources {string} and {string}', async ({ e2e }, a, b) => {
  await expect(otherSources(e2e.window)).toContainText('Other sources');
  for (const name of [a, b]) await expect(otherSource(e2e.window, name), `the other source "${name}"`).toBeVisible();
});

Then("the wizard's footer has {string} on the left and {string} on the right", async ({ e2e }, left, right) => {
  const page = e2e.window;
  const bar = footer(page);
  const leftButton = bar.getByRole('button', { name: left, exact: true });
  const rightButton = bar.getByRole('button', { name: right, exact: true });
  await expect(leftButton).toBeVisible();
  await expect(rightButton).toBeVisible();
  const [box, l, r] = await Promise.all([bar.boundingBox(), leftButton.boundingBox(), rightButton.boundingBox()]);
  const middle = box.x + box.width / 2;
  expect(l.x + l.width, `"${left}" in the footer's left half`).toBeLessThanOrEqual(middle);
  expect(r.x, `"${right}" in the footer's right half`).toBeGreaterThanOrEqual(middle);
});

When('I choose the other source {string} in the wizard', async ({ e2e }, name) => {
  await otherSource(e2e.window, name).click();
});

Then("the wizard's git URL field is ready to type in", async ({ e2e }) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await expect(field).toBeVisible();
  await expect(field).toBeEditable();
  await expect(field).toBeFocused();
});

When('I cancel the project wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-cancel').click();
});

// ---- #642: the review, Finish and the project page's "Next steps" card ----------------------------------

// the simulated analysis: the free part and the project map (#730: no refactor ranking), without a model call
const ANALYSIS_TIMEOUT = 90000;
// Finish never waits for an analysis: the wizard is gone well before any job could end
const FINISH_TIMEOUT = 5000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const review = (page) => wizard(page).getByTestId('wizard-review');
const projectPage = (page) => page.getByTestId('project-page').filter({ visible: true }).first();
const nextSteps = (page) => projectPage(page).getByTestId('project-next-steps');
// an entry of the card (mock-7): its title and line say what it does ("roadmap", "idea"…), its button
// acts ("File and add", "Open Inbox", "Turn on"); the first entry whose text has the words
const nextStepsEntry = (page, words) => nextSteps(page).getByTestId(/^next-step-/)
  .filter({ hasText: new RegExp(escapeRe(words), 'i') }).first();
const nextStepsAction = (page, words) => nextStepsEntry(page, words).getByRole('button').first();

When('I start the analysis in the wizard', async ({ e2e }) => {
  // #725: "Analyze the repository" in the workflows column starts the analysis (the step stays put).
  await wizard(e2e.window).getByTestId('wizard-workflows-choice-analyze').click();
});

Then("the review shows the project's city and its backlog", async ({ e2e }) => {
  const page = e2e.window;
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByTestId('wizard-review-city')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(review(page).getByTestId('wizard-review-backlog')).toBeVisible();
});

When('I type the idea {string} in the review', async ({ e2e }, idea) => {
  await review(e2e.window).getByTestId('wizard-review-idea').fill(idea);
});

When('I finish the wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-finish').click();
});

Then('the project wizard closes right away', async ({ e2e }) => {
  await expect(wizard(e2e.window)).toBeHidden({ timeout: FINISH_TIMEOUT });
});

Then('the project page shows the Next steps card', async ({ e2e }) => {
  await expect(nextSteps(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the project page does not show the Next steps card', async ({ e2e }) => {
  await expect(projectPage(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(nextSteps(e2e.window)).toHaveCount(0);
});

Then('the Next steps card offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  for (const words of [a, b, c]) {
    await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
    await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeEnabled();
  }
});

// mock-7: what phase 1 does not do yet (release CI, screenshots) stays visible, its button disabled
Then('the Next steps card shows {string} and {string} as coming later', async ({ e2e }, a, b) => {
  for (const words of [a, b]) {
    await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
    await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeDisabled();
  }
});

When('I open the {string} entry of the Next steps card', async ({ e2e }, words) => {
  await nextStepsAction(e2e.window, words).click();
});

When('I dismiss the Next steps card', async ({ e2e }) => {
  await nextSteps(e2e.window).getByTestId('next-steps-dismiss').click();
});

// the idea typed in the review is kept as a local idea card of the Inbox (no issue on a provider)
Then('the Inbox lists the idea {string}', async ({ e2e }, title) => {
  const cards = e2e.window.getByTestId('inbox-list').getByTestId('inbox-card');
  await expect(cards.filter({ hasText: title })).toHaveCount(1, { timeout: LOAD_TIMEOUT });
});

// #630: step 3 "Analysis & workflows" (docs/work/first-project-onboarding/images/mock-4.jpg) shows the
// ways of working profile read from the git history and the suggested workflows.
// - data-testid="wizard-profile": the ways of working profile;
// - data-testid="wizard-workflow": one row per suggested workflow, data-kind="feature|fix|release|ci",
//   in that order; inside it wizard-workflow-reason (the "Why: ..." text) and wizard-workflow-select
//   (an enabled selector to change the workflow).
const workflowRows = (page) => wizard(page).getByTestId('wizard-workflow');

Then('the wizard suggests the workflows {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const rows = workflowRows(e2e.window);
  await expect(rows).toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  const kinds = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
  expect(kinds).toEqual([a, b, c, d]);
});

Then('each suggested workflow shows why it is suggested', async ({ e2e }) => {
  const rows = workflowRows(e2e.window);
  const count = await rows.count();
  expect(count, 'suggested workflows').toBeGreaterThan(0);
  const reasons = wizard(e2e.window).getByTestId('wizard-workflow-reason');
  await expect(reasons).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i).getByTestId('wizard-workflow-reason'), `the reason of workflow ${i + 1}`).toHaveText(/\S/);
  }
});

Then('I can change the suggested {string} workflow', async ({ e2e }, kind) => {
  const row = wizard(e2e.window).locator(`[data-testid="wizard-workflow"][data-kind="${kind}"]`);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('wizard-workflow-select'), `the selector of the "${kind}" workflow`).toBeEnabled();
});

Then('the wizard shows the ways of working profile', async ({ e2e }) => {
  await expect(wizard(e2e.window).getByTestId('wizard-profile')).toBeVisible({ timeout: IMPORT_TIMEOUT });
});

// ---- #632: Create new project (docs/work/first-project-onboarding/images/mock-3.jpg, spec R4 / D5 B) ------
// - wizard-new-name: the project name; wizard-new-starts: the "Starts with" radios (value readme | empty),
//   named "README and .gitignore" / "Empty"; wizard-new-remote: "Also create a private repository on …"
//   (disabled with no gh / glab signed in, as in the simulated E2E app); wizard-new-remote-provider;
//   wizard-new-folder: the folder line "<workspace>/projects/<slug>";
// - data-testid="wizard-question" data-question="mode|ci|release": a question group, its title ("Where
//   changes land", "CI", "How you release") and its chips (class wizard-chip, role button, the chosen one
//   aria-pressed="true"), each chip reading its label first ("Local: merge here, push main").
// The repository is made in the scratch workspace (MULTIAGENT_WORKSPACE, features/support/app.js).

const question = (page, title) => wizard(page).getByTestId('wizard-question').filter({ hasText: title });
// the chip whose text starts with the label: "Local" never matches "Local + remote"
const chip = (page, title, label) => question(page, title).getByRole('button')
  .filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}(?!\\s*\\+)`) });
const workspaceFolder = (e2e, rel) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  return path.join(e2e.scratch, 'workspace', ...rel.split('/'));
};
// git in the created repository, with no machine config (the scratch's empty one)
function gitIn(e2e, folder, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
  return execFileSync('git', ['-C', folder, ...args], { env, encoding: 'utf8' }).trim();
}

When('I choose to create a new project in the wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-source-new').click();
  // a card may move on by itself, or wait for Next
  if ((await currentStep(page).getAttribute('data-step')) === 'start') await wizard(page).getByTestId('wizard-next').click();
  await expect(wizard(page).getByTestId('wizard-new-name')).toBeVisible();
});

When('I name the new project {string}', async ({ e2e }, name) => {
  await wizard(e2e.window).getByTestId('wizard-new-name').fill(name);
});

When('I start the new project with {string}', async ({ e2e }, label) => {
  const radio = wizard(e2e.window).getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(label)}`) });
  await radio.check();
  await expect(radio).toBeChecked();
});

Then('the new project starts with {string}', async ({ e2e }, label) => {
  await expect(wizard(e2e.window).getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(label)}`) })).toBeChecked();
});

// the folder line shows the workspace's projects folder and the name made a slug
Then('the new project will be created in {string} of the workspace', async ({ e2e }, rel) => {
  const tail = rel.split('/').map(escapeRe).join('[\\\\/]');
  await expect(wizard(e2e.window).getByTestId('wizard-new-folder')).toContainText(new RegExp(`${tail}\\s*$`));
});

When('I answer {string} to {string} in the wizard', async ({ e2e }, label, title) => {
  const button = chip(e2e.window, title, label);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

Then('the wizard asks {string} with {string} chosen', async ({ e2e }, title, label) => {
  const page = e2e.window;
  await expect(question(page, title)).toBeVisible();
  await expect(chip(page, title, label)).toHaveAttribute('aria-pressed', 'true');
  await expect(question(page, title).locator('[aria-pressed="true"]'), `one answer chosen for "${title}"`).toHaveCount(1);
});

Then('the private repository option cannot be ticked', async ({ e2e }) => {
  const remote = wizard(e2e.window).getByTestId('wizard-new-remote');
  await expect(remote).toBeVisible();
  await expect(remote).toBeDisabled();
  await expect(remote).not.toBeChecked();
});

Then('the next step of the wizard is unavailable', async ({ e2e }) => {
  await expect(wizard(e2e.window).getByTestId('wizard-next')).toBeDisabled();
});

Then("the workspace's {string} is a git repository with {string} and {string} committed on main", async ({ e2e }, rel, a, b) => {
  const folder = workspaceFolder(e2e, rel);
  await expect.poll(() => fs.existsSync(path.join(folder, '.git')), { message: `${rel} is a git repository`, timeout: IMPORT_TIMEOUT }).toBe(true);
  expect(gitIn(e2e, folder, ['rev-parse', '--abbrev-ref', 'HEAD']), 'the branch').toBe('main');
  const files = gitIn(e2e, folder, ['ls-tree', '--name-only', 'main']).split(/\r?\n/);
  expect(files).toEqual(expect.arrayContaining([a, b]));
  expect(Number(gitIn(e2e, folder, ['rev-list', '--count', 'main'])), 'commits on main').toBe(1);
});

Then("the workspace's {string} is a git repository with no commit", async ({ e2e }, rel) => {
  const folder = workspaceFolder(e2e, rel);
  await expect.poll(() => fs.existsSync(path.join(folder, '.git')), { message: `${rel} is a git repository`, timeout: IMPORT_TIMEOUT }).toBe(true);
  // git init only: HEAD names a branch with no commit yet
  expect(() => gitIn(e2e, folder, ['rev-parse', '--verify', '-q', 'HEAD']), 'no commit').toThrow();
});

Then("the workspace's {string} has no remote", async ({ e2e }, rel) => {
  expect(gitIn(e2e, workspaceFolder(e2e, rel), ['remote']), 'the remotes').toBe('');
});

// ---- #725: step 3's "Suggested workflows" column: two choices first, an analyzing look, failed jobs -------
// What the screen exposes (to be added by #725):
// - wizard-workflows-column: the right column (its heading, the choices or the rows, the analyzing notice);
// - wizard-workflows-choice-analyze / wizard-workflows-choice-manual: the two choices, buttons named
//   "Analyze the repository" / "Define manually", shown until one is chosen (no row before);
// - wizard-workflows-rows: the rows' list (the wizard-workflow rows of #630), aria-busy="true" while dimmed;
// - wizard-workflows-analyzing: the loading notice over the dimmed rows, "Analyzing <name>'s ways of
//   working…", holding wizard-workflows-spinner;
// - a failed job's row of the left column (data-part="<job>", as the cost's parts) holds
//   wizard-job-error-<job> (the reason under its title) and wizard-job-retry-<job> (Retry:
//   api.retryOnboarding(projectId)); its amount reads "—";
// - wizard-next: the footer's Continue to the review, enabled all along step 3; wizard-analyze is gone.
//
// E2E HOOKS THE DEVELOPER MUST ADD (none exists yet), read by the simulated onboarding's jobs
// (packages/engine/service/areas/project-onboarding.js, its `jobs`, only when MULTIAGENT_SIMULATION_ONLY=1):
// - MULTIAGENT_E2E_ONBOARDING_HOLD=<job>[,<job>]: that job stays `running` until the app closes (a promise
//   that never settles), so its in-progress look can be checked and screenshotted;
// - MULTIAGENT_E2E_ONBOARDING_FAIL=<job>[,<job>]: that job throws "The simulated <job> failed (e2e)."
//   so it ends `failed` with that error as its reason (a Retry fails again the same way).

// the analyses in the owner's words → the onboarding's job ids
const ONBOARDING_JOB = { 'ways of working': 'profile', 'project map': 'projectMap' };
const jobId = (words) => {
  const id = ONBOARDING_JOB[words];
  if (!id) throw new Error(`unknown analysis "${words}": one of ${Object.keys(ONBOARDING_JOB).join(', ')}`);
  return id;
};
const WORKFLOW_CHOICE = { 'Analyze the repository': 'wizard-workflows-choice-analyze', 'Define manually': 'wizard-workflows-choice-manual' };
const choiceTestid = (label) => {
  const id = WORKFLOW_CHOICE[label];
  if (!id) throw new Error(`unknown choice "${label}": one of ${Object.keys(WORKFLOW_CHOICE).join(', ')}`);
  return id;
};
const workflowsColumn = (page) => wizard(page).getByTestId('wizard-workflows-column');
const jobRow = (page, words) => wizard(page).getByTestId('wizard-cost').locator(`[data-part="${jobId(words)}"]`);

Given('the app is open while the {string} analysis keeps running', async ({ e2e }, words) => {
  await e2e.open({ env: { MULTIAGENT_E2E_ONBOARDING_HOLD: jobId(words) } });
});

Given('the app is open where the {string} analysis fails', async ({ e2e }, words) => {
  await e2e.open({ env: { MULTIAGENT_E2E_ONBOARDING_FAIL: jobId(words) } });
});

Then("the wizard's suggested workflows offer {string} and {string} and no workflow yet", async ({ e2e }, a, b) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toBeVisible({ timeout: IMPORT_TIMEOUT });
  for (const label of [a, b]) {
    const choice = column.getByTestId(choiceTestid(label));
    await expect(choice, `the choice "${label}"`).toBeVisible();
    await expect(choice).toBeEnabled();
    await expect(choice).toContainText(label);
  }
  await expect(column.getByTestId('wizard-workflow'), 'no workflow row before a choice').toHaveCount(0);
});

When("I choose {string} in the wizard's suggested workflows", async ({ e2e }, label) => {
  const choice = workflowsColumn(e2e.window).getByTestId(choiceTestid(label));
  await expect(choice).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await choice.click();
});

Then("the wizard's suggested workflows are dimmed under {string} with a spinner", async ({ e2e }, notice) => {
  const column = workflowsColumn(e2e.window);
  const analyzing = column.getByTestId('wizard-workflows-analyzing');
  await expect(analyzing).toBeVisible();
  await expect(analyzing).toContainText(notice);
  await expect(analyzing.getByTestId('wizard-workflows-spinner')).toBeVisible();
  const rows = column.getByTestId('wizard-workflows-rows');
  await expect(rows).toBeVisible();
  await expect(rows).toHaveAttribute('aria-busy', 'true');
});

Then("the wizard's suggested workflows are not dimmed", async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column.getByTestId('wizard-workflows-rows')).toBeVisible();
  await expect(column.getByTestId('wizard-workflows-rows')).not.toHaveAttribute('aria-busy', 'true');
  await expect(column.getByTestId('wizard-workflows-analyzing')).toHaveCount(0);
});

// the footer's Continue to the review, on step 3 whatever the analysis is doing
Then('the wizard lets me continue to the review', async ({ e2e }) => {
  const page = e2e.window;
  const next = footer(page).getByTestId('wizard-next');
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await expect(next).toContainText(/Continue/i);
  await expect(wizard(page).getByTestId('wizard-analyze'), '"Analyze and continue" is gone').toHaveCount(0);
});

// modelled on "the sidebar looks like the baseline" (sidebar-footer.steps.js): the column only (the left
// one shows the scratch folder's repository URL, which changes per run)
Then("the wizard's suggested workflows look like the baseline {string}", async ({ e2e }, name) => {
  await expect(workflowsColumn(e2e.window)).toHaveScreenshot(name);
});

Then("the wizard's {string} analysis says why it failed and offers to retry it", async ({ e2e }, words) => {
  const id = jobId(words);
  const row = jobRow(e2e.window, words);
  await expect(row.getByTestId(`wizard-job-error-${id}`)).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(row.getByTestId(`wizard-job-error-${id}`)).toHaveText(/\S/);
  const retry = row.getByTestId(`wizard-job-retry-${id}`);
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(retry).toContainText(/Retry/i);
});

Then("the wizard's {string} analysis shows no amount", async ({ e2e }, words) => {
  const row = jobRow(e2e.window, words);
  await expect(row).toContainText('—');
  await expect(row).not.toContainText(AMOUNT);
});

Then('the wizard does not offer to analyze everything again', async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(w.getByTestId('wizard-analyze')).toHaveCount(0);
  await expect(w.getByTestId('wizard-workflows-choice-analyze')).toHaveCount(0);
  await expect(w.getByRole('button', { name: /analy[sz]e (everything|all|again)|analy[sz]e and continue/i })).toHaveCount(0);
});

// ---- #726: the suggested workflows column in the interface language ------------------------------------
// Every text of step 3's "Suggested workflows" column (and the left column's ways of working profile line)
// follows the interface language: the reasons, the selectors' options, the "Why" of each reason. What the
// screen exposes:
// - data-testid="wizard-workflow-why" (new): in each wizard-workflow row with a reason, the word "Why:" /
//   "Por quê:" as an element of its own, bold and in the accent colour (var(--accent)), before the reason;
// - wizard-workflow-select's options: the labels of packages/shared/onboarding-model.js CHOICES, now read
//   from the catalogs (an entry whose English value is the label, e.g. "Local merge · E2E first").
// A language switch with the wizard open: what Settings › General › Language saves (window.api.setSettings,
// 'settings:set'), pushed to every window as 'settings:changed' (packages/ui-kit/interface-language.js);
// the wizard re-renders in the new language and keeps the owner's picks (cur.workflows).
// The expected text in a language is read from the catalogs (packages/shared/i18n/<lang>.json), as
// interface-language.steps.js does, so the steps never depend on the Portuguese wording.

const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const LANGUAGE_CODES = { English: 'en', 'Português (Brasil)': 'pt-BR' };
const languageCode = (language) => {
  const code = LANGUAGE_CODES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGE_CODES).join(', ')})`);
  return code;
};
const catalogOf = (code) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8'));
// the texts an English label reads as in the language (one per catalog entry carrying the label)
function inLanguage(english, language) {
  const code = languageCode(language);
  if (code === 'en') return [english];
  const en = catalogOf('en');
  const other = catalogOf(code);
  const keys = Object.keys(en).filter((k) => en[k] === english && typeof other[k] === 'string');
  if (!keys.length) throw new Error(`no catalog entry has the English text "${english}" with a ${language} value: the wizard's workflows are not translated yet`);
  return [...new Set(keys.map((k) => other[k]))];
}
const workflowRow = (page, kind) => wizard(page).locator(`[data-testid="wizard-workflow"][data-kind="${kind}"]`);
const WIZARD_PART = {
  'suggested workflows': (page) => workflowsColumn(page),
  'ways of working profile': (page) => wizard(page).getByTestId('wizard-profile'),
};

// every row (feature, fix, release, CI) once analyzed: its "Why" label, a separate element in bold and the
// accent colour, then the reason's own text
Then('every suggested workflow shows a highlighted {string} label', async ({ e2e }, label) => {
  const page = e2e.window;
  const rows = workflowRows(page);
  await expect(rows).toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  await expect(wizard(page).getByTestId('wizard-workflow-why'), 'a "Why" label in every row').toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  for (let i = 0; i < 4; i++) {
    const row = rows.nth(i);
    const kind = await row.getAttribute('data-kind');
    const why = row.getByTestId('wizard-workflow-why');
    await expect(why, `the "${kind}" workflow's label`).toBeVisible();
    await expect(why, `the "${kind}" workflow's label`).toHaveText(label);
    const look = await why.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      el.parentElement.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const s = getComputedStyle(el);
      return { color: s.color, weight: Number(s.fontWeight) || (s.fontWeight === 'bold' ? 700 : 400), accent };
    });
    expect(look.color, `the "${kind}" workflow's label in the accent colour`).toBe(look.accent);
    expect(look.weight, `the "${kind}" workflow's label in bold`).toBeGreaterThanOrEqual(600);
    const reason = (await row.getByTestId('wizard-workflow-reason').innerText()).replace(label, '').trim();
    expect(reason, `the "${kind}" workflow's reason after its label`).toMatch(/\S/);
  }
});

// none of the texts (one per row of the table) anywhere in that part of the wizard: its text, its
// selectors' options, its titles and aria-labels
Then("the wizard's {string} shows none of these English texts:", async ({ e2e }, part, table) => {
  const locate = WIZARD_PART[part];
  if (!locate) throw new Error(`unknown part of the wizard "${part}": one of ${Object.keys(WIZARD_PART).join(', ')}`);
  const el = locate(e2e.window);
  await expect(el).toBeVisible({ timeout: IMPORT_TIMEOUT });
  const texts = table.raw().map((r) => String(r[0] || '').trim()).filter(Boolean);
  await expect.poll(async () => {
    const all = await el.evaluate((n) => [n, ...n.querySelectorAll('*')]
      .map((x) => `${x === n ? x.textContent : ''} ${x.getAttribute('title') || ''} ${x.getAttribute('aria-label') || ''}`).join(' '));
    return texts.filter((t) => all.includes(t));
  }, { message: `English texts left in the wizard's ${part}`, timeout: LOAD_TIMEOUT }).toEqual([]);
});

When('I pick {string} for the suggested {string} workflow', async ({ e2e }, label, kind) => {
  const select = workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select');
  await expect(select).toBeEnabled({ timeout: IMPORT_TIMEOUT });
  const value = await select.evaluate((el, l) => [...el.options].find((o) => o.textContent.trim() === l)?.value ?? null, label);
  if (value == null) throw new Error(`the "${kind}" workflow's selector offers no "${label}"`);
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
  e2e.workflowPicks = { ...(e2e.workflowPicks || {}), [kind]: { label, value } };
});

When('the interface language is switched to {string} while the wizard stays open', async ({ e2e }, language) => {
  const code = languageCode(language);
  const page = e2e.window;
  await expect(wizard(page)).toBeVisible();
  await page.evaluate(async (c) => { await window.api.setSettings({ language: { interface: c } }); }, code);
  await expect(page.locator('html')).toHaveAttribute('lang', code === 'en' ? /^en/ : code, { timeout: LOAD_TIMEOUT });
  await expect(wizard(page), 'the wizard stays open').toBeVisible();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'analysis');
});

// the same pick (the option's value), its label now in the language
Then('the suggested {string} workflow still has {string} picked, read in {string}', async ({ e2e }, kind, label, language) => {
  const pick = e2e.workflowPicks?.[kind];
  if (!pick || pick.label !== label) throw new Error(`no "${label}" was picked for the "${kind}" workflow: use "I pick {string} for the suggested {string} workflow" first`);
  const select = workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select');
  await expect(select).toHaveValue(pick.value, { timeout: LOAD_TIMEOUT });
  const texts = inLanguage(label, language);
  await expect(select.locator('option:checked')).toHaveText(new RegExp(`^\\s*(${texts.map(escapeRe).join('|')})\\s*$`), { timeout: LOAD_TIMEOUT });
});

// #741: the wizard reopened on an unfinished onboarding (its Continue, or New project with the same URL)
// shows the pick made before it was closed: the same option, read in English
Then('the suggested {string} workflow still has {string} picked', async ({ e2e }, kind, label) => {
  const pick = e2e.workflowPicks?.[kind];
  if (!pick || pick.label !== label) throw new Error(`no "${label}" was picked for the "${kind}" workflow: use "I pick {string} for the suggested {string} workflow" first`);
  const select = workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select');
  await expect(select).toHaveValue(pick.value, { timeout: IMPORT_TIMEOUT });
  await expect(select.locator('option:checked')).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
});

// ---- #724: the tray never covers the wizard; #739: the name from the URL; #743: cloning in place ---------
// What the screens expose (#724 / #743):
// - wizard-spinner: the circular spinner of a running import inside the wizard's footer, in
//   wizard-clone-progress (the import's name and state; data-status="running|done|failed" = the clone
//   job's status; when failed its reason and a role="button" named /Retry/) or in wizard-next while it
//   reads "Cloning <name>…" (#743: the Repository step's Next turned into the cloning state; disabled only
//   while the start call is in flight, then a click goes on to the analysis with the clone running);
// - wizard-panel: the dialog's panel (.wizard-panel), measured for its size on every step;
// - tray-spinner: the spinner of a running import's tray-item;
// - the toast "<name> imported" (the shell's data-testid="toast") with its button "Open the project".
// The tray (onboarding-tray) is hidden while the wizard is open, whatever the imports' states.
//
// The E2E hooks of the clone, read by the simulated onboarding (packages/engine/service/areas/
// project-onboarding.js, only when MULTIAGENT_SIMULATION_ONLY=1):
// - MULTIAGENT_E2E_ONBOARDING_HOLD=clone: the clone stays running (status cloning) until the app closes;
// - MULTIAGENT_E2E_ONBOARDING_CLONE_DELAY_MS=<ms>: the clone waits that long, then runs as usual.

const CLONING = (name) => new RegExp(`Cloning\\s+${escapeRe(name)}\\s*(…|\\.\\.\\.)`);
// the size of the wizard's panel, unchanged to the pixel
const SIZE_TOLERANCE = 1;
const panel = (page) => wizard(page).getByTestId('wizard-panel');

Given('the app is open while the clone of an import keeps running', async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_E2E_ONBOARDING_HOLD: 'clone' } });
});

Given('the app is open where the clone of an import takes {int} seconds', async ({ e2e }, seconds) => {
  await e2e.open({ env: { MULTIAGENT_E2E_ONBOARDING_CLONE_DELAY_MS: String(seconds * 1000) } });
});

Then('the progress tray is not shown', async ({ e2e }) => {
  await expect(tray(e2e.window)).toBeHidden();
});

Then('the progress tray does not list the project {string}', async ({ e2e }, name) => {
  // a finished import leaves the tray about 5 s after it ended
  await expect(trayItem(e2e.window, name)).toHaveCount(0, { timeout: IMPORT_TIMEOUT });
});

Then('the progress tray shows the project {string} as {word} with a spinner', async ({ e2e }, name, status) => {
  const page = e2e.window;
  await expect(tray(page)).toBeVisible({ timeout: IMPORT_TIMEOUT });
  const item = trayItem(page, name);
  await expect(item).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
  await expect(item).toBeVisible();
  await expect(item.getByTestId('tray-spinner')).toBeVisible();
});

// the import's progress inside the wizard: the footer's clone progress, or (#743) the action button
// cloning in place, holding the name and a spinner
Then('the wizard shows the import of {string} running with a spinner', async ({ e2e }, name) => {
  const progress = footer(e2e.window).locator('[data-testid="wizard-clone-progress"], [data-testid="wizard-next"]')
    .filter({ hasText: name }).filter({ has: e2e.window.getByTestId('wizard-spinner') });
  await expect(progress.first()).toBeVisible({ timeout: IMPORT_TIMEOUT });
});

Then('the wizard shows the import of {string} as {word}', async ({ e2e }, name, status) => {
  const progress = footer(e2e.window).getByTestId('wizard-clone-progress');
  await expect(progress).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(progress).toContainText(name);
  await expect(progress).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
});

// the step's action (Next / the cloning state) is on screen and the topmost element at its centre is
// the button itself (or inside it): no tray, toast or panel over it
Then("the wizard's action button is visible and nothing covers it", async ({ e2e }) => {
  const action = footer(e2e.window).getByTestId('wizard-next');
  await expect(action).toBeVisible();
  await expect(action).toBeInViewport({ ratio: 1 });
  const onTop = await action.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(top && (top === el || el.contains(top)));
  });
  expect(onTop, 'the action button is the topmost element at its centre').toBe(true);
});

Then('the app says {string} and offers to open the project', async ({ e2e }, words) => {
  const toast = e2e.window.getByTestId('toast');
  await expect(toast).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(toast).toContainText(words);
  await expect(toast.getByRole('button', { name: /Open the project/i })).toBeVisible();
});

When('I open the project from the {string} notice', async ({ e2e }, words) => {
  const toast = e2e.window.getByTestId('toast').filter({ hasText: words });
  await toast.getByRole('button', { name: /Open the project/i }).click();
});

// #739: a paste through the clipboard (Ctrl / Cmd+V), as the owner does
When('I paste the repository {string} in the wizard', async ({ e2e }, repo) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await e2e.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), repo);
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.press('ControlOrMeta+V');
  await expect(field).toHaveValue(repo);
});

// typed key by key (the URL replaces what the field held)
When('I type the repository {string} in the wizard', async ({ e2e }, repo) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await field.clear();
  await field.pressSequentially(repo);
  await expect(field).toHaveValue(repo);
});

When('I type the project name {string} in the wizard', async ({ e2e }, name) => {
  const field = wizard(e2e.window).getByTestId('wizard-name');
  await field.clear();
  await field.pressSequentially(name);
});

Then("the wizard's project name reads {string}", async ({ e2e }, name) => {
  await expect(wizard(e2e.window).getByTestId('wizard-name')).toHaveValue(name);
});

// #743
When("I note the wizard's size", async ({ e2e }) => {
  await expect(panel(e2e.window)).toBeVisible();
  e2e.wizardSize = await panel(e2e.window).boundingBox();
});

Then('the wizard has the size I noted', async ({ e2e }) => {
  if (!e2e.wizardSize) throw new Error('no size noted: use "I note the wizard\'s size" first');
  const box = await panel(e2e.window).boundingBox();
  expect(box, 'the wizard panel is on screen').not.toBeNull();
  expect(Math.abs(box.width - e2e.wizardSize.width), `the width ${box.width} vs ${e2e.wizardSize.width}`).toBeLessThanOrEqual(SIZE_TOLERANCE);
  expect(Math.abs(box.height - e2e.wizardSize.height), `the height ${box.height} vs ${e2e.wizardSize.height}`).toBeLessThanOrEqual(SIZE_TOLERANCE);
});

Then("the wizard's action button shows a spinner and {string}", async ({ e2e }, text) => {
  const action = footer(e2e.window).getByTestId('wizard-next');
  const name = text.replace(/^Cloning\s+/, '').replace(/\s*(…|\.\.\.)$/, '');
  await expect(action).toContainText(text.startsWith('Cloning') ? CLONING(name) : text, { timeout: IMPORT_TIMEOUT });
  await expect(action.getByTestId('wizard-spinner')).toBeVisible();
});

Then('the wizard shows no import status card and its repository fields are read-only', async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(w.getByTestId('wizard-import-status')).toHaveCount(0);
  await expect(w.getByTestId('wizard-repo')).not.toBeEditable();
  await expect(w.getByTestId('wizard-name')).not.toBeEditable();
});

// ---- #731: the onboarding's city analysis draws the city plan ----------------------------------------------
// The "Cidade e arquitetura" job (projectMap) draws the city plan (the cartographer's city-plan.json, as the
// Architecture tab's "Analyze this project" does), then runs the Oracle. Once it is done the project's City
// is grouped by the plan's districts, not by folder. What the screen exposes (existing test ids):
// - the review's "Open the city" (wizard-open-city) finishes the wizard and opens the project's
//   City tab (#730; window.ProjectArchitecture.openCity);
// - the City tab: project-city-header ("<n> districts", "plan covers <share>"), no project-city-no-plan;
//   its "Analyze this project" (architecture-analyze or project-city-analyze) is offered with a plan too,
//   its title the refresh one ("a refresh keeps the names you saw").
//
// E2E HOOK THE DEVELOPER MUST ADD, read by the simulated onboarding's projectMap job only when
// MULTIAGENT_SIMULATION_ONLY=1: MULTIAGENT_E2E_CITY_PLAN_FAIL=1 makes drawing the city plan throw
// "The simulated city plan failed (e2e)." so the job ends `failed` with that reason (a Retry fails again).

// #730: the City is a tab of its own (#project-panel-city); the Architecture tab is gone
const architectureTab = (page) => projectPage(page).locator('#project-panel-architecture, #project-panel-city').filter({ visible: true }).first();
const cityPart = (page, id) => architectureTab(page).getByTestId(id).filter({ visible: true }).first();

Given('the app is open where drawing the city plan fails', async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_E2E_CITY_PLAN_FAIL: '1' } });
});

When('I open the city from the review', async ({ e2e }) => {
  const open = review(e2e.window).getByTestId('wizard-open-city');
  await expect(open).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(open).toBeEnabled();
  await open.click();
});

Then('the city is drawn from its plan, with its districts', async ({ e2e }) => {
  const header = cityPart(e2e.window, 'project-city-header');
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header, 'the city is grouped by the plan').toContainText(/plan covers/i, { timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(/\b[1-9]\d*\s+districts?\b/i);
  await expect(architectureTab(e2e.window).getByTestId('project-city-no-plan')).toHaveCount(0);
});

Then('the City tab does not say there is no city plan yet', async ({ e2e }) => {
  const tab = architectureTab(e2e.window);
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(tab.getByTestId('project-city-no-plan')).toHaveCount(0);
  await expect(tab.getByText(/no city plan yet/i).filter({ visible: true })).toHaveCount(0);
});

// #730: the City tab's action (its own "architecture-analyze", or the city's "project-city-analyze"), shown
// with a plan too, its title the refresh one ("a refresh keeps the names you saw")
Then('the City tab offers {string} only as a refresh of the city plan', async ({ e2e }, label) => {
  const button = architectureTab(e2e.window).locator('[data-testid="architecture-analyze"], [data-testid="project-city-analyze"]').filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(label);
  await expect(button, 'the refresh title').toHaveAttribute('title', /refresh/i);
});

Then("the wizard's {string} analysis gives a reason that mentions {string}", async ({ e2e }, words, text) => {
  const error = jobRow(e2e.window, words).getByTestId(`wizard-job-error-${jobId(words)}`);
  await expect(error).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(error).toContainText(new RegExp(escapeRe(text), 'i'));
});

// ---- #730: no refactor ranking in the analysis; the review files the Oracle's findings -----------------------
// The analysis's jobs are the free part and the project map (the city plan, then the Oracle): no "ranking" job,
// so wizard-cost has no data-part="ranking" row and no word of a ranking or of the Product Owner. The findings of
// the Oracle's report are sent nowhere on their own. What the review exposes (to be added by #730):
// - data-testid="wizard-review-findings": the findings' list, one data-testid="wizard-review-finding" per
//   finding (its title), each with the buttons data-testid="wizard-review-create-issue" ("Create issue")
//   and "wizard-review-create-issue-prioritize" ("Create issue and prioritize"); once filed, the link
//   data-testid="wizard-review-finding-issue" ("#<n>", and the roadmap stage when prioritized) takes the
//   buttons' place (the same ids as fronts/build/test/project-wizard-findings-730.test.js).

const REVIEW_FINDING_BUTTONS = { 'Create issue': 'wizard-review-create-issue', 'Create issue and prioritize': 'wizard-review-create-issue-prioritize' };
const reviewFindings = (page) => review(page).getByTestId('wizard-review-findings').getByTestId('wizard-review-finding');

Then("the wizard's analysis has no refactor ranking row", async ({ e2e }) => {
  const cost = wizard(e2e.window).getByTestId('wizard-cost');
  await expect(cost).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(cost.locator('[data-part="projectMap"]'), 'the project map row').toBeVisible();
  await expect(cost.locator('[data-part="ranking"]'), 'no ranking row').toHaveCount(0);
  await expect(cost.getByText(/ranking|Product Owner/i), 'no word of a ranking').toHaveCount(0);
});

Then("the review lists the Oracle's findings, each with {string} and {string}", async ({ e2e }, a, b) => {
  const rows = reviewFindings(e2e.window);
  await expect(rows.first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  for (const row of await rows.all()) {
    await expect(row, 'the finding has a title').toHaveText(/\S/);
    for (const label of [a, b]) {
      const id = REVIEW_FINDING_BUTTONS[label];
      if (!id) throw new Error(`unknown finding button "${label}": one of ${Object.keys(REVIEW_FINDING_BUTTONS).join(', ')}`);
      const button = row.getByTestId(id);
      await expect(button, `the finding's "${label}"`).toHaveRole('button');
      await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`, 'i'));
      await expect(button).toBeEnabled();
    }
  }
  // the old refactor backlog with its pick is gone
  await expect(review(e2e.window).getByTestId('wizard-review-refactor')).toHaveCount(0);
});

Then('no finding of the review has an issue yet', async ({ e2e }) => {
  await expect(reviewFindings(e2e.window).first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(review(e2e.window).getByTestId('wizard-review-finding-issue')).toHaveCount(0);
});

// ---- #744: the Next steps card's PO step, no empty refactors step, the reason of a disabled step ---------------------
// What the card exposes (project-next-steps, as #642):
// - its entries keep data-testid="next-step-<id>" (the PO's first: next-step-po-issue, as the unit tests of
//   #744 name it), each holding its button; the testids nested in an entry (next-step-po-issue-open,
//   next-step-po-issue-link, next-step-reason) hold no button, so the entries are the "next-step-…" holding one;
// - the PO entry reads "Create an issue with the PO", its button "Open the PO": the Product Owner's drawer
//   (aside "Product Owner") opens on "Register an issue" (its "Registering an issue for <name>" line; #785: the
//   mode toggle is gone), for the card's project, its message box (agent-chat-input) focused;
// - with no refactor proposals (once read) there is no next-step-refactors entry and no "… and add 0" button;
// - a disabled button's reason: its title (or its wrapper's, as a disabled button gets no hover), the same text
//   shown as a line of the entry.
const nextStepsEntries = (page) => nextSteps(page).getByTestId(/^next-step-/).filter({ has: page.getByRole('button') });
const poChat = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });

Then('the first step of the Next steps card is {string} with the button {string}', async ({ e2e }, title, label) => {
  const first = nextStepsEntries(e2e.window).first();
  await expect(first).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(first).toContainText(title);
  const button = first.getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
});

When('I click {string} in the Next steps card', async ({ e2e }, label) => {
  await nextSteps(e2e.window).getByRole('button', { name: label, exact: true }).click();
});

Then("the Product Owner's chat is open on {string} for the project {string}", async ({ e2e }, mode, name) => {
  expect(mode, 'the only thing this step checks').toBe('Register an issue');
  const drawer = poChat(e2e.window);
  await expect(drawer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer).toContainText(`Registering an issue for ${name}`, { timeout: LOAD_TIMEOUT });
});

Then("the Product Owner's message box is focused", async ({ e2e }) => {
  await expect(poChat(e2e.window).getByTestId('agent-chat-input')).toBeFocused({ timeout: LOAD_TIMEOUT });
});

Then('the Next steps card has no refactors step and no button that adds 0', async ({ e2e }) => {
  const card = nextSteps(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the proposals read: no "Reading the proposals…" left
  await expect(card).not.toContainText(/Reading the proposals/i, { timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('next-step-refactors')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /\badd 0\b/i })).toHaveCount(0);
  await expect(card).not.toContainText(/\badd 0\b/i);
});

Then('every disabled step of the Next steps card says why, in its tooltip and in a visible line', async ({ e2e }) => {
  const entries = nextStepsEntries(e2e.window);
  await expect(entries.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  let disabled = 0;
  for (const entry of await entries.all()) {
    const button = entry.getByRole('button').first();
    if (await button.isEnabled()) continue;
    disabled += 1;
    const name = (await entry.innerText()).split(/\r?\n/)[0].trim();
    const reason = ((await button.getAttribute('title')) || (await button.locator('xpath=..').getAttribute('title')) || '').trim();
    expect(reason, `the tooltip of the disabled step "${name}"`).not.toBe('');
    await expect(entry.getByText(reason, { exact: true }).filter({ visible: true }).first(), `the reason line of "${name}"`).toBeVisible();
  }
  expect(disabled, 'disabled steps on the card').toBeGreaterThan(0);
});

// ---- #738: Fork + PR, a repository the owner can't push to ------------------------------------------------------
// When gh answers permissions.push=false for the imported repository, the wizard suggests a fork. What the
// screen exposes (to be added by #738):
// - data-testid="wizard-fork-notice": the notice "You can't push to <owner/repo>. Create a fork in your account
//   to contribute?", holding wizard-create-fork ("Create a fork": gh repo fork, origin = the fork, upstream =
//   the original) and wizard-work-locally ("Work locally": the Local way of working, no pull request);
// - data-testid="wizard-way-of-working": in step 3's suggested workflows column, the chosen way of working
//   ("Local", "Remote" or "Fork + PR"; Local says "no pull request").
//
// E2E HOOK THE DEVELOPER MUST ADD, read only when MULTIAGENT_SIMULATION_ONLY=1 (the simulated onboarding,
// packages/engine/service/areas/project-onboarding.js): MULTIAGENT_E2E_REPO_PUSH=0|1 stands for gh's answer
// (permissions.push false | true) for the imported repository, a local file:// one included, without calling
// gh; with 0 "Create a fork" is simulated (no gh repo fork, no network): the project's origin becomes the
// simulated fork and upstream the original.

const forkNotice = (page) => wizard(page).getByTestId('wizard-fork-notice');
const FORK_CHOICE = { 'Create a fork': 'wizard-create-fork', 'Work locally': 'wizard-work-locally' };

Given("the app is open where I can't push to the repositories I import", async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_E2E_REPO_PUSH: '0' } });
});

Given('the app is open where I can push to the repositories I import', async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_E2E_REPO_PUSH: '1' } });
});

Then('the wizard suggests creating a fork to contribute, or working locally', async ({ e2e }) => {
  const notice = forkNotice(e2e.window);
  await expect(notice).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(notice).toContainText(/You can.t push to \S+/);
  await expect(notice).toContainText('Create a fork in your account to contribute?');
  for (const [label, id] of Object.entries(FORK_CHOICE)) {
    const button = notice.getByTestId(id);
    await expect(button, `the "${label}" button`).toHaveRole('button');
    await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
    await expect(button).toBeEnabled();
  }
});

When('I choose {string} in the fork suggestion', async ({ e2e }, label) => {
  const id = FORK_CHOICE[label];
  if (!id) throw new Error(`unknown choice "${label}": one of ${Object.keys(FORK_CHOICE).join(', ')}`);
  await forkNotice(e2e.window).getByTestId(id).click();
  await expect(forkNotice(e2e.window)).toBeHidden({ timeout: IMPORT_TIMEOUT });
});

Then('the wizard does not suggest a fork', async ({ e2e }) => {
  await expect(forkNotice(e2e.window)).toHaveCount(0);
  await expect(wizard(e2e.window).getByText(/You can.t push to/)).toHaveCount(0);
});

Then("the wizard's suggested workflows use the {string} way of working", async ({ e2e }, mode) => {
  const way = workflowsColumn(e2e.window).getByTestId('wizard-way-of-working');
  await expect(way).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(way).toContainText(new RegExp(`^\\s*${escapeRe(mode)}(?!\\s*\\+)`));
});

Then("the wizard's suggested workflows say {string}", async ({ e2e }, text) => {
  await expect(workflowsColumn(e2e.window)).toContainText(new RegExp(escapeRe(text), 'i'), { timeout: IMPORT_TIMEOUT });
});

// ---- #633 (onboarding phase 5): the AI-native SDLC work model (docs/work/first-project-onboarding/images/mock-5.jpg)
// Step 3 "Analysis & workflows" has a section "How work on <name> is documented":
// - data-testid="wizard-work-model": the section (both columns of the mockup); its radios (role="radio" or input[type=radio]) carry
//   data-testid="wizard-work-model-light|standard|full", each named by its model ("Light", "Standard", "Full")
//   and followed by its description; Standard is checked by default;
// - data-testid="wizard-work-model-files": the "Where the files live" panel ("In the repository", the
//   docs/work/<item>/... path with its files, and chips such as "fix: issue only").
// The pick is the project's workModel (light | standard | full), saved with the wizard while it is open, so an
// onboarding resumed from the Projects screen (#741) shows it again.
const workModel = (page) => wizard(page).getByTestId('wizard-work-model');
const workModelFiles = (page) => wizard(page).getByTestId('wizard-work-model-files');
const workModelRadio = (page, model) => workModel(page).getByTestId(`wizard-work-model-${String(model).trim().toLowerCase()}`);

Then('the wizard shows how work on {string} is documented', async ({ e2e }, name) => {
  const section = workModel(e2e.window);
  await expect(section).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(section.getByRole('heading', { name: `How work on ${name} is documented` })).toBeVisible();
  await expect(section).toContainText('Each step leaves a file the next step reads, and a person approves it.');
});

// a table of | model | description |, in the order shown
Then('the wizard offers the work models:', async ({ e2e }, table) => {
  const rows = table.raw().map((r) => r.map((c) => String(c || '').trim())).filter((r) => r[0]);
  const section = workModel(e2e.window);
  await expect(section.getByRole('radio')).toHaveCount(rows.length, { timeout: IMPORT_TIMEOUT });
  for (const [model, description] of rows) {
    await expect(section.getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(model)}\\b`) }), `the "${model}" radio`).toHaveCount(1);
    await expect(workModelRadio(e2e.window, model), `the "${model}" radio by its test id`).toHaveCount(1);
    if (description) await expect(section, `the description of "${model}"`).toContainText(description);
  }
});

When('I pick the {string} work model in the wizard', async ({ e2e }, model) => {
  await workModelRadio(e2e.window, model).click();
});

Then('the wizard has the {string} work model picked', async ({ e2e }, model) => {
  const section = workModel(e2e.window);
  await expect(workModelRadio(e2e.window, model)).toBeChecked({ timeout: IMPORT_TIMEOUT });
  await expect(section.getByRole('radio', { checked: true }), 'only one work model picked').toHaveCount(1);
});

Then("the wizard's work model files live {string} in {string} as {string}, {string} and {string}", async ({ e2e }, where, folder, a, b, c) => {
  const panel = workModelFiles(e2e.window);
  await expect(panel).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(panel).toContainText('Where the files live');
  await expect(panel).toContainText(where);
  await expect(panel).toContainText(folder);
  for (const file of [a, b, c]) await expect(panel, `the file ${file}`).toContainText(file);
});

Then("the wizard's work model files show the chips {string}, {string} and {string}", async ({ e2e }, a, b, c) => {
  const panel = workModelFiles(e2e.window);
  for (const chip of [a, b, c]) await expect(panel.getByText(chip, { exact: true }), `the chip "${chip}"`).toBeVisible();
});

Then("the wizard's work model looks like the baseline {string}", async ({ e2e }, name) => {
  await expect(workModel(e2e.window)).toHaveScreenshot(name);
});
