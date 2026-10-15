// Steps of features/findings.feature (#361): the Findings button for development. The button
// ([data-testid="findings-button"], also Ctrl+Shift+F) shows when the app runs from source (as in the
// E2E app) or when Settings › General › "Findings button" is on. It freezes the view in an overlay
// ([data-testid="findings-overlay"]) with a marking toolbar ([data-testid="findings-toolbar"],
// tools findings-tool-<name>), the frozen picture ([data-testid="findings-canvas"]: a click with the
// pin tool places a numbered [data-testid="findings-pin"]), a note (findings-note), Save
// (findings-save), File as issue (findings-file-issue) and Cancel (findings-cancel); its state line is
// [data-testid="findings-status"]. Settings › General lists the saved findings in
// [data-testid="settings-findings-list"], one list item per finding with its note and status.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const overlay = (page) => page.getByTestId('findings-overlay');
const toolbar = (page) => overlay(page).getByTestId('findings-toolbar');
const canvas = (page) => overlay(page).getByTestId('findings-canvas');
const pins = (page) => overlay(page).getByTestId('findings-pin');
const findingsList = (page) => page.getByTestId('settings-findings-list');
// "1, 2, 3" → ['1', '2', '3']
const listOf = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

When('I open the findings view', async ({ e2e }) => {
  await e2e.window.getByTestId('findings-button').click();
  await expect(overlay(e2e.window)).toBeVisible();
});

Then('the findings toolbar offers the tools {string}', async ({ e2e }, tools) => {
  await expect(toolbar(e2e.window)).toBeVisible();
  for (const tool of listOf(tools)) await expect(toolbar(e2e.window).getByTestId(`findings-tool-${tool.toLowerCase()}`)).toBeVisible();
});

When('I choose the {string} marking tool', async ({ e2e }, tool) => {
  await toolbar(e2e.window).getByTestId(`findings-tool-${tool.toLowerCase()}`).click();
});

// distinct spots across the middle of the frozen picture
When('I place {int} pin(s) on the frozen view', async ({ e2e }, count) => {
  const box = await canvas(e2e.window).boundingBox();
  expect(box, 'the frozen picture is in view').toBeTruthy();
  for (let i = 0; i < count; i++) {
    await canvas(e2e.window).click({ position: { x: Math.round(box.width * (0.2 + 0.2 * i)), y: Math.round(box.height * 0.5) } });
  }
  await expect(pins(e2e.window)).toHaveCount(count);
});

Then('the frozen view shows the pins numbered {string}', async ({ e2e }, numbers) => {
  const expected = listOf(numbers);
  await expect(pins(e2e.window)).toHaveCount(expected.length);
  await expect(pins(e2e.window)).toHaveText(expected);
});

When('I write the finding note {string}', async ({ e2e }, note) => {
  await overlay(e2e.window).getByTestId('findings-note').fill(note);
});

When('I save the finding', async ({ e2e }) => {
  await overlay(e2e.window).getByTestId('findings-save').click();
});

When('I file the finding as an issue', async ({ e2e }) => {
  await overlay(e2e.window).getByTestId('findings-file-issue').click();
});

Then('the findings view says {string}', async ({ e2e }, text) => {
  await expect(overlay(e2e.window).getByTestId('findings-status')).toContainText(text);
});

Then('the findings view offers {string}', async ({ e2e }, name) => {
  await expect(overlay(e2e.window).getByRole('button', { name, exact: true })).toBeVisible();
});

When('I close the findings view', async ({ e2e }) => {
  await e2e.window.keyboard.press('Escape');
  await expect(overlay(e2e.window)).toBeHidden();
});

Then('the findings view is closed', async ({ e2e }) => {
  await expect(overlay(e2e.window)).toBeHidden();
});

Then('the findings list shows the finding {string} as {string}', async ({ e2e }, note, status) => {
  const item = findingsList(e2e.window).getByRole('listitem').filter({ hasText: note });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(status);
});

Then('the findings list has no finding', async ({ e2e }) => {
  await expect(findingsList(e2e.window)).toBeVisible();
  await expect(findingsList(e2e.window).getByRole('listitem')).toHaveCount(0);
});
