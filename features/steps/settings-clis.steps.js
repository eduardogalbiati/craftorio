// Steps of features/740-settings-clis.feature (#740): Settings › Agents & CLIs manages the CLIs (status,
// version, account, Install / Sign in) in a page or drawer that closes, with no setup stepper; the
// project wizard's CLI warning opens it on the missing CLI and closing it returns to the wizard's step;
// Install shows its output in a console panel and checks the row again. Opening Settings and its tab
// is app.steps.js's; the wizard's steps are onboarding.steps.js's; the Setup's are setup.steps.js's.
//
// What the screens expose (the renderer's contract for these steps), roles and data-testid only:
//   settings-clis               the Agents & CLIs section (Settings' page or a drawer over the screen)
//   settings-clis-close         its close button (role button, named "Close")
//   setup-cli-<id>              a CLI's row, the same as setup.js's (claude, codex, grok, gh, glab, git):
//                               its name, its status (Ready / Not signed in / Not installed / Checking…,
//                               on an element with data-state, "checking" while it is checked), its
//                               version and account when found, and its buttons "▶ Install" / "▶ Sign in";
//                               a data-highlight attribute on the CLI the section was opened for only
//                               (the same contract as packages/ui-kit/test/renderer-settings-clis-740.test.js)
//   cli-console                 the console panel of a running or ended Install / Sign in: its output,
//                               data-state="running" | "ended"
//   wizard-cli-warning          the wizard's CLI warning (data-error="cli-missing" | "cli-signed-out"),
//                               its "Open Setup" button opens Agents & CLIs (no longer the first-run Setup)
// A simulated machine without a CLI: CRAFTORIO_E2E_CLI_MISSING=<id> (simulation only), its probes find
// no such CLI until a simulated Install of it, which writes its output and installs nothing.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the CLI checks (each CLI's --version and auth status) and an Install's end
const CHECK_TIMEOUT = 45000;

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
const STATUS = /Ready|Not signed in|Not installed|Checking…/;
const FINAL_STATUS = /Ready|Not signed in|Not installed/;

const section = (page) => page.getByTestId('settings-clis').filter({ visible: true });
const cliRow = (page, name) => section(page).getByTestId(`setup-cli-${cliId(name)}`);
const wizard = (page) => page.getByTestId('project-wizard');
const cliWarning = (page) => wizard(page).getByTestId('wizard-cli-warning');

Given('the app is open on a machine without the {string}', async ({ e2e }, name) => {
  await e2e.open({ env: { CRAFTORIO_E2E_CLI_MISSING: cliId(name) } });
});

Then('Agents & CLIs lists Claude Code, Codex CLI, Grok Build, GitHub CLI, GitLab CLI and Git, each with a status', async ({ e2e }) => {
  const page = e2e.window;
  await expect(section(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const [name] of CLIS) {
    const row = cliRow(page, name);
    await expect(row, `the Agents & CLIs row for ${name}`).toBeVisible();
    await expect(row).toContainText(name);
    await expect(row).toContainText(STATUS);
  }
  // once checked, every row has a final status
  for (const [name] of CLIS) await expect(cliRow(page, name)).toContainText(FINAL_STATUS, { timeout: CHECK_TIMEOUT });
});

Then('the {string} row of Agents & CLIs offers Install or Sign in', async ({ e2e }, name) => {
  const row = cliRow(e2e.window, name);
  await expect(row).toContainText(FINAL_STATUS, { timeout: CHECK_TIMEOUT });
  const action = row.getByRole('button', { name: /Install|Sign in/ });
  await expect(action.first()).toBeVisible();
  await expect(action.first()).toBeEnabled();
});

Then('the {string} row of Agents & CLIs reads {string}', async ({ e2e }, name, status) => {
  await expect(cliRow(e2e.window, name)).toContainText(status, { timeout: CHECK_TIMEOUT });
});

Then('Agents & CLIs has a close button', async ({ e2e }) => {
  const close = section(e2e.window).getByTestId('settings-clis-close');
  await expect(close).toBeVisible();
  await expect(close).toHaveAccessibleName(/Close/);
});

// no stepper (the first-run Setup's, or one of its own) and none of the Setup's Back / Next / Skip
Then('Agents & CLIs shows no setup stepper and no Next or Skip', async ({ e2e }) => {
  const page = e2e.window;
  await expect(section(page)).toBeVisible();
  await expect(page.getByTestId('setup').filter({ visible: true })).toHaveCount(0);
  await expect(section(page).locator('[data-testid^="setup-step-"]')).toHaveCount(0);
  await expect(section(page).locator('[aria-current="step"]')).toHaveCount(0);
  await expect(section(page).getByRole('button', { name: /^\s*(Next|Skip)\s*$/ })).toHaveCount(0);
});

Then('the wizard warns that {string} is not installed', async ({ e2e }, cli) => {
  const warning = cliWarning(e2e.window);
  await expect(warning).toHaveAttribute('data-error', 'cli-missing', { timeout: CHECK_TIMEOUT });
  await expect(warning).toContainText(cli);
  await expect(warning.getByRole('button', { name: 'Open Setup', exact: true })).toBeVisible();
});

When("I open the Setup from the wizard's CLI warning", async ({ e2e }) => {
  await cliWarning(e2e.window).getByRole('button', { name: 'Open Setup', exact: true }).click();
});

Then('Agents & CLIs is open with the {string} row highlighted', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(section(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const row = cliRow(page, name);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-highlight');
  await expect(row).toBeInViewport();
  // only that one
  await expect(section(page).locator('[data-testid^="setup-cli-"][data-highlight]')).toHaveCount(1);
});

When('I close Agents & CLIs', async ({ e2e }) => {
  const page = e2e.window;
  await section(page).getByTestId('settings-clis-close').click();
  await expect(page.getByTestId('settings-clis').filter({ visible: true })).toHaveCount(0);
});

// a confirm, if Install asks one, is accepted (a native one or the app's confirm dialog)
When('I install {string} from Agents & CLIs', async ({ e2e }, name) => {
  const page = e2e.window;
  const onDialog = (dialog) => dialog.accept().catch(() => {});
  page.once('dialog', onDialog);
  await cliRow(page, name).getByRole('button', { name: /Install/ }).click();
  const confirm = page.getByTestId('confirm-modal');
  const consolePanel = page.getByTestId('cli-console');
  await expect(confirm.or(consolePanel).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (await confirm.isVisible()) {
    await confirm.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
    await expect(confirm).toBeHidden();
  }
  page.off('dialog', onDialog);
});

Then('the CLI console shows the install of {string} and that it ended', async ({ e2e }, name) => {
  const consolePanel = e2e.window.getByTestId('cli-console');
  await expect(consolePanel).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(consolePanel).toContainText(cliId(name));
  await expect(consolePanel).toHaveAttribute('data-state', 'ended', { timeout: CHECK_TIMEOUT });
});

Then('the {string} row of Agents & CLIs is checked again and no longer reads {string}', async ({ e2e }, name, status) => {
  const row = cliRow(e2e.window, name);
  await expect(row.locator('[data-state="checking"]')).toHaveCount(0, { timeout: CHECK_TIMEOUT });
  await expect(row).toContainText(FINAL_STATUS);
  await expect(row).not.toContainText(status);
});
