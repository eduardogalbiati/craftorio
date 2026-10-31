// Steps of features/setup.feature (#319): the first-run Setup on a new workspace, Skip and its
// confirm, setupDone in the workspace's settings.json, Settings › Agents & CLIs › "Run setup again".
// Locators are roles and data-testid only (skills/ui-conventions):
//   setup                                   the Setup (a large modal or screen)
//   setup-step-<slug>                       a stepper item: agents, try-it-safely, first-project
//                                           (#643: no workflows step any more); the current one
//                                           has aria-current="step"
//   setup-cli-<id>                          a row of the Agents step: claude, codex, grok, gh, glab,
//                                           git; its status badge reads Ready / Not signed in / Not
//                                           installed / Checking…, a required CLI shows "Required"
//   setup-skip, setup-next, setup-back      the Setup's buttons
//   confirm-modal                           the app's confirm dialog (index.html), Skip's confirm
// (#643) the last step, First project, opens the project wizard (onboarding.steps.js) by itself on a
// workspace with no project, as it opened the old New project dialog.
// "Run setup again" is a button of Settings › Agents & CLIs, by its role and name.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const CLIS = [
  ['Claude Code', 'claude'],
  ['Codex CLI', 'codex'],
  ['Grok Build', 'grok'],
  ['GitHub CLI', 'gh'],
  ['GitLab CLI', 'glab'],
  ['Git', 'git'],
];
const cliId = (name) => {
  const found = CLIS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown CLI "${name}" (one of ${CLIS.map(([n]) => n).join(', ')})`);
  return found[1];
};
const stepSlug = (name) => name.toLowerCase().replace(/\s+/g, '-');
const STATUS = /Ready|Not signed in|Not installed|Checking…/;

const setup = (page) => page.getByTestId('setup');
const stepItem = (page, name) => setup(page).getByTestId(`setup-step-${stepSlug(name)}`);
const cliRow = (page, name) => setup(page).getByTestId(`setup-cli-${cliId(name)}`);

// a first start: the workspace folder is not seeded (no settings.json, no project)
Given('the app is open on a new workspace', async ({ e2e }) => {
  await e2e.open({ empty: true });
});

Then('the first-run Setup is open on its {string} step', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(setup(page)).toBeVisible({ timeout: 30000 });
  await expect(stepItem(page, name)).toHaveAttribute('aria-current', 'step');
});

async function stepperReads(page, names) {
  for (const name of names) {
    await expect(stepItem(page, name)).toBeVisible();
    await expect(stepItem(page, name)).toContainText(name);
  }
  // in this order in the stepper
  const ids = names.map((n) => `setup-step-${stepSlug(n)}`);
  const inOrder = await setup(page).evaluate((root, list) => {
    const els = list.map((id) => root.querySelector(`[data-testid="${id}"]`));
    return els.every((el, i) => i === 0 || (els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, ids);
  expect(inOrder, `the stepper reads ${names.join(', ')} in this order`).toBe(true);
  // and nothing else (#643: three steps, no Workflows)
  await expect(setup(page).locator('[data-testid^="setup-step-"]')).toHaveCount(names.length);
}

Then("the Setup's stepper reads {string}, {string} and {string}", async ({ e2e }, a, b, c) => {
  await stepperReads(e2e.window, [a, b, c]);
});

Then("the Setup's stepper has no {string} step", async ({ e2e }, name) => {
  await expect(stepItem(e2e.window, 'Agents')).toBeVisible();
  await expect(stepItem(e2e.window, name)).toHaveCount(0);
  await expect(setup(e2e.window).getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

When("I go to the Setup's next step", async ({ e2e }) => {
  const page = e2e.window;
  const before = await setup(page).locator('[aria-current="step"]').getAttribute('data-testid');
  await setup(page).getByTestId('setup-next').click();
  await expect(setup(page).locator('[aria-current="step"]')).not.toHaveAttribute('data-testid', before);
});

Then('the Setup lists Claude Code, Codex CLI, Grok Build, GitHub CLI, GitLab CLI and Git, each with a status', async ({ e2e }) => {
  for (const [name] of CLIS) {
    const row = cliRow(e2e.window, name);
    await expect(row, `the Setup's row for ${name}`).toBeVisible();
    await expect(row).toContainText(name);
    await expect(row).toContainText(STATUS);
  }
});

Then('the Setup marks {string} as required', async ({ e2e }, name) => {
  await expect(cliRow(e2e.window, name)).toContainText('Required');
});

When('I skip the Setup and confirm', async ({ e2e }) => {
  const page = e2e.window;
  await expect(setup(page)).toBeVisible({ timeout: 30000 });
  // a native confirm, if the app uses one, is accepted; otherwise the app's confirm dialog
  const onDialog = (dialog) => dialog.accept().catch(() => {});
  page.once('dialog', onDialog);
  await setup(page).getByTestId('setup-skip').click();
  const confirm = page.getByTestId('confirm-modal');
  await expect(confirm.or(setup(page)).first()).toBeVisible();
  if (await confirm.isVisible()) {
    await confirm.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
    await expect(confirm).toBeHidden();
  }
  page.off('dialog', onDialog);
});

// stays away for a moment once Home is there (the Setup opens after the window's start-up checks)
Then('the first-run Setup is not shown', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true })).toBeVisible({ timeout: 30000 });
  for (let i = 0; i < 4; i++) {
    await expect(setup(page)).toBeHidden();
    await page.waitForTimeout(500);
  }
  await expect(setup(page)).toBeHidden();
});

Then('the workspace settings record the setup as done', async ({ e2e }) => {
  const file = path.join(e2e.scratch, 'workspace', 'settings.json');
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).setupDone; } catch { return undefined; }
  }).toBe(true);
});

When('I ask to run the setup again', async ({ e2e }) => {
  await e2e.window.getByRole('button', { name: 'Run setup again', exact: true }).click();
});
