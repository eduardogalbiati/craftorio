// Steps of #411 (features/navigation.feature): the sidebar's runs stay open and pinned at the bottom,
// only the menu scrolls. Locators are roles, data-testid and the sidebar's existing ids only
// (skills/ui-conventions).
//
// What the sidebar exposes (the renderer's contract for these steps):
// - data-testid="sidebar-menu": the scrolling part of nav.sidebar, holding every menu entry and group
//   (Home … Settings); the only part of the sidebar that scrolls.
// - data-testid="sidebar-footer": the footer pinned to the bottom of the sidebar, holding
//   #nav-keep-awake, #nav-run (the Run item) and #nav-runs (the runs in progress, never folded; one
//   button per run with data-run="<run id>", data-gate="1" when it waits at a gate). Its height is
//   capped (about half the window); past it only #nav-runs scrolls inside the footer.
// The window's height is set at launch (Given the app is open in a WxH window, backlog.steps.js).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { VISUAL_NOW } = require('../support/fixed-clock');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the app's sidebar (another view may render a <nav> of its own)
const sidebar = (page) => page.locator('nav.sidebar');
const menu = (page) => page.getByTestId('sidebar-menu');
const footer = (page) => page.getByTestId('sidebar-footer');
const runRows = (page) => footer(page).locator('#nav-runs [data-run]');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a sidebar entry by its label; a count badge may follow it (as in app.steps.js)
const entryName = (name) => new RegExp(`^${escapeRe(name)}(\\s+(☾\\s+)?\\d+)?$`);
const windowHeight = (page) => page.evaluate(() => window.innerHeight);
const rowBoxes = async (page) => {
  const boxes = [];
  for (const row of await runRows(page).all()) boxes.push(await row.boundingBox());
  return boxes;
};

// the visual scenarios' opening at a given window size: a fixed clock (#362) and a theme
Given('the app is open in a {int}x{int} window in the {word} theme', async ({ e2e }, w, h, theme) => {
  await e2e.open({ size: `${w}x${h}`, theme, now: VISUAL_NOW });
});

// Concurrent runs is off by default (src/domains/workspace/workspace.js): written into settings.json (as roadmap.steps.js
// does), then the page reloads so the renderer reads it; simulations hold no slot (countSimulations off)
Given('concurrent runs are on', async ({ e2e }) => {
  const file = path.join(e2e.scratch, 'workspace', 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, concurrentRuns: { ...(settings.concurrentRuns || {}), enabled: true, countSimulations: false } }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// opens every collapsed menu group (a group's title is a button with aria-expanded)
When('every menu group is open', async ({ e2e }) => {
  const page = e2e.window;
  const collapsed = menu(page).getByRole('button', { expanded: false });
  while (await collapsed.count()) await collapsed.first().click();
  await expect(collapsed).toHaveCount(0);
  expect(await menu(page).getByRole('button', { expanded: true }).count(), 'the menu groups, open').toBeGreaterThanOrEqual(4);
});

Then('the sidebar lists {int} runs, {int} of them waiting at a gate', async ({ e2e }, runs, gates) => {
  const page = e2e.window;
  await expect(runRows(page)).toHaveCount(runs, { timeout: LOAD_TIMEOUT });
  await expect(footer(page).locator('#nav-runs [data-run][data-gate="1"]')).toHaveCount(gates, { timeout: LOAD_TIMEOUT });
});

Then('the sidebar menu is taller than its space and scrolls', async ({ e2e }) => {
  const { scroll, client } = await menu(e2e.window).evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(scroll, 'the menu\'s content overflows its box').toBeGreaterThan(client);
});

// every run row, the Run item and the footer are fully inside the window, with nothing scrolled
Then('the runs in the sidebar are in view without scrolling', async ({ e2e }) => {
  const page = e2e.window;
  const height = await windowHeight(page);
  expect(await menu(page).evaluate((el) => el.scrollTop), 'the menu is not scrolled').toBe(0);
  await expect(footer(page).locator('#nav-run')).toBeInViewport({ ratio: 1 });
  const n = await runRows(page).count();
  expect(n, 'runs listed in the sidebar').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const row = runRows(page).nth(i);
    await expect(row).toBeVisible();
    await expect(row).toBeInViewport({ ratio: 1 });
    const box = await row.boundingBox();
    expect(box.y, `run row ${i + 1}'s top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `run row ${i + 1}'s bottom, within the ${height}px window`).toBeLessThanOrEqual(height + 0.5);
  }
});

// the footer sits at the sidebar's bottom, under the menu, and is no taller than half the window
Then('the runs footer is pinned to the bottom of the sidebar', async ({ e2e }) => {
  const page = e2e.window;
  const height = await windowHeight(page);
  const nav = await sidebar(page).boundingBox();
  const foot = await footer(page).boundingBox();
  const list = await menu(page).boundingBox();
  expect(Math.round(foot.y + foot.height), 'the footer\'s bottom is the sidebar\'s bottom').toBe(Math.round(nav.y + nav.height));
  expect(foot.y + foot.height, 'the footer\'s bottom, within the window').toBeLessThanOrEqual(height + 0.5);
  expect(list.y + list.height, 'the menu ends where the footer starts').toBeLessThanOrEqual(foot.y + 0.5);
  expect(foot.height, 'the footer\'s height, at most about half the window').toBeLessThanOrEqual(height / 2 + 1);
});

// remembers where the run rows are, then scrolls the menu to its end
When('I scroll the sidebar menu to its end', async ({ e2e }) => {
  const page = e2e.window;
  e2e.runRowBoxes = await rowBoxes(page);
  const top = await menu(page).evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
  expect(top, 'the menu scrolled').toBeGreaterThan(0);
  await expect.poll(() => menu(page).evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)).toBe(true);
});

Then('the runs in the sidebar have not moved', async ({ e2e }) => {
  const before = e2e.runRowBoxes;
  expect(before?.length, 'the run rows noted before scrolling').toBeGreaterThan(0);
  const after = await rowBoxes(e2e.window);
  expect(after.length, 'the runs still listed').toBe(before.length);
  after.forEach((box, i) => {
    expect(Math.round(box.y), `run row ${i + 1}'s top`).toBe(Math.round(before[i].y));
    expect(Math.round(box.x), `run row ${i + 1}'s left`).toBe(Math.round(before[i].x));
  });
  await expect(runRows(e2e.window).first()).toBeInViewport({ ratio: 1 });
});

// in view, inside the menu's visible part: not hidden under the footer
Then('{string} in the sidebar is in view above the runs', async ({ e2e }, name) => {
  const page = e2e.window;
  const item = menu(page).getByRole('button', { name: entryName(name) });
  await expect(item).toBeInViewport({ ratio: 1 });
  const box = await item.boundingBox();
  const foot = await footer(page).boundingBox();
  const list = await menu(page).boundingBox();
  expect(box.y + box.height, `"${name}"'s bottom, above the runs footer`).toBeLessThanOrEqual(foot.y + 0.5);
  expect(box.y + box.height, `"${name}"'s bottom, inside the menu's box`).toBeLessThanOrEqual(list.y + list.height + 0.5);
});

// modelled on "the board looks like the baseline" (backlog.steps.js): the config's toHaveScreenshot
Then('the sidebar looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(sidebar(e2e.window)).toHaveScreenshot(name);
});
