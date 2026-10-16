// Steps of features/settings.feature's language scenarios (#327, #328): Settings › General's
// "Language" group (data-testid="settings-language") next to Time zone, with two selects named by
// their aria-label: "AI agents" (default "Same as the interface", saved as language.agents) and
// "Issues" (default "English", saved as language.issues; its help text, tied with aria-describedby,
// names issues, PR/MR descriptions and commit messages). Opening Settings, its tabs and reloading the
// app reuse app.steps.js. Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const languageGroup = (page) => page.getByTestId('settings-language').filter({ visible: true });
const languageSelect = (page, name) => languageGroup(page).getByRole('combobox', { name, exact: true });

Then('the General settings show a {string} group', async ({ e2e }, title) => {
  const group = languageGroup(e2e.window);
  await expect(group).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(group).toContainText(title);
});

// the chosen option's label, whatever value the option stores
Then('the {string} language is {string}', async ({ e2e }, name, label) => {
  const select = languageSelect(e2e.window, name);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(select.locator('option:checked')).toHaveText(label, { timeout: LOAD_TIMEOUT });
});

// the options' labels, all of them and in this order ("A, B, C")
Then('the {string} language list offers {string}', async ({ e2e }, name, list) => {
  const select = languageSelect(e2e.window, name);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(select.getByRole('option')).toHaveText(list.split(', '));
});

When('I choose {string} as the {string} language', async ({ e2e }, label, name) => {
  const select = languageSelect(e2e.window, name);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label });
  await expect(select.locator('option:checked')).toHaveText(label);
});

Then('the {string} language\'s help names issues, PR\\/MR descriptions and commit messages', async ({ e2e }, name) => {
  const select = languageSelect(e2e.window, name);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(select).toHaveAccessibleDescription(/issues/i);
  await expect(select).toHaveAccessibleDescription(/\bPR\b|pull request/i);
  await expect(select).toHaveAccessibleDescription(/commit messages/i);
});
