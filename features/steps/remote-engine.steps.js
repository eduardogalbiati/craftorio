// Steps of features/remote-engine.feature (#480): the engine connection page, its own window opened
// by Settings › Execution › Engine's Change… (data-testid="settings-engine-change"), with a plain
// http address that is neither loopback nor Tailscale. The window is found among the app's windows
// (e2e.app.windows()) by data-testid="engine-connection" and kept as e2e.connectionWindow; the
// fixture closes it with the app. Locators are roles and data-testid only (skills/ui-conventions):
//   engine-connection-mode-remote      the "Remote engine" radio
//   engine-connection-address          the address field
//   engine-connection-save             Save and restart
//   engine-connection-result           the last test / save result (data-kind: ok | warn | error | busy)
//   engine-connection-now              where the engine runs now
//   engine-connection-allow-insecure   NEW (#480): the "Allow an insecure connection" checkbox
//   engine-connection-insecure-warning NEW (#480): the warning shown while that box is checked
// Nothing here reaches an engine: no server runs, and no address given is ever saved.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;

function connectionWindow(e2e) {
  expect(e2e.connectionWindow, 'the engine connection page was opened in this scenario').toBeTruthy();
  return e2e.connectionWindow;
}

async function findConnectionWindow(e2e) {
  for (const win of e2e.app.windows()) {
    if (win === e2e.window || win.isClosed()) continue;
    if (await win.getByTestId('engine-connection').isVisible().catch(() => false)) return win;
  }
  return null;
}

When('I open the engine connection page', async ({ e2e }) => {
  await e2e.window.getByTestId('settings-engine-change').click();
  await expect.poll(async () => !!(await findConnectionWindow(e2e)), { timeout: LOAD_TIMEOUT, message: 'the engine connection page opened' }).toBe(true);
  e2e.connectionWindow = await findConnectionWindow(e2e);
  await e2e.connectionWindow.waitForLoadState('domcontentloaded');
});

When('I choose the remote engine {string} on the connection page', async ({ e2e }, address) => {
  const win = connectionWindow(e2e);
  await win.getByTestId('engine-connection-mode-remote').check();
  await win.getByTestId('engine-connection-address').fill(address);
});

When('I save the engine connection', async ({ e2e }) => {
  await connectionWindow(e2e).getByTestId('engine-connection-save').click();
});

When('I allow an insecure connection on the connection page', async ({ e2e }) => {
  await connectionWindow(e2e).getByTestId('engine-connection-allow-insecure').check();
});

Then('the connection page refuses the address as insecure', async ({ e2e }) => {
  const result = connectionWindow(e2e).getByTestId('engine-connection-result');
  await expect(result).toHaveAttribute('data-kind', 'error', { timeout: LOAD_TIMEOUT });
  await expect(result).toContainText(/insecure|not encrypted|https/i);
});

Then('the connection page offers to allow an insecure connection', async ({ e2e }) => {
  const box = connectionWindow(e2e).getByTestId('engine-connection-allow-insecure');
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(box).not.toBeChecked();
});

Then('the connection page does not offer to allow an insecure connection', async ({ e2e }) => {
  const win = connectionWindow(e2e);
  await expect(win.getByTestId('engine-connection-address')).toHaveValue(/127\.0\.0\.1|localhost|ts\.net|100\./);
  await expect(win.getByTestId('engine-connection-allow-insecure')).toBeHidden();
});

Then('the connection page warns that the connection is insecure', async ({ e2e }) => {
  const warning = connectionWindow(e2e).getByTestId('engine-connection-insecure-warning');
  await expect(warning).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(warning).toContainText(/insecure|not encrypted/i);
});

Then('the connection page shows no insecure connection warning', async ({ e2e }) => {
  await expect(connectionWindow(e2e).getByTestId('engine-connection-insecure-warning')).toBeHidden();
});

Then('the connection page says this computer runs the engine', async ({ e2e }) => {
  await expect(connectionWindow(e2e).getByTestId('engine-connection-now')).toContainText('This computer runs the engine', { timeout: LOAD_TIMEOUT });
});
