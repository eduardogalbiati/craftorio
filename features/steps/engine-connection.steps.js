// Steps of features/engine-connection-security.feature (#479): the engine connection page, a second
// Electron window (src/renderer/connection/, src/host/engine-connection-window.js) opened by Settings ›
// Execution › Engine › Change… (data-testid="settings-engine-change"). Locators are roles and
// data-testid only (skills/ui-conventions):
//   engine-connection                   the page's root (found among e2e.app.windows())
//   engine-connection-mode-remote       the "Remote engine" radio (shows the address and token fields)
//   engine-connection-token             the token field
//   engine-token-unencrypted-warning    (#479) the warning that the token is stored unencrypted, shown
//                                       when safeStorage is unavailable on this computer
// "This computer cannot encrypt" replaces safeStorage.isEncryptionAvailable() in the app's main
// process (e2e.app.evaluate: the same electron module src/host/main.js uses), before the page opens.
// The window is kept on the scenario's fixture as e2e.connectionWindow; the fixture closes the app,
// and every window with it, after the scenario (fixtures.js).

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the token hint's claim (connection.token_hint in src/shared/i18n/en.json)
const KEPT_ENCRYPTED = /Kept encrypted/i;

const pageRoot = (win) => win.getByTestId('engine-connection');

function connectionWindow(e2e) {
  expect(e2e.connectionWindow, 'the engine connection page was opened in this scenario').toBeTruthy();
  return e2e.connectionWindow;
}

Given('this computer cannot encrypt the engine token', async ({ e2e }) => {
  await e2e.app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => false;
  });
});

// "I open the engine connection page" is defined once, in remote-engine.steps.js (shared with #480)
When('I choose a remote engine on the engine connection page', async ({ e2e }) => {
  const win = connectionWindow(e2e);
  await win.getByTestId('engine-connection-mode-remote').check();
  await expect(win.getByTestId('engine-connection-token')).toBeVisible();
});

Then('the engine connection page warns that the token is stored unencrypted', async ({ e2e }) => {
  const warning = connectionWindow(e2e).getByTestId('engine-token-unencrypted-warning');
  await expect(warning).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(warning).toContainText(/unencrypted|not encrypted|plain text/i);
});

Then('the engine connection page does not warn that the token is stored unencrypted', async ({ e2e }) => {
  const win = connectionWindow(e2e);
  await expect(win.getByTestId('engine-connection-token')).toBeVisible();
  await expect(win.getByTestId('engine-token-unencrypted-warning')).toBeHidden();
});

Then('the engine connection page does not say the token is kept encrypted', async ({ e2e }) => {
  await expect(pageRoot(connectionWindow(e2e))).not.toContainText(KEPT_ENCRYPTED);
});

Then('the engine connection page says the token is kept encrypted', async ({ e2e }) => {
  await expect(pageRoot(connectionWindow(e2e))).toContainText(KEPT_ENCRYPTED);
});
