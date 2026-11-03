// Steps of fronts/build/features/roadmap.feature for the roadmap bar's summary of what is left (#421: planned cost
// and time, the items without an estimate, what was spent, the "By release" list per cut line) and
// the releases the Planned | All switch shows (#425: Planned only the latest release, All every one,
// a release chosen in the Releases filter shown even in Planned), on the demo roadmap
// (scripts/screenshot/views/roadmap.js demoRoadmap: one cut line, "v0.10", after stage 4 "Test
// batch"). Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps, new for #421):
// - #750: the header's numbers band data-testid="roadmap-stats": the "Left" column "n items" / "in m stages", the
//   "Forecast" column "≈ T" / "≈ $X" (+ "+ n without estimate"; its title says "work time; gates not included"),
//   then the "Spent" column "$Y".
// - data-testid="roadmap-summary-by-release": the "By release" toggle (a button, aria-expanded) of the view band
//   (filter-row), only while the roadmap has a cut line.
// - data-testid="roadmap-summary-releases": the open list; one data-testid="roadmap-summary-release-row"
//   per cut line (its release's name, planned "≈ $X · ≈ T"), then a last row "after the last cut line".
// For #425 the release blocks are #291's data-testid="roadmap-release-block" (data-release = version).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONEY = String.raw`\$\s?\d[\d,]*(\.\d+)?`;
const ROW_PLAN_RE = new RegExp(String.raw`≈\s*${MONEY}\s*·\s*≈\s*\S`);

// #750: the summary is the header's numbers band (roadmap-stats): one roadmap-stat column per figure (label, value, detail)
const stats = (page) => page.getByTestId('roadmap-stats');
const column = (page, label) => stats(page).getByTestId('roadmap-stat').filter({ has: page.getByTestId('roadmap-stat-label').getByText(label, { exact: true }) });
const byRelease = (page) => page.getByTestId('filter-row').getByTestId('roadmap-summary-by-release');
const releaseRows = (page) => page.getByTestId('roadmap-summary-releases').getByTestId('roadmap-summary-release-row');

// ---- #421: the header's numbers ---------------------------------------------------------------------

// every cut line ("Release here", stage.release) taken off the demo roadmap's stages; the app follows
// the roadmap file
Given('the roadmap has no cut lines', async ({ e2e }) => {
  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
  const roadmap = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const stage of roadmap.stages) delete stage.release;
  const tmp = `${file}.${process.pid}.cuts.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...roadmap, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
});

// Forecast: "≈ T" and "≈ $X"; Left: "n items", "in m stages"
Then('the roadmap bar shows the planned cost and time of what is left, with its items and stages', async ({ e2e }) => {
  const page = e2e.window;
  await expect(stats(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(column(page, 'Forecast')).toContainText(new RegExp(String.raw`≈\s*\S[\s\S]*≈\s*${MONEY}`));
  await expect(column(page, 'Left')).toContainText(/\d+ items?[\s\S]*in \d+ stages?/);
});

// the demo's test-batch item has no estimate (no past test-batch run)
Then('the roadmap summary counts the items without an estimate', async ({ e2e }) => {
  await expect(column(e2e.window, 'Forecast')).toContainText(/\+\s?[1-9]\d* without estimate/);
});

// the Spent column comes after the Forecast one
Then('the roadmap summary shows what was spent next to it', async ({ e2e }) => {
  const page = e2e.window;
  await expect(column(page, 'Spent').getByTestId('roadmap-stat-value')).toContainText(new RegExp(MONEY));
  const labels = await stats(page).getByTestId('roadmap-stat-label').allInnerTexts();
  expect(labels.indexOf('Spent'), '"Spent" comes after the forecast').toBeGreaterThan(labels.indexOf('Forecast'));
});

Then("the roadmap summary's tooltip says {string}", async ({ e2e }, tip) => {
  await expect(column(e2e.window, 'Forecast')).toHaveAttribute('title', new RegExp(escapeRe(tip)));
});

When('I open the roadmap summary by release', async ({ e2e }) => {
  const toggle = byRelease(e2e.window);
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(toggle).toContainText('By release');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(e2e.window.getByTestId('roadmap-summary-releases')).toBeVisible();
});

Then('the release list has {int} rows', async ({ e2e }, n) => {
  await expect(releaseRows(e2e.window)).toHaveCount(n);
});

// a part whose items all lack an estimate says so instead ("+ n without estimate")
Then('release row {int} names {string} with its planned cost and time', async ({ e2e }, n, name) => {
  const row = releaseRows(e2e.window).nth(n - 1);
  await expect(row).toContainText(name);
  await expect(row).toContainText(new RegExp(`${ROW_PLAN_RE.source}|without estimate`));
});

Then('the roadmap summary offers no "By release" toggle', async ({ e2e }) => {
  await expect(stats(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(byRelease(e2e.window)).toHaveCount(0);
  await expect(e2e.window.getByTestId('roadmap-head').getByRole('button', { name: /By release/ })).toHaveCount(0);
});

// ---- #425: which releases the Planned | All switch shows ------------------------------------------------

const releaseBlock = (page, version) => page.getByTestId('roadmap-release-block').and(page.locator(`[data-release="${version}"]`));

Then('the roadmap shows the release block {string}', async ({ e2e }, version) => {
  await expect(releaseBlock(e2e.window, version)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap does not show the release block {string}', async ({ e2e }, version) => {
  await expect(e2e.window.getByTestId('roadmap-stage').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(releaseBlock(e2e.window, version).filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
