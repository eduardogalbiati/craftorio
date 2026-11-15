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

// ---- #835: the Kit tab, the editor's frames and variants, Compare -------------------------------
// The developer adds these data-testids (the frames reuse mockup-frames: one button per frame, named
// by its label, aria-pressed on the chosen one):
//   mockups-kit-tab              the Mockups screen's "Kit" tab (role=tab)
//   mockups-kit-panel            the Kit tab's panel
//   mockups-kit-token            in the panel, one per token (its text has the token's name)
//   mockups-kit-component        in the panel, one per component (its text has the component's name)
//   mockups-kit-preview          in a component, its live preview (an element or an iframe)
//   mockup-variant-new           in the editor, the "New variant" button; it opens a dialog
//                                (role=dialog, named "New variant") with a "Name" textbox and a
//                                "Create" button
//   mockup-variant-current       in the editor, the current variant's name
//   mockup-compare-open          in the editor, the "Compare" button (the two latest versions by default)
//   mockup-compare               the comparison view
//   mockup-compare-before        its older side, mockup-compare-after its newer side (elements or iframes)
//   mockup-changed               a highlighted changed node, in the comparison or inside either side's iframe
// A seeded kit is written through the mockups domain (writeKit); a newer version through saveTurn,
// the same function the designer's turn saves with.

const COMPARE_SIDES = ['mockup-compare-before', 'mockup-compare-after'];

const mockups = () => require(path.join(ROOT, 'fronts', 'plan', 'engine', 'domains', 'mockups'));
const kitPanel = (page) => view(page).getByTestId('mockups-kit-panel');

// a side of the comparison: its text, whether the side is an element or an iframe
async function sideText(win, testId) {
  const side = win.getByTestId('mockup-compare').getByTestId(testId);
  await expect(side).toBeVisible({ timeout: LOAD_TIMEOUT });
  const tag = await side.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== 'iframe') return side.innerText();
  return win.frameLocator(`[data-testid="mockup-compare"] [data-testid="${testId}"]`).locator('body').innerText();
}

async function changedCount(win) {
  const compare = win.getByTestId('mockup-compare');
  let n = await compare.getByTestId('mockup-changed').count();
  for (const testId of COMPARE_SIDES) {
    const side = compare.getByTestId(testId);
    if ((await side.evaluate((el) => el.tagName.toLowerCase())) !== 'iframe') continue;
    n += await win.frameLocator(`[data-testid="mockup-compare"] [data-testid="${testId}"]`).getByTestId('mockup-changed').count();
  }
  return n;
}

Given('the project has a visual kit with the token {string} and the component {string}', async ({ e2e }, token, component) => {
  const tokens = [{ name: token, value: '#2563eb', file: 'src/styles.css', line: 1 }];
  const klass = component.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { commit } = mockups().writeKit(path.join(e2e.scratch, 'workspace'), e2e.project.id, {
    tokensCss: `:root { ${token}: #2563eb; }\n`,
    componentsCss: `.${klass} { background: var(${token}); color: #fff; padding: 8px 16px; border-radius: 6px; }\n`,
    kit: { sources: ['src/styles.css'], tokens, fonts: [], components: [{ name: component, class: klass, source: 'src/Button.jsx' }], inferences: [] },
  });
  expect(commit).toBeTruthy();
});

When('I open the Kit tab of the Mockups screen', async ({ e2e }) => {
  const page = e2e.window;
  await expect(view(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const tab = view(page).getByTestId('mockups-kit-tab');
  await expect(tab).toHaveAccessibleName(/kit/i);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(kitPanel(page)).toBeVisible();
});

Then('the Kit tab lists the token {string}', async ({ e2e }, token) => {
  const item = kitPanel(e2e.window).getByTestId('mockups-kit-token').filter({ hasText: token });
  await expect(item).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(item).toBeVisible();
});

Then('the Kit tab lists the component {string} with a preview', async ({ e2e }, component) => {
  const item = kitPanel(e2e.window).getByTestId('mockups-kit-component').filter({ hasText: component });
  await expect(item).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('mockups-kit-preview')).toBeVisible();
});

When('I switch the mockup editor\'s frame to {string}', async ({ e2e }, label) => {
  const frames = mockupWindow(e2e).getByTestId('mockup-frames');
  const button = frames.getByRole('button', { name: new RegExp(`^${label}\\b`, 'i') });
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

Then('the mockup\'s canvas is {int} pixels wide', async ({ e2e }, width) => {
  const canvas = mockupWindow(e2e).getByTestId('mockup-canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Math.round((await canvas.boundingBox())?.width || 0), { timeout: LOAD_TIMEOUT, message: `the canvas is ${width} px wide` }).toBe(width);
});

When('I create the variant {string} of the mockup', async ({ e2e }, name) => {
  const win = mockupWindow(e2e);
  await win.getByTestId('mockup-variant-new').click();
  const dialog = win.getByRole('dialog', { name: /new variant/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /name/i }).fill(name);
  await dialog.getByRole('button', { name: /^create\b/i }).click();
  await expect(dialog).toBeHidden({ timeout: LOAD_TIMEOUT });
});

Then('the mockup editor shows {string} as the current variant', async ({ e2e }, name) => {
  await expect(mockupWindow(e2e).getByTestId('mockup-variant-current')).toContainText(name, { timeout: LOAD_TIMEOUT });
});

Given('the mockup {string} has a newer version where the button reads {string}', async ({ e2e }, title, label) => {
  const workspace = path.join(e2e.scratch, 'workspace');
  const screen = mockups().listScreens(workspace, e2e.project.id).find((s) => s.title === title);
  expect(screen, `the project has the mockup "${title}"`).toBeTruthy();
  const html = `<main class="page"><header class="page-head"><h1>${title}</h1><button class="export">${label}</button></header></main>`;
  const { commit } = mockups().saveTurn(workspace, e2e.project.id, { slug: screen.slug, html, message: `Rename the button to ${label}` });
  expect(commit).toBeTruthy();
  expect(mockups().listVersions(workspace, e2e.project.id, screen.slug).length).toBeGreaterThanOrEqual(2);
});

When('I compare the two latest versions of the mockup', async ({ e2e }) => {
  const win = mockupWindow(e2e);
  const open = win.getByTestId('mockup-compare-open');
  await expect(open).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(win.getByTestId('mockup-compare')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the comparison shows the version with {string} beside the version with {string}', async ({ e2e }, before, after) => {
  const win = mockupWindow(e2e);
  await expect.poll(() => sideText(win, 'mockup-compare-before'), { timeout: LOAD_TIMEOUT }).toContain(before);
  await expect.poll(() => sideText(win, 'mockup-compare-after'), { timeout: LOAD_TIMEOUT }).toContain(after);
  const compare = win.getByTestId('mockup-compare');
  const a = await compare.getByTestId('mockup-compare-before').boundingBox();
  const b = await compare.getByTestId('mockup-compare-after').boundingBox();
  expect(a && b, 'both sides are drawn').toBeTruthy();
  // side by side: the newer to the right of the older, overlapping vertically
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  expect(b.y).toBeLessThan(a.y + a.height);
});

Then('the comparison highlights the changed nodes', async ({ e2e }) => {
  await expect.poll(() => changedCount(mockupWindow(e2e)), { timeout: LOAD_TIMEOUT, message: 'a changed node is highlighted' }).toBeGreaterThan(0);
});
