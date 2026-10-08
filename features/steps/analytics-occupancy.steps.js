// Steps of features/analytics.feature (#275): Home › Analytics › 24/7, the "Hours of the day"
// heatmap that says more is more (a busier hour is a stronger green), its caption and its legend,
// and their visual baselines in both themes. Opening Home's tabs and Analytics' tabs reuses
// home.steps.js and run.steps.js. Locators are roles and data-testid only (skills/ui-conventions):
//   an-occ-hours        the whole "Hours of the day" section: heading with its caption, heatmap,
//                       legend (NEW with #275: the developer adds this wrapper)
//   an-occ-heat         the heatmap (a 24-hour strip per day)
//   an-occ-heat-legend  its legend: the scale from "idle" to "fully active", plus "no data"
// The 24/7 meter loads after the tab opens ("Loading…" first): every step waits for the heatmap.

const { expect } = require('@playwright/test');
const { Then } = require('./fixtures');

const hours = (page) => page.getByTestId('an-occ-hours');
const heat = (page) => page.getByTestId('an-occ-heat');
const legend = (page) => page.getByTestId('an-occ-heat-legend');

Then('the hours heatmap says {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(heat(page)).toBeVisible({ timeout: 30000 });
  await expect(hours(page)).toContainText(text, { ignoreCase: true });
});

Then('the heatmap legend reads {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  await expect(heat(page)).toBeVisible({ timeout: 30000 });
  await expect(legend(page)).toBeVisible();
  for (const text of [a, b, c]) await expect(legend(page)).toContainText(text, { ignoreCase: true });
});

// modelled on "the board looks like the baseline" (backlog.steps.js): the config's toHaveScreenshot
// options apply (maxDiffPixelRatio, animations off, caret hidden, css scale)
Then('the hours heatmap looks like the baseline {string}', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(heat(page)).toBeVisible({ timeout: 30000 });
  await expect(legend(page)).toBeVisible();
  await expect(hours(page)).toHaveScreenshot(name);
});
