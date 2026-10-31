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

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the access check (git ls-remote, up to 30 s in the engine) and a local clone
const IMPORT_TIMEOUT = 45000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wizard = (page) => page.getByTestId('project-wizard');
const currentStep = (page) => wizard(page).locator('[aria-current="step"]').first();
const tray = (page) => page.getByTestId('onboarding-tray');
const trayItem = (page, name) => tray(page).getByTestId('tray-item').filter({ hasText: new RegExp(`\\b${escapeRe(name)}\\b`) });
// an amount of money ("$0.42", "$ 1", "0.42 USD") or an estimate said unknown (onboarding-model's
// costSummary: a missing estimate is null, never $0)
const AMOUNT = /\$\s?\d|\d(\.\d+)?\s*USD\b|unknown|not known|no estimate/i;

// a git repository with one commit (fixed identity, no machine config)
function makeRepository(scratch, name) {
  const folder = path.join(scratch, 'folders', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e ""' } }, null, 2));
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  return pathToFileURL(folder).href;
}

Given('a local git repository is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo');
});

// Temporary until onboarding step 6 wires the wizard to Projects › New project: the page global opens it
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
  await expect(analyze).toContainText(/Start analysis/i);
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

Then('the project wizard is not shown', async ({ e2e }) => {
  await expect(wizard(e2e.window)).toBeHidden();
});
