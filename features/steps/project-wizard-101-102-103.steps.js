// Steps of features/101-102-103-project-wizard-analyze-later-filter.feature (acceptance tests, written before the
// code). The wizard's other phrases are onboarding.steps.js's (the wizard, step 3's choices, the review's cards, the
// repository list and its filter box).
//
// What the screens expose (see onboarding.steps.js's header):
// - step 3: wizard-workflows-column data-state="choose|analyzing|failed|analyzed|manual", the choices
//   wizard-workflows-choice-analyze / -manual, wizard-workflows-analyzing while the analysis runs;
// - the shell's toast: data-testid="toast";
// - the review: wizard-review, its cards wizard-review-city / wizard-review-findings (data-state), the running badge
//   data-testid="wizard-review-running";
// - step 2: wizard-repo (the URL field), wizard-repo-filter (the list's own filter box), wizard-repo-list.
//
// #101 E2E HOOK THE DEVELOPER MUST ADD (none exists yet), read only when CRAFTORIO_SIMULATION_ONLY=1 (the simulated
// onboarding, packages/engine/service/areas/project-onboarding.js, its analyze()):
// CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE=1 makes onboarding:analyze (onboardingAnalyze) throw the client error
// "The simulated analysis was refused (e2e)." without starting anything, as an engine that refuses the analysis does.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const IMPORT_TIMEOUT = 45000;

const wizard = (page) => page.getByTestId('project-wizard');
const workflowsColumn = (page) => wizard(page).getByTestId('wizard-workflows-column');
const review = (page) => wizard(page).getByTestId('wizard-review');

// ---- #101: the engine refuses "Analyze with AI" -------------------------------------------------------------------

Given('the app is open where the engine refuses to start the analysis', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE: '1' } });
});

// back on the two choices: not the analyzing screen, no analysis phases
Then("the wizard's step 3 shows its two choices again, not an analysis running", async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toHaveAttribute('data-state', 'choose', { timeout: IMPORT_TIMEOUT });
  await expect(column.getByTestId('wizard-workflows-choice-analyze')).toBeVisible();
  await expect(column.getByTestId('wizard-workflows-choice-analyze')).toBeEnabled();
  await expect(column.getByTestId('wizard-workflows-choice-manual')).toBeVisible();
  await expect(column.getByTestId('wizard-workflows-analyzing'), 'no analyzing screen').toHaveCount(0);
});

Then('the app says why the analysis could not start', async ({ e2e }) => {
  const toast = e2e.window.getByTestId('toast').filter({ hasText: /refused/i });
  await expect(toast.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- #102: the review after Define manually while the clone still runs -------------------------------------------

Then('the review shows no analysis running', async ({ e2e }) => {
  await expect(review(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(review(e2e.window).getByTestId('wizard-review-running')).toHaveCount(0);
});

// ---- #103: a repository's URL pasted in the list's filter box -----------------------------------------------------

// a paste through the clipboard (Ctrl / Cmd+V), as the owner does, in the filter box (what it held is replaced)
When('I paste {string} in the wizard\'s repository filter', async ({ e2e }, text) => {
  const box = wizard(e2e.window).getByTestId('wizard-repo-filter');
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await e2e.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  await box.click();
  await box.press('ControlOrMeta+A');
  await box.press('ControlOrMeta+V');
  await expect(box).toHaveValue(text);
});

// the filter box filters the list only: the URL field keeps what it held (empty on a fresh step 2)
Then("the wizard's repository URL field is still empty", async ({ e2e }) => {
  await expect(wizard(e2e.window).getByTestId('wizard-repo')).toHaveValue('');
});
