// Steps of features/conflict-map.feature (#150): the Product Owner's conflict map, the files and single
// lines most runs edit, shown next to the roadmap. The map is the workspace file
// backlog/<projectId>.conflict-map.json; the steps save one into the demo workspace (which has none of
// its own: simulated runs never count) and reload the app so it reads it. Locators are roles and
// data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps):
// - data-testid="conflict-map": the "Conflict map" panel beside the roadmap;
// - data-testid="conflict-map-file": one row per hot file, in the saved order; its text holds the path
//   and "<n> runs"; a click shows the runs behind the count;
// - data-testid="conflict-map-line": one row per hot line; its text holds "path:line" and "<n> runs";
// - data-testid="conflict-map-runs": the run ids behind a row, shown after clicking the row;
// - data-testid="conflict-map-empty": the empty state when there is no map or nothing to show.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "14 runs" (or "1 run"), not "114 runs"
const runsRe = (n) => new RegExp(`(^|\\D)${n} runs?\\b`);

const panel = (page) => page.getByTestId('conflict-map').filter({ visible: true }).first();
const fileRows = (page) => panel(page).getByTestId('conflict-map-file');
const fileRow = (page, file) => fileRows(page).filter({ hasText: file }).first();
const lineRows = (page) => panel(page).getByTestId('conflict-map-line');

const mapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.conflict-map.json`);
const readMap = (e2e) => JSON.parse(fs.readFileSync(mapFile(e2e), 'utf8'));

// n run ids, newest first, shaped like the app's (date-time-hex)
const runIdsOf = (n) => Array.from({ length: n }, (_, k) => {
  const i = n - k;
  return `20261011-${String(100000 + i * 100).slice(-6)}-c0f1${String(i).padStart(4, '0')}`;
});

async function saveMap(e2e, map) {
  const file = mapFile(e2e);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, file);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

// the first file changed by the newest `a` runs, the second by the `b` runs after them
Given('the project has a saved conflict map of {int} runs where {string} was changed by {int} runs and {string} by {int}', async ({ e2e }, total, first, a, second, b) => {
  expect(a + b, 'the two files\' runs fit in the map\'s runs').toBeLessThanOrEqual(total);
  const runIds = runIdsOf(total);
  const entry = (file, ids, conflicts) => ({ file, runs: ids.length, runIds: ids, lastRun: ids[0], conflicts });
  await saveMap(e2e, {
    source: 'runs',
    runs: total,
    runIds,
    files: [entry(first, runIds.slice(0, a), 2), entry(second, runIds.slice(a, a + b), 0)],
    lines: [],
  });
});

Given('the saved conflict map has line {int} of {string} changed by {int} runs', async ({ e2e }, line, file, n) => {
  const map = readMap(e2e);
  const ids = map.runIds.slice(0, n);
  expect(ids.length, `the saved map has ${n} runs`).toBe(n);
  map.lines.push({ file, line, text: "const { a, b, c } = require('./x');", runs: n, runIds: ids });
  await saveMap(e2e, map);
});

Given('the project has no saved conflict map', async ({ e2e }) => {
  expect(fs.existsSync(mapFile(e2e)), 'the demo workspace has no conflict map of its own').toBe(false);
});

Then('the Conflict map lists {string} first, changed by {int} runs', async ({ e2e }, file, n) => {
  const first = fileRows(e2e.window).first();
  await expect(first).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(first).toContainText(file);
  await expect(first).toContainText(runsRe(n));
});

Then('the Conflict map lists {string}, changed by {int} runs', async ({ e2e }, file, n) => {
  const row = fileRow(e2e.window, file);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row).toContainText(runsRe(n));
});

When('I click {string} in the Conflict map', async ({ e2e }, file) => {
  const row = fileRow(e2e.window, file);
  await row.scrollIntoViewIfNeeded();
  await row.click();
});

// every run id the saved map gives for the file, and none of the map's other runs
Then('the Conflict map shows the {int} runs that changed {string}', async ({ e2e }, n, file) => {
  const map = readMap(e2e);
  const entry = map.files.find((f) => f.file === file);
  expect(entry?.runIds, `the saved map's runs for "${file}"`).toHaveLength(n);
  const runs = panel(e2e.window).getByTestId('conflict-map-runs').filter({ visible: true }).first();
  await expect(runs).toBeVisible();
  for (const id of entry.runIds) await expect(runs).toContainText(id);
  for (const id of map.runIds.filter((x) => !entry.runIds.includes(x))) await expect(runs).not.toContainText(id);
});

Then('the Conflict map lists the line {string}, changed by {int} runs', async ({ e2e }, where, n) => {
  const row = lineRows(e2e.window).filter({ hasText: new RegExp(`${escapeRe(where)}(?!\\d)`) }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row).toContainText(runsRe(n));
});

Then('the Conflict map shows its empty state, with no hot file or line', async ({ e2e }) => {
  const page = e2e.window;
  await expect(panel(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(panel(page).getByTestId('conflict-map-empty')).toBeVisible();
  await expect(fileRows(page)).toHaveCount(0);
  await expect(lineRows(page)).toHaveCount(0);
});
