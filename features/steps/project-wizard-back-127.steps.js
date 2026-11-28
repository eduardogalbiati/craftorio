// Steps of features/127-project-wizard-step3-back-arrow.feature (#127, acceptance tests written before the code):
// step 3's back arrow from the workflows' rows (Define manually, or read by the analysis) to the two ways of
// defining them. The wizard's other phrases are onboarding.steps.js's and project-wizard-101-102-103.steps.js's.
//
// What the screen exposes (the renderer's contract for these steps; step 3's ids in onboarding.steps.js's header):
// - wizard-workflows-column data-state="choose|analyzing|failed|analyzed|manual";
// - NEW data-testid="wizard-workflows-back": a <button> at the top left of step 3, before its heading
//   ("Workflows of <name>"), with aria-label and title "Back to how the workflows are defined" (en). Shown in the
//   `manual` and `analyzed` states, not in `choose`. A click sets the column back to `choose` (the two cards
//   wizard-workflows-choice-analyze / -manual shown again), starts no analysis, and keeps the hand-made picks
//   (wizard-workflow-tile aria-pressed) for when Define manually is picked again.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const IMPORT_TIMEOUT = 45000;
// the simulated analysis reads the git history and suggests the workflows
const ANALYSIS_TIMEOUT = 90000;

const wizard = (page) => page.getByTestId('project-wizard');
const workflowsColumn = (page) => wizard(page).getByTestId('wizard-workflows-column');
const backArrow = (page) => wizard(page).getByTestId('wizard-workflows-back');

Then("the wizard shows the back arrow {string} before the heading {string}", async ({ e2e }, label, heading) => {
  const page = e2e.window;
  const back = backArrow(page);
  await expect(back).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(back).toHaveRole('button');
  await expect(back).toHaveAccessibleName(label);
  await expect(back).toHaveAttribute('aria-label', label);
  await expect(back).toHaveAttribute('title', label);
  await expect(back).toBeEnabled();
  const title = wizard(page).getByRole('heading', { name: heading, exact: true });
  await expect(title).toBeVisible();
  // at the top left, before the heading: left of it, on its line
  const a = await back.boundingBox();
  const h = await title.boundingBox();
  expect(a.x + a.width, 'the back arrow is left of the heading').toBeLessThanOrEqual(h.x + 1);
  expect(a.y, 'the back arrow is on the heading\'s line').toBeLessThan(h.y + h.height);
  expect(a.y + a.height, 'the back arrow is on the heading\'s line').toBeGreaterThan(h.y);
});

Then("the wizard's step 3 shows no back arrow", async ({ e2e }) => {
  await expect(workflowsColumn(e2e.window)).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(backArrow(e2e.window)).toHaveCount(0);
});

When("I go back to how the workflows are defined with the wizard's back arrow", async ({ e2e }) => {
  const back = backArrow(e2e.window);
  await expect(back).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await back.click();
});

Then("the wizard's suggested workflows are the ones read by the analysis", async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toHaveAttribute('data-state', 'analyzed', { timeout: ANALYSIS_TIMEOUT });
  await expect(column.getByTestId('wizard-workflows-rows')).toBeVisible();
  await expect(column.getByTestId('wizard-workflow').first()).toBeVisible();
});
