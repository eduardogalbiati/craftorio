// Steps of fronts/build/features/run-pr-merge-810.feature: Merge, "Merge ignoring protection" and Close on
// the PR monitor's card (#810). The app's launch with the fake platform, the PR's answers, the start of
// the simulated run, the card's lines and the run's end are #809's and #797's steps (pr-monitor.steps.js,
// roadmap-waiting-merge.steps.js, run.steps.js), reused. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the card exposes (the renderer's contract for these steps), inside data-testid="pr-monitor-card":
// - data-testid="pr-merge"          NEW: the button "Merge", only while the PR can be merged (merge commit)
// - data-testid="pr-merge-admin"    NEW: the button "Merge ignoring protection", only with bypass permission
// - data-testid="pr-close"          NEW: the button "Close", which asks first
// - data-testid="pr-merge-blocked"  NEW: what blocks the merge, in the engine's words ("CI failed",
//                                   "changes requested", "conflict with the base", "approvals missing", "draft")
// - data-testid="pr-merge-error"    NEW: the platform's message after a merge it refused
// - the card's title "Merged" once merged (pr_card.title_merged)
// Close's confirmation: a role="dialog" with the button "Close pull request".
//
// The platform's side (the feature's comment): the E2E launch records each merge or close the app asks
// for in global.multiagentE2E.prActions, and a merge fails with the PR file's `merge_fail`.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const PR_FILE = 'pull-request.json'; // the file name roadmap-waiting-merge.steps.js launches the app with
const LOAD_TIMEOUT = 30000;
const READ_TIMEOUT = 60000;

const card = (page) => page.getByTestId('pr-monitor-card').filter({ visible: true }).first();
const closeDialog = (page) => page.getByRole('dialog').filter({ visible: true }).filter({ has: page.getByRole('button', { name: 'Close pull request', exact: true }) });

const prActions = (e2e) => e2e.app.evaluate(() => global.multiagentE2E?.prActions || []);

// ---- what the platform says ---------------------------------------------------------------------

// the PR's current answer stays; only the merge is refused, with the platform's message
Given('merging the pull request #{int} on the platform fails with {string}', async ({ e2e }, number, message) => {
  expect(number, 'the pull request this scenario seeded').toBe(e2e.pullRequest?.number);
  const file = path.join(e2e.scratch, PR_FILE);
  const answer = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...answer, merge_fail: message }));
  fs.renameSync(tmp, file); // the app reads it at any moment: never half a file
});

// ---- what the card offers -----------------------------------------------------------------------

Then('the PR monitor offers Merge', async ({ e2e }) => {
  const button = card(e2e.window).getByTestId('pr-merge');
  await expect(button).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName(/^Merge\b/);
});

Then('the PR monitor offers no Merge', async ({ e2e }) => {
  await expect(card(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card(e2e.window).getByTestId('pr-merge')).toHaveCount(0);
});

Then('the PR monitor offers no Merge ignoring protection', async ({ e2e }) => {
  await expect(card(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card(e2e.window).getByTestId('pr-merge-admin')).toHaveCount(0);
});

Then('the PR monitor says the merge is blocked by {string}', async ({ e2e }, reason) => {
  await expect(card(e2e.window).getByTestId('pr-merge-blocked')).toContainText(reason, { timeout: READ_TIMEOUT });
});

// ---- what I do ----------------------------------------------------------------------------------

When('I merge the pull request from the PR monitor', async ({ e2e }) => {
  await card(e2e.window).getByTestId('pr-merge').click({ timeout: READ_TIMEOUT });
});

When('I close the pull request from the PR monitor', async ({ e2e }) => {
  await card(e2e.window).getByTestId('pr-close').click({ timeout: READ_TIMEOUT });
});

// nothing is closed before the confirmation
Then('the app asks me to confirm closing the pull request', async ({ e2e }) => {
  await expect(closeDialog(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  expect((await prActions(e2e)).filter((a) => a.action === 'close')).toHaveLength(0);
});

When('I confirm closing the pull request', async ({ e2e }) => {
  const dialog = closeDialog(e2e.window);
  await dialog.getByRole('button', { name: 'Close pull request', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: LOAD_TIMEOUT });
});

// ---- what the platform was asked, what the card says --------------------------------------------

Then('the platform was asked to merge the pull request #{int} with a merge commit', async ({ e2e }, number) => {
  await expect.poll(async () => (await prActions(e2e)).filter((a) => a.action === 'merge'), { timeout: LOAD_TIMEOUT })
    .toEqual([expect.objectContaining({ action: 'merge', number, method: 'merge', admin: false })]);
});

Then('the platform was asked to close the pull request #{int}', async ({ e2e }, number) => {
  await expect.poll(async () => (await prActions(e2e)).filter((a) => a.action === 'close'), { timeout: LOAD_TIMEOUT })
    .toEqual([expect.objectContaining({ action: 'close', number })]);
});

Then('the PR monitor says the pull request was merged', async ({ e2e }) => {
  const page = e2e.window;
  await expect(card(page)).toContainText('Merged', { timeout: READ_TIMEOUT });
  await expect(card(page).getByTestId('pr-merge')).toHaveCount(0);
  await expect(card(page).getByTestId('pr-close')).toHaveCount(0);
});

Then('the PR monitor says the merge failed: {string}', async ({ e2e }, message) => {
  await expect(card(e2e.window).getByTestId('pr-merge-error')).toContainText(message, { timeout: READ_TIMEOUT });
});

// the card still waits for the merge (its title, Merge offered again) and no text on the screen says merged
Then('nothing says the pull request was merged', async ({ e2e }) => {
  const page = e2e.window;
  await expect(card(page)).toContainText('Waiting for the merge');
  await expect(card(page)).not.toContainText(/\bMerged\b/);
  await expect(card(page).getByTestId('pr-merge')).toBeVisible();
  await expect(page.getByText(/\bmerged\b/i).filter({ visible: true }).filter({ hasNotText: /fail|refus|could not/i })).toHaveCount(0);
});
