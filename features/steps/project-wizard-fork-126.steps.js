// Steps of features/126-project-wizard-fork-at-once.feature (#126): on the repository step, "Create a fork"
// on a repository the owner can't push to makes the fork (or reuses the owner's fork) at once, while the clone
// still runs; the remotes (origin = the fork, upstream = the original) are set once the clone ends, then the
// wizard moves on to the analysis. A failed fork says why at once, with both choices again.
//
// What the screen exposes (the renderer's contract for these steps; #738's ids in onboarding.steps.js):
// - wizard-fork-notice: stays shown on the repository step once the fork is made (created / reused) while the
//   clone runs, holding the fork's URL (https://github.com/<owner>/<repo>) and, NEW, data-testid=
//   "wizard-fork-waiting": the line saying origin / upstream are set once the clone ends. While waiting it has
//   no wizard-create-fork / wizard-work-locally buttons (no disabled buttons);
// - a failed fork: the notice shows the reason at once, wizard-create-fork and wizard-work-locally enabled,
//   no wizard-fork-waiting.
//
// E2E hooks, read only when CRAFTORIO_SIMULATION_ONLY=1 (packages/engine/service/areas/project-onboarding.js):
// - CRAFTORIO_E2E_REPO_PUSH=0 (#738, exists): no push access; the signed-in user is e2e-owner and the simulated
//   `gh repo fork` answers https://github.com/e2e-owner/<repo>;
// - CRAFTORIO_E2E_ONBOARDING_HOLD=clone / CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS (exist): the clone held / slowed;
// - CRAFTORIO_E2E_FORK_FAIL=1 (NEW, the developer adds it to e2ePlatformCli): the simulated `gh repo fork`
//   fails, { ok: false, out: 'The simulated fork failed (e2e).' }, so the fork's reason is that line.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// the fork is made at once: well before the slowed clone ends
const AT_ONCE = 10000;
const FORK_FAIL_REASON = 'The simulated fork failed (e2e).';
const FORK_URL = /https:\/\/github\.com\/e2e-owner\/sample-repo\b/;

const wizard = (page) => page.getByTestId('project-wizard');
const currentStep = (page) => wizard(page).locator('[aria-current="step"]').first();
const forkNotice = (page) => wizard(page).getByTestId('wizard-fork-notice');
const FORK_CHOICE = { 'Create a fork': 'wizard-create-fork', 'Work locally': 'wizard-work-locally' };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

Given("the app is open where I can't push to the repositories I import and the clone of an import takes {int} seconds", async ({ e2e }, seconds) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_PUSH: '0', CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS: String(seconds * 1000) } });
});

Given("the app is open where I can't push to the repositories I import, forking fails and the clone of an import keeps running", async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_PUSH: '0', CRAFTORIO_E2E_FORK_FAIL: '1', CRAFTORIO_E2E_ONBOARDING_HOLD: 'clone' } });
});

// unlike #738's "I choose ... in the fork suggestion", the notice is not expected to go away
When('I choose {string} in the fork suggestion while the clone runs', async ({ e2e }, label) => {
  const id = FORK_CHOICE[label];
  if (!id) throw new Error(`unknown choice "${label}": one of ${Object.keys(FORK_CHOICE).join(', ')}`);
  const button = forkNotice(e2e.window).getByTestId(id);
  await expect(button).toBeEnabled();
  await button.click();
});

Then("the fork notice shows the fork's address and says the remotes are set once the clone ends", async ({ e2e }) => {
  const page = e2e.window;
  const notice = forkNotice(page);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(FORK_URL, { timeout: AT_ONCE });
  const waiting = notice.getByTestId('wizard-fork-waiting');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText(/clone/i);
  await expect(waiting).toContainText(/origin/);
  await expect(waiting).toContainText(/upstream/);
  // waiting is said in words, not with two disabled buttons
  for (const id of Object.values(FORK_CHOICE)) await expect(notice.getByTestId(id)).toHaveCount(0);
  // the clone still runs: the wizard has not moved on
  await expect(currentStep(page)).toHaveAttribute('data-step', 'repository');
});

Then('the fork notice says why the fork failed and offers to create a fork or work locally again', async ({ e2e }) => {
  const page = e2e.window;
  const notice = forkNotice(page);
  await expect(notice).toContainText(FORK_FAIL_REASON, { timeout: AT_ONCE });
  await expect(notice.getByTestId('wizard-fork-waiting')).toHaveCount(0);
  for (const [label, id] of Object.entries(FORK_CHOICE)) {
    const button = notice.getByTestId(id);
    await expect(button, `the "${label}" button`).toHaveRole('button');
    await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
    await expect(button).toBeEnabled();
  }
  // said at once: the clone is still held running, the wizard is still on the repository step
  await expect(currentStep(page)).toHaveAttribute('data-step', 'repository');
});
