// Steps of fronts/build/features/run-tabs.feature (#410) and the tab row part of features/header.feature (#412):
// the Run screen's first row is its tab row (data-testid run-tab-row) with the tablist "Run view"
// (Chat | Details | 3D), the same row in the same place in Details and in the run chat; the run's
// actions sit on that row on the right, and for a live run "Pause after current step" (run-pause) and
// "Stop" (run-stop) at its right end. Details' right panel is a tablist "Run details" (Artifacts |
// Session | Events, Artifacts open by default). The 3D tab (data-testid run-3d) opens the 3D overlay
// (data-testid run3d, closed by run3d-close) and closing it returns to the tab it came from; without
// WebGL or the 3D bundle the tab is disabled and says why (its title or aria-description).
// Locators are roles and data-testid only (skills/ui-conventions); the shared ones are in
// features/support/run-screen.js.
// #472 (features/472-install-scripts.feature): the Events tab's body is data-testid="run-events",
// each event in it data-testid="run-event"; the start log event that names the commands the run
// runs from the repository says "repository" in its text.

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');
const { LOAD_TIMEOUT, escapeRe, runAction, runTabRow, runTabs, runTab } = require('../../../../features/support/run-screen');

const ROW_TOLERANCE = 2;
const overlay = (page) => page.getByTestId('run3d');
const detailsTabs = (page) => page.getByRole('tablist', { name: 'Run details', exact: true }).filter({ visible: true }).first();
// the row's buttons, by name (the "+ When it finishes…" link-button too); a glyph may lead the name ("◆ Watch")
const rowButton = (page, name) => runTabRow(page).getByRole('button', { name: new RegExp(`(^|\\s)${escapeRe(name)}`) }).filter({ visible: true }).first();

// the tabs, in this order, and nothing of the Run screen above the row (banners, gate cards, panels)
Then('the Run screen\'s first row is the tab row {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  const row = runTabRow(page);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(runTabs(page)).toBeVisible();
  const names = (await runTabs(page).getByRole('tab').allInnerTexts()).map((t) => t.trim().split(/\s+/)[0]);
  expect(names).toEqual([a, b, c]);
  const above = await row.evaluate((el, tolerance) => {
    const view = el.closest('section') || el.parentElement;
    const top = el.getBoundingClientRect().top;
    // the part of a box its scrolling ancestors show: the run chat's messages, scrolled to the latest, sit
    // above the row in layout but not on screen
    const shown = (n) => {
      let box = n.getBoundingClientRect();
      for (let p = n.parentElement; p && p !== view; p = p.parentElement) {
        if (getComputedStyle(p).overflowY === 'visible') continue;
        const clip = p.getBoundingClientRect();
        box = { top: Math.max(box.top, clip.top), bottom: Math.min(box.bottom, clip.bottom) };
      }
      return box;
    };
    return [...view.querySelectorAll('*')]
      .filter((n) => !el.contains(n) && !n.contains(el) && n.checkVisibility() && n.getBoundingClientRect().height > 0)
      .filter((n) => {
        const box = shown(n);
        return box.bottom > box.top && box.top < top - tolerance;
      })
      .map((n) => n.getAttribute('data-testid') || n.id || n.className || n.tagName);
  }, ROW_TOLERANCE);
  expect(above, 'nothing of the Run screen sits above its tab row').toEqual([]);
  // the gate card, when one waits, comes under the row
  const gate = page.getByTestId('run-gate').filter({ visible: true }).first();
  if (await gate.count()) {
    expect((await gate.boundingBox()).y, 'the gate card is under the tab row').toBeGreaterThan((await row.boundingBox()).y);
  }
});

Then('the {string} tab of the run is selected', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(runTab(page, name)).toHaveAttribute('aria-selected', 'true', { timeout: LOAD_TIMEOUT });
  for (const tab of await runTabs(page).getByRole('tab').all()) {
    const text = (await tab.innerText()).trim();
    if (!text.startsWith(name)) await expect(tab, `the "${text}" tab`).not.toHaveAttribute('aria-selected', 'true');
  }
});

When('I open the run\'s {string} tab', async ({ e2e }, name) => {
  const page = e2e.window;
  await runTab(page, name).click();
  await expect(runTab(page, name)).toHaveAttribute('aria-selected', 'true', { timeout: LOAD_TIMEOUT });
});

Then('the run\'s tab row offers {string}', async ({ e2e }, name) => {
  await expect(rowButton(e2e.window, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the actions on the row's right: after the tabs (redesign 2026-11-28: a button of the row or an entry of its ⋮ menu)
Then('the run\'s tab row offers {string}, {string} and {string} on the right of the tabs', async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  const tabs = await runTabs(page).boundingBox();
  for (const name of [a, b, c]) {
    const button = await runAction(page, name);
    await expect(button, `"${name}" on the tab row`).toBeVisible({ timeout: LOAD_TIMEOUT });
    expect((await button.boundingBox()).x, `"${name}" is right of the tabs`).toBeGreaterThan(tabs.x + tabs.width - 1);
  }
});

Then('the Run screen shows no {string} banner', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(runTabRow(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('run-chain-banner').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText(title, { exact: true }).filter({ visible: true })).toHaveCount(0);
});

Then('the run details\' side tabs read {string}, {string} and {string}, with {string} open', async ({ e2e }, a, b, c, open) => {
  const tabs = detailsTabs(e2e.window);
  await expect(tabs).toBeVisible({ timeout: LOAD_TIMEOUT });
  const names = (await tabs.getByRole('tab').allInnerTexts()).map((t) => t.trim().split(/\s+/)[0]);
  expect(names).toEqual([a, b, c]);
  await expect(tabs.getByRole('tab', { name: new RegExp(`^${escapeRe(open)}\\b`) })).toHaveAttribute('aria-selected', 'true');
});

// ---- the Events tab (#472) ----------------------------------------------------------------------------

When('I open the run details\' {string} tab', async ({ e2e }, name) => {
  const tab = detailsTabs(e2e.window).getByRole('tab', { name: new RegExp(`^${escapeRe(name)}\\b`) });
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: LOAD_TIMEOUT });
});

Then('the run\'s events name the commands it runs from the repository, including {string}', async ({ e2e }, command) => {
  const events = e2e.window.getByTestId('run-events').filter({ visible: true }).first();
  await expect(events).toBeVisible({ timeout: LOAD_TIMEOUT });
  const line = events.getByTestId('run-event').filter({ hasText: /repositor/i }).filter({ hasText: command }).first();
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- the row stays in place between Chat and Details ------------------------------------------------

When('I note where the run\'s tab row is', async ({ e2e }) => {
  const tabs = runTabs(e2e.window);
  await expect(tabs).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.runTabsBox = await tabs.boundingBox();
});

Then('the run\'s tab row has not moved', async ({ e2e }) => {
  expect(e2e.runTabsBox, 'the tab row\'s place, noted before').toBeTruthy();
  const tabs = runTabs(e2e.window);
  await expect(tabs).toBeVisible({ timeout: LOAD_TIMEOUT });
  const was = e2e.runTabsBox;
  await expect.poll(async () => {
    const box = await tabs.boundingBox();
    return box && Math.abs(box.x - was.x) <= ROW_TOLERANCE && Math.abs(box.y - was.y) <= ROW_TOLERANCE ? 'in place' : JSON.stringify({ was, now: box });
  }, { timeout: LOAD_TIMEOUT }).toBe('in place');
});

// ---- the 3D tab -------------------------------------------------------------------------------------

// opens the 3D view when the tab is enabled; a disabled 3D tab (no WebGL or no 3D bundle) says why
When('I open the run\'s 3D tab, or it says why it is unavailable', async ({ e2e }) => {
  const page = e2e.window;
  const tab = runTabs(page).getByTestId('run-3d');
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(tab).toHaveAttribute('role', 'tab');
  if (await tab.isDisabled()) {
    const reason = `${(await tab.getAttribute('title')) || ''} ${(await tab.getAttribute('aria-description')) || ''}`.trim();
    expect(reason, 'the disabled 3D tab says why').not.toBe('');
    e2e.run3dOpened = false;
    return;
  }
  await tab.click();
  await expect(overlay(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.run3dOpened = true;
});

When('I close the run\'s 3D view if it opened', async ({ e2e }) => {
  const page = e2e.window;
  if (!e2e.run3dOpened) return;
  await overlay(page).getByTestId('run3d-close').click();
  await expect(overlay(page)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// ---- #412: Stop and Pause after current step on the live run's tab row -------------------------------

// both on the row, right of the tabs and of the run's other actions: the rightmost button of the row is one of them
Then('the run\'s tab row ends with {string} and {string}', async ({ e2e }, a, b) => {
  const page = e2e.window;
  const row = runTabRow(page);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('run-pause')).toHaveAccessibleName('Pause after current step');
  await expect(row.getByTestId('run-stop')).toHaveAccessibleName('Stop');
  const ends = [];
  for (const name of [a, b]) {
    const button = row.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    await expect(button, `"${name}" on the tab row`).toBeEnabled({ timeout: LOAD_TIMEOUT });
    ends.push(await button.boundingBox());
  }
  const left = Math.min(...ends.map((e) => e.x));
  const tabs = await runTabs(page).boundingBox();
  expect(left, 'they come after the tabs').toBeGreaterThan(tabs.x + tabs.width - 1);
  for (const other of ['Ask the supervisor', 'Open in Analytics']) {
    const button = rowButton(page, other);
    if (await button.count()) expect((await button.boundingBox()).x, `"${other}" comes before them`).toBeLessThan(left);
  }
  const rightmost = Math.max(...await row.getByRole('button').filter({ visible: true }).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right)));
  expect(Math.max(...ends.map((e) => e.x + e.width)), 'one of them ends the row').toBeGreaterThanOrEqual(rightmost - 1);
});
