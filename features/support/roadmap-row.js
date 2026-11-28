// The Roadmap's rows, for the steps of every front that read a roadmap item (the lanes of 2026-11-27,
// fronts/build/views/backlog/backlog-roadmap.js). What the screen exposes:
// - a stage's items are rows (data-testid="roadmap-item") grouped by workflow: the group
//   data-testid="roadmap-workflow" names the workflow once (data-testid="roadmap-workflow-name") and its
//   stations once, over the rows;
// - a row shows its issues, its lane (data-testid="roadmap-pipeline" of "roadmap-station") and its Progress
//   cell (data-testid="roadmap-status": the ring data-testid="roadmap-ring" with data-percent, the cost and
//   time bars);
// - its details are in its open row, data-testid="roadmap-item-panel", in the page but hidden until the row's
//   control data-testid="roadmap-item-toggle" (a button named "Run details", aria-expanded) opens it: the
//   meters, the run chip ("Open run →"), "Show on the map", "Ask the Oracle about this failure", the mode, the
//   ending, the earlier runs, the PR, Edit / ↑ ↓ / Remove. An open row stays open across the screen's redraws.
const { expect } = require('@playwright/test');

/** Opens the row `item` (a roadmap-item locator) when it is closed, and waits for its panel. → `item` */
async function openRow(item, timeout = 30000) {
  const toggle = item.getByTestId('roadmap-item-toggle');
  await expect(toggle).toBeVisible({ timeout });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(item.getByTestId('roadmap-item-panel')).toBeVisible();
  return item;
}

/** The workflow group that holds the roadmap item titled `title`. */
const groupOf = (page, title) => page.getByTestId('roadmap-workflow').filter({ has: page.getByTestId('roadmap-item').filter({ hasText: title }) }).first();

module.exports = { groupOf, openRow };
