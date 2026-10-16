// Steps of features/settings.feature's interface language scenarios (#329): Settings › General's
// "Language" group (data-testid="settings-language", #327) gets an "Interface" select (aria-label
// "Interface") listing the languages with a catalog (English, Português (Brasil)); a change
// re-renders the open windows at once, without a restart. Choosing it and reading it reuse
// settings-language.steps.js ("I choose {string} as the {string} language", "the {string} language
// is {string}", "the {string} language list offers {string}"); the sidebar's entries reuse
// app.steps.js ("the sidebar offers {string}"). These steps read the sidebar and Settings' tabs
// (data-testid="settings-tabs") in whichever language is shown, so they never wait on an English
// entry such as "Home". Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a sidebar entry by its label; a count badge may follow it (same rule as app.steps.js)
const navItem = (page, name) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+(☾\\s+)?\\d+)?$`) });
const settingsTab = (page, name) => page.getByTestId('settings-tabs').filter({ visible: true }).getByRole('button', { name, exact: true });

// the entry is gone, not merely late: waits until no sidebar entry carries the label
Then('the sidebar no longer offers {string}', async ({ e2e }, name) => {
  await expect(e2e.window.getByRole('navigation').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(navItem(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('Settings offers the {string} tab', async ({ e2e }, name) => {
  await expect(settingsTab(e2e.window, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('Settings no longer offers the {string} tab', async ({ e2e }, name) => {
  await expect(e2e.window.getByTestId('settings-tabs').filter({ visible: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(settingsTab(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
