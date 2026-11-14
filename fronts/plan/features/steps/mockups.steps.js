// Steps of fronts/plan/features/mockups.feature (#625): Plan & Design > Mockups and the mockup editor
// window. Opening the screen reuses app.steps.js ("I open {string} in the sidebar"). Locators are
// roles and data-testid only (skills/ui-conventions); the developer adds these data-testids:
//   mockups-view                 the screen's root
//   mockups-empty                the empty state (no kit and no screens), with the kit's cost estimate
//   mockups-build-kit            its "Build the visual kit" button
//   mockups-new                  the "New mockup" button
//   mockups-gallery              the gallery of the project's screens
//   mockups-card                 a screen's card (its text has the screen's title)
//   mockups-open                 in a card: opens the screen in the editor window
//   mockup-editor                the editor window's root (a second Electron window)
//   mockup-canvas                the sandboxed iframe that shows the screen (elements carry data-mid)
//   mockup-chat                  the designer chat
//   mockup-selection-chip        in the chat's composer, one per selected element
// "New mockup" opens a dialog (role=dialog, named "New mockup") with a "Title" textbox, a textbox for
// the prompt (named "Prompt" or "Describe the screen") and a "Create" / "Generate" button; the
// simulated designer (MULTIAGENT_SIMULATION_ONLY) writes the screen.
// A seeded mockup is written in the scratch workspace through the mockups domain
// (fronts/plan/engine/domains/mockups.js createScreen), required inside the step. The editor window
// is found among the app's windows (e2e.app.windows()) by its root and kept as e2e.mockupWindow; the
// fixture closes every window after the scenario.

const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const LOAD_TIMEOUT = 30000;
// the simulated designer writes the screen and the gallery lists it
const DESIGNER_TIMEOUT = 60000;

const view = (page) => page.getByTestId('mockups-view');
const card = (page, title) => view(page).getByTestId('mockups-gallery').getByTestId('mockups-card').filter({ hasText: title });

function mockupWindow(e2e) {
  expect(e2e.mockupWindow, 'the mockup editor window was opened in this scenario').toBeTruthy();
  return e2e.mockupWindow;
}

// the app's window, other than the main one, whose editor shows
async function findMockupWindow(e2e) {
  for (const win of e2e.app.windows()) {
    if (win === e2e.window || win.isClosed()) continue;
    if (await win.getByTestId('mockup-editor').isVisible().catch(() => false)) return win;
  }
  return null;
}

Given('the project has the mockup {string} with a button {string}', async ({ e2e }, title, label) => {
  const mockups = require(path.join(ROOT, 'fronts', 'plan', 'engine', 'domains', 'mockups'));
  const html = `<main class="page"><header class="page-head"><h1>${title}</h1><button class="export">${label}</button></header></main>`;
  const { slug } = mockups.createScreen(path.join(e2e.scratch, 'workspace'), e2e.project.id, { title, html, source: { kind: 'prompt' } });
  expect(slug).toBeTruthy();
});

Then('the Mockups screen says the project has no mockups yet', async ({ e2e }) => {
  await expect(view(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(view(e2e.window).getByTestId('mockups-empty')).toBeVisible();
  await expect(view(e2e.window).getByTestId('mockups-card')).toHaveCount(0);
});

Then('the Mockups screen estimates building the visual kit at {string} to {string}', async ({ e2e }, min, max) => {
  const empty = view(e2e.window).getByTestId('mockups-empty');
  await expect(empty).toContainText(min);
  await expect(empty).toContainText(max);
});

Then('the Mockups screen offers {string} and {string}', async ({ e2e }, buildKit, newMockup) => {
  const page = e2e.window;
  const build = view(page).getByTestId('mockups-build-kit');
  await expect(build).toBeVisible();
  await expect(build).toHaveAccessibleName(buildKit);
  await expect(build).toBeEnabled();
  const create = view(page).getByTestId('mockups-new');
  await expect(create).toBeVisible();
  await expect(create).toHaveAccessibleName(newMockup);
  await expect(create).toBeEnabled();
});

When('I create the mockup {string} from the prompt {string}', async ({ e2e }, title, prompt) => {
  const page = e2e.window;
  await expect(view(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await view(page).getByTestId('mockups-new').click();
  const dialog = page.getByRole('dialog', { name: /new mockup/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /title/i }).fill(title);
  await dialog.getByRole('textbox', { name: /prompt|describe/i }).fill(prompt);
  await dialog.getByRole('button', { name: /^(create|generate)\b/i }).click();
});

Then('the Mockups gallery shows the mockup {string}', async ({ e2e }, title) => {
  await expect(card(e2e.window, title)).toHaveCount(1, { timeout: DESIGNER_TIMEOUT });
  await expect(card(e2e.window, title)).toBeVisible();
});

When('I open the mockup {string} in its editor window', async ({ e2e }, title) => {
  const item = card(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await item.getByTestId('mockups-open').click();
  await expect.poll(async () => !!(await findMockupWindow(e2e)), { timeout: LOAD_TIMEOUT, message: 'the mockup editor window opened' }).toBe(true);
  e2e.mockupWindow = await findMockupWindow(e2e);
  await e2e.mockupWindow.waitForLoadState('domcontentloaded');
});

Then('the mockup editor window shows the canvas', async ({ e2e }) => {
  const win = mockupWindow(e2e);
  await expect(win.getByTestId('mockup-editor')).toBeVisible();
  await expect(win.getByTestId('mockup-canvas')).toBeVisible();
  await expect(win.getByTestId('mockup-chat')).toBeVisible();
});

When('I click {string} on the mockup\'s canvas', async ({ e2e }, text) => {
  const canvas = mockupWindow(e2e).frameLocator('[data-testid="mockup-canvas"]');
  const element = canvas.locator('[data-mid]').filter({ hasText: text }).last();
  await expect(element).toBeVisible({ timeout: LOAD_TIMEOUT });
  await element.click();
});

Then('the designer chat shows a selection chip for {string}', async ({ e2e }, text) => {
  const chips = mockupWindow(e2e).getByTestId('mockup-chat').getByTestId('mockup-selection-chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText(text);
});
