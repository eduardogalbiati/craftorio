// Steps of features/onboarding.feature's #644 scenarios (onboarding step 7 of
// docs/work/first-project-onboarding/plan.md): the first start's journey from the empty Home to a ready
// project, and the no-access path. The wizard's own steps are onboarding.steps.js's; the new workspace and
// the Setup's Skip are setup.steps.js's; "the project page of {string} is open" is fronts/build's projects.steps.js.
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="home-empty": Home of a workspace with no project and no run (packages/ui-kit/views/dashboard/
//   dashboard.js), with data-testid="home-empty-create-project", a button named "Create a project", which
//   opens the new-project wizard (#644; before, the old New project dialog);
// - data-testid="wizard-error" data-error="no-access" holds data-testid="wizard-edit-repo", a button
//   ("Edit the URL"): the repository's fields open again (not readonly) for a new import.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the access check (git ls-remote, up to 30 s in the engine)
const IMPORT_TIMEOUT = 45000;

const wizard = (page) => page.getByTestId('project-wizard');
const homeEmpty = (page) => page.getByTestId('home-empty');

Then('Home says there is no project yet and offers to create one', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(homeEmpty(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(homeEmpty(page).getByTestId('home-empty-create-project')).toBeVisible();
});

When('I choose to create a project from Home', async ({ e2e }) => {
  const page = e2e.window;
  const create = homeEmpty(page).getByTestId('home-empty-create-project');
  await expect(create).toBeVisible({ timeout: LOAD_TIMEOUT });
  await create.click();
  await expect(wizard(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the wizard offers to edit the repository', async ({ e2e }) => {
  const error = wizard(e2e.window).getByTestId('wizard-error');
  // #107: a refused import names its cause (no network offline, no such repository online)
  await expect(error).toHaveAttribute('data-error', /^(repo-not-found|repo-no-access|no-network)$/, { timeout: IMPORT_TIMEOUT });
  await expect(error.getByTestId('wizard-edit-repo')).toBeVisible();
});

When('I edit the repository in the wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-edit-repo').click();
  await expect(wizard(page).getByTestId('wizard-repo')).toBeEditable();
  await expect(wizard(page).getByTestId('wizard-name')).toBeEditable();
});
