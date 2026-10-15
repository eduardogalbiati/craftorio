// Steps of features/engine-version.feature (#339): the browser UI checks the engine's
// GET /api/version ({ app, contract }) against the interface it was built for, on connect and on
// every reconnect. A served engine and its browser UI come from features/support/served.js (the
// fixture's openServed). "Another version" is faked at the HTTP surface the browser sees: a page
// route answers /api/version with the real response, its app version and contract replaced.
// Locators are roles and data-testid only (skills/ui-conventions). Assumes the banner is
// data-testid="version-skew-banner", reading "This engine runs another version (engine X,
// interface Y): reload to get its interface", with a "Reload" button.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const banner = (page) => page.getByTestId('version-skew-banner');
const VERSION_URL = '**/api/version';

Given('the engine is served on this machine', async ({ e2e }) => {
  await e2e.openServed();
});

// the engine's answer, with its app version and interface (contract) replaced; the contract keeps
// the type the engine sends (number or string), and the answer its shape ({ result } or bare)
Given('the served engine reports version {string} with interface {string}', async ({ e2e }, app, contract) => {
  await e2e.window.route(VERSION_URL, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const info = body && typeof body.result === 'object' && body.result ? body.result : body;
    info.app = app;
    info.contract = typeof info.contract === 'number' ? Number(contract) : contract;
    await route.fulfill({ response, json: body });
  });
});

When('the served engine reports its own version again', async ({ e2e }) => {
  await e2e.window.unroute(VERSION_URL);
});

When('I open the served UI in the browser', async ({ e2e }) => {
  const version = e2e.window.waitForResponse((r) => new URL(r.url()).pathname === '/api/version');
  await e2e.served.open();
  // the check on connect has had its answer
  await version;
});

When('I press the version banner\'s Reload button', async ({ e2e }) => {
  const version = e2e.window.waitForResponse((r) => new URL(r.url()).pathname === '/api/version');
  await banner(e2e.window).getByRole('button', { name: 'Reload', exact: true }).click();
  await e2e.window.waitForLoadState('domcontentloaded');
  await version;
});

Then('no engine version banner shows', async ({ e2e }) => {
  // the UI is up first: an absent banner must not just be a page still loading
  await expect(e2e.window.getByRole('navigation').getByRole('button', { name: /^Home\b/ })).toBeVisible();
  await expect(banner(e2e.window)).toHaveCount(0);
});

Then('a banner says the engine runs another version, engine {string} and interface {string}', async ({ e2e }, app, contract) => {
  await expect(banner(e2e.window)).toBeVisible();
  await expect(banner(e2e.window)).toContainText('This engine runs another version');
  await expect(banner(e2e.window)).toContainText(`engine ${app}`);
  await expect(banner(e2e.window)).toContainText(`interface ${contract}`);
});

Then('the version banner offers a Reload button', async ({ e2e }) => {
  await expect(banner(e2e.window).getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});
