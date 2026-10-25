// Steps of fronts/analyser/features/city-map-modal.feature (#430, #428): every "Show on the map" opens the project city
// full screen in a modal over the current screen; Close and Esc leave the screen as it was; the modal
// links to the project's Architecture tab; the impact/stage card sits at the top of the city's left
// column; no "Arcs" note; no conflicts is one muted line. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the renderer exposes (the contract for these steps):
// - data-testid="city-modal" (role dialog): the city modal, one at a time, over the screen it was
//   opened from (that screen stays in the page behind it); it holds the city ([data-city-mode], see
//   architecture.steps.js) and its button data-testid="city-modal-close" ("Close") and link
//   data-testid="city-modal-open-project" ("Open in Projects": Projects › <project> › Architecture);
// - data-testid="city-impact": the impact / stage card inside the city, with "city-impact-header" and
//   "city-impact-conflicts" (the paths two items would change; with none, one muted line and no list
//   item); data-city-panel="notes": the notes column of the city (the card opens at its top).
// The screens behind the modal: the Roadmap (data-testid="roadmap-stage"), the Backlog
// ("backlog-list" / "backlog-board"), the Releases ("release-row").

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const cityModal = (page) => page.getByTestId('city-modal');
const inModal = (page, id) => visible(cityModal(page).getByTestId(id)).first();
const impactCard = (page) => inModal(page, 'city-impact');

const SCREENS = {
  roadmap: (page) => page.getByTestId('roadmap-stage'),
  backlog: (page) => page.getByTestId('backlog-list').or(page.getByTestId('backlog-board')),
  releases: (page) => page.getByTestId('release-row'),
};
const screenOf = (page, name) => {
  const screen = SCREENS[name.toLowerCase()];
  if (!screen) throw new Error(`no screen "${name}" (known: ${Object.keys(SCREENS).join(', ')})`);
  return screen(page);
};

Then('the city opens in a modal over the {string} screen', async ({ e2e }, name) => {
  const page = e2e.window;
  const modal = cityModal(page);
  await expect(modal).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(modal).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(modal).toHaveRole('dialog');
  await expect(modal.locator('[data-city-mode]').first(), 'the city is in the modal').toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(modal.locator('canvas').first(), 'the city is drawn in a canvas').toBeVisible({ timeout: LOAD_TIMEOUT });
  // full screen: the modal covers the window
  const viewport = page.viewportSize() || await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const box = await modal.boundingBox();
  expect(box.width, 'as wide as the window').toBeGreaterThanOrEqual(viewport.width - 2);
  expect(box.height, 'as tall as the window').toBeGreaterThanOrEqual(viewport.height - 2);
  // the screen it came from is still there behind it, not replaced by Projects › Architecture
  expect(await screenOf(page, name).count(), `the ${name} screen stays behind the modal`).toBeGreaterThan(0);
  await expect(visible(page.getByTestId('project-page')), 'no move to the project page').toHaveCount(0);
});

Then('the city modal shows the stage card marking {string} as a conflict', async ({ e2e }, file) => {
  await expect(impactCard(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const conflicts = inModal(e2e.window, 'city-impact-conflicts');
  await expect(conflicts).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(conflicts).toContainText(file, { timeout: LOAD_TIMEOUT });
});

Then('the city modal shows the impact card of the issue {string}', async ({ e2e }, title) => {
  await expect(impactCard(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(inModal(e2e.window, 'city-impact-header')).toContainText(title, { timeout: LOAD_TIMEOUT });
});

When('I close the city modal', async ({ e2e }) => {
  const close = inModal(e2e.window, 'city-modal-close');
  await expect(close).toBeVisible({ timeout: LOAD_TIMEOUT });
  await close.click();
});

Then('no city modal is open', async ({ e2e }) => {
  await expect(visible(cityModal(e2e.window))).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the project page is not shown', async ({ e2e }) => {
  await expect(visible(e2e.window.getByTestId('project-page'))).toHaveCount(0);
});

Then('the Roadmap still shows the stage {string}', async ({ e2e }, stageName) => {
  // the stage's name is the value of its "Stage name" input, which hasText does not read
  const stage = e2e.window.getByTestId('roadmap-stage').filter({ has: e2e.window.locator(`input[value="${stageName}"]`) }).first();
  await expect(stage).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(stage.getByTestId('show-stage-on-map')).toBeVisible();
});

Then('the Backlog list still shows the issue {string}', async ({ e2e }, title) => {
  const list = e2e.window.getByTestId('backlog-list');
  await expect(list, 'the Board is still a list').toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(list.getByTestId('backlog-issue').filter({ hasText: title }).first()).toBeVisible();
});

Then('the city modal offers the link {string}', async ({ e2e }, label) => {
  const link = inModal(e2e.window, 'city-modal-open-project');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
});

When('I follow the city modal\'s {string} link', async ({ e2e }, label) => {
  const link = inModal(e2e.window, 'city-modal-open-project');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toContainText(label);
  await link.click();
});

// #428: the card is in the left column (where the notes are), at its top, not centred over the city
Then('the stage card sits at the top of the city\'s left column, not over the middle of the city', async ({ e2e }) => {
  const page = e2e.window;
  const card = impactCard(page);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  const city = visible(cityModal(page).locator('[data-city-mode]')).first();
  const c = await city.boundingBox();
  const k = await card.boundingBox();
  expect(k.x, 'the card starts in the left part of the city').toBeLessThan(c.x + c.width * 0.15);
  expect(k.x + k.width / 2, 'the card is not centred over the city').toBeLessThan(c.x + c.width * 0.35);
  expect(k.y, 'the card is at the top of the column').toBeLessThan(c.y + c.height * 0.25);
  const notes = visible(cityModal(page).locator('[data-city-panel="notes"]')).first();
  if (await notes.count()) {
    const n = await notes.boundingBox();
    expect(Math.abs(k.x - n.x), 'the card is in the notes column').toBeLessThan(24);
    expect(k.y, 'the card is above the notes').toBeLessThanOrEqual(n.y);
  }
});

Then('the city shows no {string} note', async ({ e2e }, name) => {
  const city = visible(cityModal(e2e.window).locator('[data-city-mode]')).first();
  await expect(city).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(city).not.toContainText(new RegExp(`\\b${escapeRe(name)}\\b`));
});

Then('the stage card\'s conflicts are one muted line listing no building', async ({ e2e }) => {
  const conflicts = inModal(e2e.window, 'city-impact-conflicts');
  await expect(conflicts).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(conflicts.getByRole('listitem'), 'no building listed').toHaveCount(0);
  await expect(conflicts).toContainText(/\S/);
  const lineHeight = await conflicts.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5);
  const box = await conflicts.boundingBox();
  expect(box.height, 'one line high').toBeLessThan(lineHeight * 1.8 + 8);
});

// red: a colour whose red channel dominates (the old conflicts box), checked on text, background and border
Then('the stage card\'s conflicts are not drawn in red', async ({ e2e }) => {
  const conflicts = inModal(e2e.window, 'city-impact-conflicts');
  await expect(conflicts).toBeVisible({ timeout: LOAD_TIMEOUT });
  const colours = await conflicts.evaluate((el) => {
    const s = getComputedStyle(el);
    return { text: s.color, background: s.backgroundColor, border: s.borderLeftColor, borderWidth: s.borderLeftWidth };
  });
  const isRed = (css) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(css || '');
    if (!m) return false;
    const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    return a > 0.05 && r > 150 && r > g * 1.8 && r > b * 1.8;
  };
  expect(isRed(colours.text), `text colour ${colours.text}`).toBe(false);
  expect(isRed(colours.background), `background ${colours.background}`).toBe(false);
  if (parseFloat(colours.borderWidth) > 0) expect(isRed(colours.border), `border ${colours.border}`).toBe(false);
});
