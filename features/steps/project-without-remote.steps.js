// Steps of features/25-project-without-remote.feature (#25): a project created in the wizard without a remote
// (no repository) is sent to add one on its way to a first issue. The wizard, the project page and its Next
// steps card are onboarding.steps.js's; the Product Owner's drawer is fronts/build's backlog.steps.js's; the
// project's settings ("the settings of the project {string} are open") are fronts/build's projects.steps.js's.
//
// What the screens expose (to be added by #25):
// - on the project page's Next steps card (project-next-steps), for a project with no repository, the first
//   entry data-testid="next-step-needs-repo" says a repository is needed; its action data-testid=
//   "next-step-add-repo" (a button or a link) opens the project's settings (project-settings), as Projects ›
//   Edit does; that entry offers no "Open the PO";
// - in the Product Owner's drawer (aside "Product Owner"), for a project with no repository, before anything
//   is typed: data-testid="po-no-repo-notice", in the interface language; its Send (agent-chat-send) disabled;
// - in the wizard's step 2 for a new project, next to the remote option (wizard-new-remote): data-testid=
//   "wizard-no-remote-hint", saying that without a repository the Backlog and the Roadmap are not available.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;

const projectPage = (page) => page.getByTestId('project-page').filter({ visible: true }).first();
const nextSteps = (page) => projectPage(page).getByTestId('project-next-steps');
// the card's entries: the "next-step-…" holding an action (the testids nested in an entry hold none)
const nextStepsEntries = (page) => nextSteps(page).getByTestId(/^next-step-/)
  .filter({ has: page.locator('button, a[href], [role="button"], [role="link"]') });
const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const wizard = (page) => page.getByTestId('project-wizard');

// the words a notice about a missing repository holds, per interface language
const NO_REPO_WORDS = {
  English: /\brepository\b/i,
  // (no \b after "ó": JavaScript's \b counts it as a non-word character)
  'Português (Brasil)': /\breposit[óo]rio/i,
};

Then('the first step of the Next steps card says the project needs a repository, without {string}', async ({ e2e }, label) => {
  const page = e2e.window;
  const first = nextStepsEntries(page).first();
  await expect(first).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(first, 'the first step of the Next steps card').toHaveAttribute('data-testid', 'next-step-needs-repo');
  await expect(first).toContainText(NO_REPO_WORDS.English);
  await expect(first.getByTestId('next-step-add-repo')).toBeVisible();
  await expect(first.getByTestId('next-step-add-repo')).toBeEnabled();
  await expect(first.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await expect(first.getByRole('link', { name: label, exact: true })).toHaveCount(0);
});

When('I choose to add a repository from the Next steps card', async ({ e2e }) => {
  await nextSteps(e2e.window).getByTestId('next-step-add-repo').click();
});

Then('the Product Owner\'s drawer says the project has no repository, in {string}', async ({ e2e }, language) => {
  const words = NO_REPO_WORDS[language];
  if (!words) throw new Error(`unknown language "${language}": one of ${Object.keys(NO_REPO_WORDS).join(', ')}`);
  const drawer = poDrawer(e2e.window);
  await expect(drawer).toBeVisible({ timeout: LOAD_TIMEOUT });
  // before anything is typed
  await expect(drawer.getByTestId('agent-chat-input')).toHaveValue('');
  const notice = drawer.getByTestId('po-no-repo-notice');
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(words);
});

// the box may be locked as well: when it takes text, the text is typed, and Send still stays disabled
Then('the Product Owner cannot be sent a question', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  const box = drawer.getByTestId('agent-chat-input');
  if (await box.isEditable()) await box.fill('Exportar pedidos em CSV');
  await expect(drawer.getByTestId('agent-chat-send')).toBeDisabled();
});

Then('the wizard says next to the private repository option that without a repository the Backlog and the Roadmap are not available', async ({ e2e }) => {
  const w = wizard(e2e.window);
  const remote = w.getByTestId('wizard-new-remote');
  const hint = w.getByTestId('wizard-no-remote-hint');
  await expect(remote).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Backlog');
  await expect(hint).toContainText('Roadmap');
  // next to it: the hint starts within a few lines of the option
  const a = await remote.boundingBox();
  const b = await hint.boundingBox();
  expect(Math.abs(b.y - (a.y + a.height)), 'the hint\'s distance below the remote option, in pixels').toBeLessThan(120);
});
