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
// - wizard-cost, wizard-cost-total and its parts data-part="projectMap" | "ranking"; wizard-analyze, wizard-skip;
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
// open it since #643 (features/setup-projects-onboarding.feature drives those paths)
When('I open the project wizard', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
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

Then('the wizard shows the analysis cost in total and for the project map and the refactor ranking', async ({ e2e }) => {
  const cost = wizard(e2e.window).getByTestId('wizard-cost');
  await expect(cost).toBeVisible();
  await expect(cost.getByTestId('wizard-cost-total')).toContainText(AMOUNT);
  for (const part of ['projectMap', 'ranking']) {
    const row = cost.locator(`[data-part="${part}"]`);
    await expect(row, `the cost's ${part} part`).toBeVisible();
    await expect(row).toContainText(AMOUNT);
  }
});

Then('the wizard offers to start the analysis', async ({ e2e }) => {
  const analyze = wizard(e2e.window).getByTestId('wizard-analyze');
  await expect(analyze).toBeEnabled();
  await expect(analyze).toContainText(/Analyze and continue/i);
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

// the simulated analysis: the free part, the project map and the refactor ranking, without a model call
const ANALYSIS_TIMEOUT = 90000;
// Finish never waits for an analysis: the wizard is gone well before any job could end
const FINISH_TIMEOUT = 5000;
const QUADRANT = /Danger Zone|Cowboy Code|Fertile Ground|Healthy Closure/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const review = (page) => wizard(page).getByTestId('wizard-review');
const refactorRows = (page) => review(page).getByTestId('wizard-review-refactors').getByTestId('wizard-review-refactor');
const projectPage = (page) => page.getByTestId('project-page').filter({ visible: true }).first();
const nextSteps = (page) => projectPage(page).getByTestId('project-next-steps');
// an entry of the card (mock-7): its title and line say what it does ("roadmap", "idea"…), its button
// acts ("File and add", "Open Inbox", "Turn on"); the first entry whose text has the words
const nextStepsEntry = (page, words) => nextSteps(page).getByTestId(/^next-step-/)
  .filter({ hasText: new RegExp(escapeRe(words), 'i') }).first();
const nextStepsAction = (page, words) => nextStepsEntry(page, words).getByRole('button').first();

When('I start the analysis in the wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-analyze').click();
});

Then("the review shows the project's city and its backlog", async ({ e2e }) => {
  const page = e2e.window;
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByTestId('wizard-review-city')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(review(page).getByTestId('wizard-review-backlog')).toBeVisible();
});

Then("every row of the review's refactor backlog shows a file's score from 0 to 100 and its quadrant", async ({ e2e }) => {
  const rows = refactorRows(e2e.window);
  await expect(rows.first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  for (const row of await rows.all()) {
    const text = await row.innerText();
    const scores = (text.match(/\b\d{1,3}\b/g) || []).map(Number).filter((n) => n <= 100);
    expect(scores.length, `a score from 0 to 100 in the row "${text}"`).toBeGreaterThan(0);
    expect(text, `the quadrant in the row "${text}"`).toMatch(QUADRANT);
  }
});

// the pick is the row's checkbox, named by the refactor's title (kept to find it on the roadmap)
When('I pick the first refactor of the review', async ({ e2e }) => {
  const row = refactorRows(e2e.window).first();
  const pick = row.getByRole('checkbox');
  await pick.check();
  await expect(pick).toBeChecked();
  const label = await pick.getAttribute('aria-label');
  e2e.pickedRefactor = (label || await row.innerText()).split('\n')[0].trim();
  expect(e2e.pickedRefactor, "the picked refactor's title").not.toBe('');
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

Then('the roadmap shows the refactor I picked as a planned item', async ({ e2e }) => {
  if (!e2e.pickedRefactor) throw new Error('no refactor picked: use "I pick the first refactor of the review" first');
  const item = e2e.window.locator('[data-testid="roadmap-item"][data-status="planned"]').filter({ hasText: e2e.pickedRefactor }).first();
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
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
