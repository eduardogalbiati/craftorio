// Steps of fronts/build/features/local-preview-confirm.feature (#481, SEC-22): Run App's confirmation at a gate
// with `local_preview: true` (packages/ui-kit/gate-panel.js runAppConfirmHtml) for a command the
// repository declares (.multiagent/local-preview.yaml, packages/engine/domains/local/local-preview.js readRepoConfig). The run
// itself reuses run.steps.js (Start panel, "Validated" mode, the gate card). Locators are roles and
// data-testid only (skills/ui-conventions):
//   run-gate                    the gate card; its Run App button is the button named "▶ Run App…" /
//                               "▶ Run App: <command>"
//   run-app-confirm             (#481) the confirmation popover, holding
//     run-app-confirm-install   the install command
//     run-app-confirm-command   the command
//     run-app-confirm-env       one per environment variable, "NAME=value"
//     run-app-confirm-source    where the command comes from: data-source="repo" | "project" |
//                               "workflow", its text naming the repository
//   and its Cancel button (role button "Cancel").
// A simulated run makes no worktree: its gates work in the demo project's folder (inputs.repo_path,
// packages/engine/engine/run/gates.js), so the declaration is written there before the run starts.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;

const gateCard = (page) => page.getByTestId('run-gate').filter({ visible: true }).first();
const runAppButton = (page) => gateCard(page).getByRole('button', { name: /Run App/ });
const confirmBox = (page) => page.getByTestId('run-app-confirm').filter({ visible: true }).first();

// "A=1, B=two words" → { A: '1', B: 'two words' } (a value keeps its own spaces)
function parseEnv(text) {
  return Object.fromEntries(String(text).split(/,\s*/).filter(Boolean).map((pair) => {
    const i = pair.indexOf('=');
    expect(i, `an env entry NAME=value: "${pair}"`).toBeGreaterThan(0);
    return [pair.slice(0, i).trim(), pair.slice(i + 1)];
  }));
}

const yamlString = (s) => JSON.stringify(String(s));

Given('the demo project\'s repository declares a local preview with the install {string}, the command {string} and the env {string}', async ({ e2e }, install, command, env) => {
  const folder = e2e.project?.folder;
  expect(folder, 'the demo project has a folder').toBeTruthy();
  const vars = parseEnv(env);
  const lines = [
    '# How this repository runs locally (Run App in the Craftorio).',
    `install: ${yamlString(install)}`,
    `command: ${yamlString(command)}`,
    'env:',
    ...Object.entries(vars).map(([k, v]) => `  ${k}: ${yamlString(v)}`),
    '',
  ];
  fs.mkdirSync(path.join(folder, '.multiagent'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.multiagent', 'local-preview.yaml'), lines.join('\n'));
});

When('I click Run App on the gate card', async ({ e2e }) => {
  const button = runAppButton(e2e.window);
  await expect(button).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await button.click();
  await expect(confirmBox(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('I cancel the Run App confirmation', async ({ e2e }) => {
  const box = confirmBox(e2e.window);
  await box.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(box).toBeHidden();
});

Then('the Run App confirmation shows the install {string}', async ({ e2e }, install) => {
  await expect(confirmBox(e2e.window).getByTestId('run-app-confirm-install')).toHaveText(install);
});

Then('the Run App confirmation shows the command {string}', async ({ e2e }, command) => {
  await expect(confirmBox(e2e.window).getByTestId('run-app-confirm-command')).toHaveText(command);
});

Then('the Run App confirmation shows the env {string}', async ({ e2e }, entry) => {
  const entries = confirmBox(e2e.window).getByTestId('run-app-confirm-env');
  await expect(entries.filter({ hasText: entry })).toHaveCount(1);
  await expect(entries.filter({ hasText: entry })).toHaveText(entry);
});

Then('the Run App confirmation marks the command as coming from the repository', async ({ e2e }) => {
  const source = confirmBox(e2e.window).getByTestId('run-app-confirm-source');
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('data-source', 'repo');
  await expect(source).toContainText(/repositor/i);
});

// nothing started: the gate's Stop (shown while the app runs) is hidden, no Run App terminal tab in the dock
Then('no local preview is running for the run', async ({ e2e }) => {
  const page = e2e.window;
  await expect(gateCard(page).getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  await expect(page.getByRole('tab', { name: /Run App|Local preview/ })).toHaveCount(0);
});
