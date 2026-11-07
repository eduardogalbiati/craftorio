// Steps of fronts/build/features/run-pr-monitor-809.feature: a run that opened a PR waits in the PR
// monitor (no agent, no Approve) and ends on the merge, or fails when the PR is closed without merging
// (#809). The reasons of the setup are in the feature's comment. Locators are roles and data-testid
// only (skills/ui-conventions). The app's launch with the fake platform, the merge, the close and the
// failed read are the steps of roadmap-waiting-merge.steps.js (#797), reused.
//
// What the Run screen exposes (the renderer's contract for these steps):
// - data-testid="pr-monitor-card": the PR monitor's card on the run while it waits on the PR.
// - data-testid="pr-monitor-link": on the card, href = the PR's URL, its text has "#<number>".
// - one line per check, each with its label and its state:
//   data-testid="pr-monitor-ci"         "CI": passed / failed (the job) / running / does not run on PRs
//   data-testid="pr-monitor-review"     "Review": approved / changes requested by <who> / approvals missing
//   data-testid="pr-monitor-conflicts"  "Conflicts": none / with the base
//   data-testid="pr-monitor-comments"   "Comments": how many unanswered (a number)
//   data-testid="pr-monitor-result"     "Result": "Ready to merge", or what blocks the merge
// - data-testid="pr-monitor-read-error": on the card, why the last read of the PR failed; only then.
// - data-testid="pr-monitor-read-at": on the card, when the PR was last read (a time).
// - no human gate card (data-testid="run-gate") and no "Approve" button for this step.
// - data-testid="run-screen-status" (features/support/run-screen.js): data-status success / failed.
//
// The PR's answers go in the JSON file features/support/electron-main.js reads on each call (gh's
// `pr view --json` answer). Which of its fields say what (statusCheckRollup, reviewDecision,
// latestReviews, mergeable / mergeStateStatus, comments) is gh's own vocabulary.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, Then } = require('../../../../features/steps/fixtures');
const { runScreenStatus } = require('../../../../features/support/run-screen');

const PR_FILE = 'pull-request.json'; // the file name roadmap-waiting-merge.steps.js launches the app with
// a simulated Feature run in Remote mode (mock delays scaled down) reaches its PR in well under the scenario's time
const MONITOR_TIMEOUT = 150000;
const READ_TIMEOUT = 60000;

const LINES = { CI: 'pr-monitor-ci', Review: 'pr-monitor-review', Conflicts: 'pr-monitor-conflicts', Comments: 'pr-monitor-comments', Result: 'pr-monitor-result' };

const card = (page) => page.getByTestId('pr-monitor-card').filter({ visible: true }).first();

function lineOf(page, name) {
  const id = LINES[name];
  expect(id, `a line of the PR monitor (${Object.keys(LINES).join(', ')})`).toBeTruthy();
  return card(page).getByTestId(id);
}

function answerPr(e2e, number, answer) {
  expect(number, 'the pull request this scenario seeded').toBe(e2e.pullRequest?.number);
  const file = path.join(e2e.scratch, PR_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(answer));
  fs.renameSync(tmp, file); // the app reads it at any moment: never half a file
}

const check = (name, conclusion) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion });
const comment = (login, body) => ({ author: { login }, body, createdAt: new Date().toISOString() });

// ---- what the platform says ---------------------------------------------------------------------

Given('the pull request #{int} on the platform is ready to merge', async ({ e2e }, number) => {
  answerPr(e2e, number, {
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    statusCheckRollup: [check('unit-tests', 'SUCCESS'), check('lint', 'SUCCESS')],
    reviewDecision: 'APPROVED',
    latestReviews: [{ author: { login: 'ana' }, state: 'APPROVED' }],
    comments: [],
  });
});

Given('the pull request #{int} on the platform has the job {string} failed, changes requested by {string}, a conflict with the base and {int} unanswered comments', async ({ e2e }, number, job, reviewer, unanswered) => {
  answerPr(e2e, number, {
    state: 'OPEN', isDraft: false, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
    statusCheckRollup: [check(job, 'FAILURE'), check('lint', 'SUCCESS')],
    reviewDecision: 'CHANGES_REQUESTED',
    latestReviews: [{ author: { login: reviewer }, state: 'CHANGES_REQUESTED' }],
    comments: Array.from({ length: unanswered }, (_, i) => comment(reviewer, `Question ${i + 1} on this change?`)),
  });
});

// ---- what the run shows -------------------------------------------------------------------------

Then('the run waits in the PR monitor of the pull request #{int}', async ({ e2e }, number) => {
  const page = e2e.window;
  await expect(card(page)).toBeVisible({ timeout: MONITOR_TIMEOUT });
  const link = card(page).getByTestId('pr-monitor-link');
  await expect(link).toHaveAttribute('href', new RegExp(`/pull/${number}$`));
  await expect(link).toContainText(`#${number}`);
  await expect(runScreenStatus(page)).toHaveAttribute('data-status', 'running');
});

// the line carries its label and its state (the state's words in the scenario: a job, a person, a number)
Then('the PR monitor shows {string} for {string}', async ({ e2e }, value, name) => {
  const line = lineOf(e2e.window, name);
  await expect(line).toContainText(name, { timeout: READ_TIMEOUT });
  await expect(line).toContainText(value, { timeout: READ_TIMEOUT });
});

Then('the PR monitor\'s result is not {string}', async ({ e2e }, text) => {
  const line = lineOf(e2e.window, 'Result');
  await expect(line).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(line).not.toBeEmpty();
  await expect(line).not.toContainText(text);
});

Then('the run offers no Approve', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('run-gate').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Approve\b/ }).filter({ visible: true })).toHaveCount(0);
});

Then('the PR monitor says the pull request could not be read: {string}', async ({ e2e }, reason) => {
  await expect(card(e2e.window).getByTestId('pr-monitor-read-error')).toContainText(reason, { timeout: READ_TIMEOUT });
});

// a time, e.g. "read at 10:42" or "read 2 minutes ago": some digit at least
Then('the PR monitor says when it last read the pull request', async ({ e2e }) => {
  await expect(card(e2e.window).getByTestId('pr-monitor-read-at')).toContainText(/\d/, { timeout: READ_TIMEOUT });
});

// ---- how the run ends ---------------------------------------------------------------------------

Then('the run ends successfully', async ({ e2e }) => {
  await expect(runScreenStatus(e2e.window)).toHaveAttribute('data-status', 'success', { timeout: READ_TIMEOUT });
});

Then('the run ends as failed, saying {string}', async ({ e2e }, reason) => {
  const page = e2e.window;
  await expect(runScreenStatus(page)).toHaveAttribute('data-status', 'failed', { timeout: READ_TIMEOUT });
  await expect(page.getByText(reason).filter({ visible: true }).first()).toBeVisible({ timeout: READ_TIMEOUT });
});
