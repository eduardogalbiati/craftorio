// Steps of features/25-project-without-remote.feature (#25) and features/35-local-backlog.feature (#35): a project
// created in the wizard without a remote (no repository) has a local backlog (#35): its issues live in the
// workspace, so the Backlog's New issue…, the Product Owner and the Roadmap work as for a project with a
// repository, and nothing is sent to a platform. (Until #35 the screens refused such a project: "This project has
// no repository", the Next steps card's "Add a repository to create issues", the drawer's po-no-repo-notice, the
// wizard's hint that the Backlog and the Roadmap are not available.)
// The wizard, the project page and its Next steps card are onboarding.steps.js's; the Product Owner's drawer
// ("I open the Product Owner", "I ask the Product Owner …", "the Product Owner answers") and the Backlog's buttons
// ("I choose {string} on the Backlog") are fronts/build's backlog.steps.js's; the Start panel is run.steps.js's.
//
// What the screens expose:
// - the wizard's step 2 for a new project (project-wizard), next to the remote option (wizard-new-remote): no text
//   saying that without a repository the Backlog and the Roadmap are not available (onboarding.no_remote_hint, in
//   either language; a hint may stay, saying something else, e.g. that the backlog is kept locally);
// - in the Product Owner's drawer (aside "Product Owner"): no data-testid="po-no-repo-notice" and no "has no
//   repository" / "não tem repositório" text; its Send (agent-chat-send) enabled once a question is typed; the
//   simulated draft under its "Draft" heading with its "Create" button;
// - on the Backlog (and the Roadmap) of such a project: no "This project has no repository" empty state, no Sync
//   button (nothing to sync from), the New issue… button enabled.

const { expect } = require('@playwright/test');
const { Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const wizard = (page) => page.getByTestId('project-wizard');
const openScreen = (page) => page.getByRole('main').filter({ visible: true }).first();
const visibleButton = (page, name) => openScreen(page).getByRole('button', { name, exact: true }).filter({ visible: true });

// what onboarding.no_remote_hint said, in English and in Português (Brasil)
const NOT_AVAILABLE = /(Backlog|Roadmap)[^.;]*(not available|não ficam disponíveis)/i;
// what a refusal for a missing repository says, in English and in Português (Brasil)
// (no \b after "ó": JavaScript's \b counts it as a non-word character)
const NO_REPO = /has no repository|não tem reposit[óo]rio/i;

Then('the wizard does not say that without a repository the Backlog and the Roadmap are not available', async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(w.getByTestId('wizard-new-remote')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(w).not.toContainText(NOT_AVAILABLE);
});

Then('the Product Owner\'s drawer does not say the project has no repository', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await expect(drawer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer.getByTestId('po-no-repo-notice')).toHaveCount(0);
  await expect(drawer).not.toContainText(NO_REPO);
});

Then('the Product Owner can be sent a question', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  const box = drawer.getByTestId('agent-chat-input');
  await expect(box).toBeEditable({ timeout: LOAD_TIMEOUT });
  await box.fill('Exportar pedidos em CSV a partir da tela de pedidos');
  await expect(drawer.getByTestId('agent-chat-send')).toBeEnabled();
});

// the simulated Product Owner's draft (a request of eight words or more): its "Draft" section and "Create"
Then('the Product Owner\'s drawer shows a draft of the issue, ready to create', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await expect(drawer.getByText('Draft', { exact: true }).last()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const create = drawer.getByRole('button', { name: 'Create', exact: true }).last();
  await expect(create).toBeVisible();
  await expect(create).toBeEnabled();
});

Then('the open screen does not say {string}', async ({ e2e }, text) => {
  const screen = openScreen(e2e.window);
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(screen).not.toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the Backlog offers {string}, enabled', async ({ e2e }, name) => {
  const button = visibleButton(e2e.window, name).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toBeEnabled({ timeout: LOAD_TIMEOUT });
});

Then('the Backlog does not offer {string}', async ({ e2e }, name) => {
  await expect(openScreen(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visibleButton(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
