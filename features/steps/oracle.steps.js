// Steps of features/oracle.feature (#208): the Oracle's panel (docked on the Dashboard, a drawer
// elsewhere) in a narrow window: the app never shifts sideways, the panel's header stays readable.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

// the Oracle's panel in view: the Dashboard's dock or the drawer (a closed drawer is aria-hidden and
// the dock of a hidden Dashboard is not rendered, so only the open one matches)
const oraclePanel = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });
const HEADER_BUTTONS = ['Night watch', 'Memory', 'New session'];

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

When('I open the Oracle', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('navigation').getByRole('button', { name: /^Oracle(\s+\d+)?$/ }).click();
  const panel = oraclePanel(page);
  await expect(panel).toBeVisible();
  // opening it focuses its question box: the moment a focus scroll would shift the page
  await expect(panel.getByRole('textbox')).toBeFocused();
});

When('I open the Oracle\'s {string} form', async ({ e2e }, button) => {
  const panel = oraclePanel(e2e.window);
  await panel.getByRole('button', { name: button, exact: true }).click();
  // the Night watch form has a Start button, the Memory form a Save button
  await expect(panel.getByRole('button', { name: /^(Start|Save|Edit)$/ }).first()).toBeVisible();
});

Then('the page has not scrolled sideways', async ({ e2e }) => {
  const shifted = await e2e.window.evaluate(() => {
    const boxes = [document.scrollingElement, document.querySelector('.shell'), document.querySelector('main.content'), document.querySelector('#view-dashboard')];
    return boxes.filter(Boolean).map((el) => ({ el: el.className || el.tagName, left: el.scrollLeft })).filter((x) => x.left !== 0);
  });
  expect(shifted).toEqual([]);
});

Then('the sidebar is visible', async ({ e2e }) => {
  const sidebar = e2e.window.getByRole('navigation');
  await expect(sidebar).toBeInViewport();
  const box = await sidebar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
});

Then('the Oracle\'s title is readable, not covered by its header buttons', async ({ e2e }) => {
  const panel = oraclePanel(e2e.window);
  const title = panel.getByRole('heading', { name: 'Oracle', exact: true });
  await expect(title).toBeVisible();
  const t = await title.boundingBox();
  expect(t).not.toBeNull();
  expect(t.width).toBeGreaterThan(0);
  // not clipped: the whole word fits in its box
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const name of HEADER_BUTTONS) {
    const button = panel.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const b = await button.boundingBox();
    expect(overlaps(t, b), `"${name}" covers the title`).toBe(false);
  }
});
