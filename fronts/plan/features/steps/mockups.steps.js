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
// simulated designer (CRAFTORIO_SIMULATION_ONLY) writes the screen.
// A seeded mockup is written in the scratch workspace through the mockups domain
// (packages/engine/fronts/plan/domains/mockups.js createScreen), required inside the step. The editor window
// is found among the app's windows (e2e.app.windows()) by its root and kept as e2e.mockupWindow; the
// fixture closes every window after the scenario.

const fs = require('fs');
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
  const { slug, commit } = mockups.createScreen(path.join(e2e.scratch, 'workspace'), e2e.project.id, { title, html, source: { kind: 'prompt' } });
  expect(slug).toBeTruthy();
  e2e.seededMockups = { ...(e2e.seededMockups || {}), [title]: { slug, commit } };
});

// #836 (#258): only a Ready card, at or above the clarity bar (85%), can be committed. The card is
// recorded through the app's service like discovery.steps.js seedCard, then the seeded mockup's current
// version is attached to it as the editor's Attach does (mockups attachment + discovery:add-attachment).
Given('the mockup {string} is attached to the Discovery card {string}, in Ready and {int}% clear', async ({ e2e }, title, cardTitle, score) => {
  const seeded = e2e.seededMockups?.[title];
  expect(seeded, `the mockup "${title}" was seeded in this scenario`).toBeTruthy();
  const mockups = require(path.join(ROOT, 'fronts', 'plan', 'engine', 'domains', 'mockups'));
  const att = mockups.attachment(path.join(e2e.scratch, 'workspace'), e2e.project.id, { slug: seeded.slug, commit: seeded.commit });
  const data = Buffer.from(JSON.stringify(att, null, 2), 'utf8').toString('base64');
  const res = await e2e.window.evaluate(async ({ projectId, cardTitle, score, name, data }) => {
    try {
      const card = await window.api.createDiscoveryCard(projectId, cardTitle, `Notes about ${cardTitle}`, 'idea');
      await window.api.updateDiscoveryCard(projectId, card.id, { clarity: { score, gaps: [], ts: new Date().toISOString(), by: 'Product Owner' } });
      await window.api.moveDiscoveryCard(projectId, card.id, 'ready');
      await window.api.addDiscoveryAttachment(projectId, card.id, undefined, name, data);
      return { id: card.id };
    } catch (e) {
      return { thrown: String(e?.message || e) };
    }
  }, { projectId: e2e.project.id, cardTitle, score, name: att.name, data });
  expect(res?.thrown, `the card "${cardTitle}" could not be recorded with the mockup attached`).toBeFalsy();
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

// ---- #836: Review this screen, Start a development run, Prepare issues ---------------------------
// The developer adds these data-testids (in the editor window unless said otherwise):
//   mockup-review-screen         the "Review this screen" button (an on-demand review: kit conformance,
//                                axe, layout; never on every turn)
//   mockup-start-run             the "Start a development run" button: opens the main window's Start
//                                panel with the `mockup` input filled with a frozen version; never starts
//                                a run on its own
//   mockup-recreate-from-app     the "Recreate from the running app" button (not exercised here)
//   mockup-cost-estimate         the cost estimate shown before a paid action (the review, the recreation),
//                                in a dialog (role=dialog) or a box holding its confirm button (named
//                                "Review", "Run the review", "Confirm", "Continue" or "Start")
//   mockup-prepare-issues        in a row of mockup-versions (the first row is the current version):
//                                "Prepare issues", opens the Discovery commit dialog (#258)
//   discovery-commit-crop        in discovery-commit-dialog: one cropped image per selected region
// The review's findings are written in the designer chat (mockup-chat). The Start panel is the existing
// one (start-workflow its Start button; an input's control carries data-wi-input="<key>", as in
// fronts/build/features/steps/run.steps.js). The commit dialog is the existing discovery-commit-dialog
// with its discovery-commit-issue rows, looked for in the editor window and in the main window. The
// simulated commit files into <workspace>/backlog/<projectId>.json (discovery-commit.js simulatedExec):
// "nothing filed" compares its issues with their count when "Prepare issues" was chosen.

// the editor's buttons by their visible label (literal getByTestId calls, so testid-check-588 sees them)
const EDITOR_ACTIONS = {
  'Review this screen': (win) => win.getByTestId('mockup-review-screen'),
  'Start a development run': (win) => win.getByTestId('mockup-start-run'),
  'Recreate from the running app': (win) => win.getByTestId('mockup-recreate-from-app'),
};
const CONFIRM = /^(review|run the review|confirm|continue|start)\b/i;
// the simulated review (kit conformance, axe, layout) answers in the chat
const REVIEW_TIMEOUT = 60000;

const costEstimate = (win) => win.getByTestId('mockup-cost-estimate').filter({ visible: true }).first();
// the dialog (or the nearest ARIA group around the estimate text) that holds the estimate and its confirm button:
// the testid sits on the estimate's own text line, a sibling of the confirm button, not on a wrapping box
const estimateBox = (win) => win.getByRole('dialog').filter({ has: win.getByTestId('mockup-cost-estimate') })
  .or(win.getByTestId('mockup-cost-estimate').locator('xpath=ancestor::*[@role="group"][1]'))
  .filter({ visible: true }).first();
const startInput = (page, key) => page.locator(`#inputs-form [data-wi-input="${key}"], #adv-form [data-wi-input="${key}"]`);
// the Versions list sits in a collapsed <details>; open it before its rows (e.g. mockup-prepare-issues) can be used
async function openVersionsPanel(win) {
  const details = win.getByTestId('mockup-versions').locator('xpath=ancestor::details[1]');
  const isOpen = await details.evaluate((el) => el.open).catch(() => true);
  if (!isOpen) await details.locator('summary').first().click();
}

function backlogIssues(e2e) {
  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${path.basename(String(e2e.project.id))}.json`);
  if (!fs.existsSync(file)) return 0;
  return (JSON.parse(fs.readFileSync(file, 'utf8')).issues || []).length;
}

// the window (the editor or the main one) whose commit dialog shows
async function commitDialogWindow(e2e) {
  for (const win of [mockupWindow(e2e), e2e.window]) {
    if (await win.getByTestId('discovery-commit-dialog').isVisible().catch(() => false)) return win;
  }
  return null;
}

When('I choose {string} in the mockup editor', async ({ e2e }, label) => {
  const locate = EDITOR_ACTIONS[label];
  expect(Boolean(locate), `the mockup editor has a button "${label}"`).toBe(true);
  const button = locate(mockupWindow(e2e));
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAccessibleName(label);
  await expect(button).toBeEnabled();
  await button.click();
});

Then('the mockup editor shows a cost estimate to confirm before it runs', async ({ e2e }) => {
  const win = mockupWindow(e2e);
  await expect(costEstimate(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(costEstimate(win)).toContainText(/\$\s?\d/);
  await expect(estimateBox(win).getByRole('button', { name: CONFIRM }).first()).toBeEnabled();
});

When('I confirm the mockup editor\'s cost estimate', async ({ e2e }) => {
  const win = mockupWindow(e2e);
  await estimateBox(win).getByRole('button', { name: CONFIRM }).first().click();
  await expect(win.getByTestId('mockup-cost-estimate').filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the designer chat shows the review\'s findings on kit conformance, accessibility and layout', async ({ e2e }) => {
  const chat = mockupWindow(e2e).getByTestId('mockup-chat');
  await expect(chat).toContainText(/\bkit\b/i, { timeout: REVIEW_TIMEOUT });
  await expect(chat).toContainText(/\baxe\b|accessib/i);
  await expect(chat).toContainText(/layout/i);
});

Then('the Start panel\'s input {string} holds the current version of the mockup {string}', async ({ e2e }, key, title) => {
  const page = e2e.window;
  const workspace = path.join(e2e.scratch, 'workspace');
  const screen = mockups().listScreens(workspace, e2e.project.id).find((s) => s.title === title);
  expect(screen, `the project has the mockup "${title}"`).toBeTruthy();
  const [current] = mockups().listVersions(workspace, e2e.project.id, screen.slug);
  expect(current, `the mockup "${title}" has a version`).toBeTruthy();
  await expect(page.getByTestId('start-workflow')).toBeVisible({ timeout: LOAD_TIMEOUT });
  const input = startInput(page, key);
  await expect(input).toHaveCount(1);
  // frozen: the screen and its version's commit, never a moving "latest"
  await expect(input).toHaveValue(new RegExp(screen.slug), { timeout: LOAD_TIMEOUT });
  await expect(input).toHaveValue(new RegExp(String(current.commit).slice(0, 7)));
});

When('I choose {string} on the mockup\'s current version', async ({ e2e }, label) => {
  const win = mockupWindow(e2e);
  await openVersionsPanel(win);
  const button = win.getByTestId('mockup-versions').getByTestId('mockup-prepare-issues').first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAccessibleName(new RegExp(`^${label}\\b`, 'i'));
  e2e.backlogIssuesBefore = backlogIssues(e2e);
  await button.click();
});

Then('the commit dialog lists the proposed issues with {int} cropped region(s)', async ({ e2e }, count) => {
  await expect.poll(async () => !!(await commitDialogWindow(e2e)), { timeout: DESIGNER_TIMEOUT, message: 'the Discovery commit dialog opened' }).toBe(true);
  const dialog = (await commitDialogWindow(e2e)).getByTestId('discovery-commit-dialog');
  await expect(dialog).toHaveRole('dialog');
  await expect(dialog.getByTestId('discovery-commit-issue').first()).toBeVisible();
  const crops = dialog.getByTestId('discovery-commit-crop');
  await expect(crops).toHaveCount(count);
  for (let i = 0; i < count; i += 1) {
    await expect(crops.nth(i)).toBeVisible();
    // an image: an <img> (inside the crop or the crop itself) with a loaded picture, or role=img
    await expect.poll(() => crops.nth(i).evaluate((el) => {
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      return img ? img.complete && img.naturalWidth > 0 : el.getAttribute('role') === 'img';
    }), { message: `the cropped region ${i + 1} is an image` }).toBe(true);
  }
});

Then('no issue has been filed to the project\'s backlog', async ({ e2e }) => {
  const win = await commitDialogWindow(e2e);
  expect(win, 'the commit dialog still waits for the owner\'s confirmation').toBeTruthy();
  await expect(win.getByTestId('discovery-commit-dialog').getByRole('button', { name: 'File the issues', exact: true })).toBeVisible();
  expect(backlogIssues(e2e)).toBe(e2e.backlogIssuesBefore ?? 0);
});

// ---- #837: export to the repository by PR, the live link, live components (Storybook) ------------
// The developer adds these data-testids:
//   mockups-export-repo          on the Mockups screen, the "Export to the repository" button (next to the
//                                existing mockups-export zip export); it opens a dialog (role=dialog, named
//                                "Export to the repository") with one checkbox per mockup (named by the
//                                mockup's title), a checkbox "Make the kit the official design system" and
//                                an "Export" / "Open the export" / "Continue" button. Confirming opens the
//                                main window's Start panel on workflows/mockups-export.yaml with the chosen
//                                screens in its `screens` input (data-wi-input="screens", the slugs) and
//                                never starts a run on its own (the PR is made by that run)
//   mockup-live-link             in the editor, the "Share a live link" button: disabled (or aria-disabled)
//                                until the security review #466-#470 is done
//   mockup-live-link-blocked     next to it, the message saying why (mentions the security review)
//   mockup-components-source     in the editor, where the screen's components come from: the project's
//                                Storybook ("live components") or the static kit, saying why
// "No Storybook": the demo project's folder (when it has one) holds no .storybook/ folder and its
// package.json has no storybook dependency or script.

const EXPORT_CONFIRM = /^(export|open the export|continue)\b/i;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slugOf = (e2e, title) => {
  const seeded = e2e.seededMockups?.[title];
  expect(seeded, `the mockup "${title}" was seeded in this scenario`).toBeTruthy();
  return seeded.slug;
};

When('I export only the mockup {string} to the repository, making the kit the official design system', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(card(page, title)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const open = view(page).getByTestId('mockups-export-repo');
  await expect(open).toHaveAccessibleName(/export to the repository/i);
  await open.click();
  const dialog = page.getByRole('dialog', { name: /export to the repository/i });
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  // only the chosen mockup: every other mockup's checkbox is cleared
  for (const other of Object.keys(e2e.seededMockups || {})) {
    const box = dialog.getByRole('checkbox', { name: new RegExp(`^${escapeRe(other)}\\b`) });
    await expect(box).toHaveCount(1);
    await box.setChecked(other === title);
  }
  await dialog.getByRole('checkbox', { name: /official design system/i }).check();
  await dialog.getByRole('button', { name: EXPORT_CONFIRM }).first().click();
});

Then('the Start panel opens on the workflow {string} with the mockup {string} and without {string}', async ({ e2e }, file, chosen, left) => {
  const page = e2e.window;
  await expect(page.getByTestId('start-workflow')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('combobox', { name: 'Workflow', exact: true })).toHaveValue(file);
  const input = startInput(page, 'screens');
  await expect(input).toHaveCount(1);
  await expect(input).toHaveValue(new RegExp(escapeRe(slugOf(e2e, chosen))), { timeout: LOAD_TIMEOUT });
  await expect(input).not.toHaveValue(new RegExp(escapeRe(slugOf(e2e, left))));
});

Then('the mockup editor\'s {string} is unavailable and says it waits for the security review', async ({ e2e }, label) => {
  const win = mockupWindow(e2e);
  const button = win.getByTestId('mockup-live-link');
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAccessibleName(new RegExp(`^${escapeRe(label)}\\b`, 'i'));
  // disabled, or aria-disabled: either way a click shares nothing
  await expect.poll(() => button.evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true'), { message: `"${label}" is unavailable` }).toBe(true);
  const why = win.getByTestId('mockup-live-link-blocked');
  await expect(why).toBeVisible();
  await expect(why).toContainText(/security review/i);
});

Given('the project has no Storybook', async ({ e2e }) => {
  const folder = e2e.project?.folder;
  if (!folder || !fs.existsSync(folder)) return;
  expect(fs.existsSync(path.join(folder, '.storybook')), 'the project has no .storybook folder').toBe(false);
  const pkgFile = path.join(folder, 'package.json');
  if (fs.existsSync(pkgFile)) expect(fs.readFileSync(pkgFile, 'utf8'), 'the project\'s package.json names no Storybook').not.toMatch(/storybook/i);
});

Then('the mockup editor says the screen uses the static kit because the project has no Storybook', async ({ e2e }) => {
  const source = mockupWindow(e2e).getByTestId('mockup-components-source');
  await expect(source).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(source).toContainText(/static kit/i);
  await expect(source).toContainText(/storybook/i);
});
