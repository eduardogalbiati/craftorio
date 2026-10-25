// Steps of fronts/analyser/features/refactor.feature (#357) and of projects.feature's Refactor tab without an
// Architecture report: a project's Refactor tab, its proposals (the Architecture findings sent to
// Refactor, architecture.steps.js), the Product Owner's prioritization (rank, one-line reason,
// complexity 1-5; the simulated answer in simulation), "Dismiss" with a reason and the "Dismissed"
// filter, and the cadence switch "Add a refactor to the roadmap every X runs" with its "next in N
// runs" counter. Locators are roles and data-testid only (skills/ui-conventions).
//
// What the tab exposes (the renderer's contract for these steps, fronts/analyser/views/project/):
// - #project-panel-refactor holds the tab; data-testid="refactor-state-no-report" (a link or button
//   naming the Architecture tab opens it), "refactor-state-empty", "refactor-prioritizing" (gone once
//   the Product Owner answered), "refactor-state-error";
// - data-testid="refactor-prioritize": the "Ask the Product Owner to prioritize" button;
// - data-testid="refactor-proposal": one row per open proposal (its title in its text), sorted by
//   rank once prioritized, with "refactor-proposal-rank" (the rank, a whole number),
//   "refactor-proposal-reason", "refactor-proposal-complexity" (1 to 5), "refactor-dismiss";
// - dismissing asks a reason: "refactor-dismiss-reason" (text input), "refactor-dismiss-confirm";
// - data-testid="refactor-filter-dismissed": the "Dismissed" filter; a dismissed row shows
//   "refactor-proposal-dismiss-reason";
// - data-testid="refactor-cadence-toggle": a checkbox (or role="switch") named "Add a refactor to the
//   roadmap every X runs", off by default; "refactor-cadence-every": its number input;
//   "refactor-cadence-next": "next in N runs"; "refactor-nothing-ready": "Nothing ready to add:
//   prioritize or file a proposal".

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const PRIORITY_TIMEOUT = 60000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const tab = (page) => projectPage(page).locator('#project-panel-refactor');
const byId = (page, id) => visible(tab(page).getByTestId(id)).first();
const proposals = (page) => visible(tab(page).getByTestId('refactor-proposal'));
const proposalRow = (page, title) => proposals(page).filter({ hasText: title }).first();

Then('the Refactor tab says the project has no Architecture report yet', async ({ e2e }) => {
  const state = byId(e2e.window, 'refactor-state-no-report');
  await expect(state).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(state).toContainText(/architecture/i);
  await expect(visible(tab(e2e.window).getByTestId('refactor-proposal')), 'no proposal without a report').toHaveCount(0);
});

When('I open the Architecture tab from the Refactor tab', async ({ e2e }) => {
  const state = byId(e2e.window, 'refactor-state-no-report');
  const name = /architecture/i;
  const go = state.getByRole('link', { name }).or(state.getByRole('button', { name })).first();
  await expect(go).toBeVisible({ timeout: LOAD_TIMEOUT });
  await go.click();
});

Then('the Refactor tab lists {int} proposals', async ({ e2e }, count) => {
  await expect(proposals(e2e.window)).toHaveCount(count, { timeout: LOAD_TIMEOUT });
});

When('I ask the Product Owner to prioritize the refactor proposals', async ({ e2e }) => {
  const button = byId(e2e.window, 'refactor-prioritize');
  await expect(button).toHaveRole('button');
  await expect(button).toHaveAccessibleName(/ask the product owner to prioritize/i);
  await button.click();
  await expect(visible(tab(e2e.window).getByTestId('refactor-prioritizing')), 'the Product Owner answered').toHaveCount(0, { timeout: PRIORITY_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('refactor-state-error')), 'no prioritization error').toHaveCount(0);
});

Then('the Refactor tab lists {int} proposals ranked {int} to {int}, each with a reason and a complexity from {int} to {int}', async ({ e2e }, count, first, last, low, high) => {
  const rows = proposals(e2e.window);
  await expect(rows).toHaveCount(count, { timeout: LOAD_TIMEOUT });
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const rank = first + i;
    await expect(row.getByTestId('refactor-proposal-rank'), `row ${i + 1} is ranked ${rank}`).toHaveText(new RegExp(`(^|\\D)${rank}(\\D|$)`), { timeout: PRIORITY_TIMEOUT });
    await expect(row.getByTestId('refactor-proposal-reason'), `row ${i + 1} has a reason`).toHaveText(/\w{3,}/);
    const complexity = `[${low}-${high}]`;
    await expect(row.getByTestId('refactor-proposal-complexity'), `row ${i + 1} has a complexity from ${low} to ${high}`).toHaveText(new RegExp(`(^|\\D)${complexity}(\\D|$)`));
  }
  await expect(rows.nth(count - 1).getByTestId('refactor-proposal-rank'), `the last row is ranked ${last}`).toHaveText(new RegExp(`(^|\\D)${last}(\\D|$)`));
});

When('I dismiss the refactor proposal {string} with the reason {string}', async ({ e2e }, title, reason) => {
  const page = e2e.window;
  const row = proposalRow(page, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const dismiss = row.getByTestId('refactor-dismiss');
  await expect(dismiss).toHaveAccessibleName(/dismiss/i);
  await dismiss.click();
  // the reason box opens in the row or in a dialog of the tab
  const input = visible(page.getByTestId('refactor-dismiss-reason')).first();
  await expect(input).toBeVisible({ timeout: LOAD_TIMEOUT });
  await input.fill(reason);
  await visible(page.getByTestId('refactor-dismiss-confirm')).first().click();
});

Then('the Refactor tab does not list the proposal {string}', async ({ e2e }, title) => {
  await expect(proposals(e2e.window).filter({ hasText: title })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

When('I show the dismissed refactor proposals', async ({ e2e }) => {
  const filter = byId(e2e.window, 'refactor-filter-dismissed');
  await expect(filter).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(filter).toContainText(/dismissed/i);
  await filter.click();
});

Then('the dismissed proposal {string} shows the reason {string}', async ({ e2e }, title, reason) => {
  const row = proposalRow(e2e.window, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('refactor-proposal-dismiss-reason')).toContainText(reason);
});

Then('the refactor cadence is off', async ({ e2e }) => {
  const toggle = byId(e2e.window, 'refactor-cadence-toggle');
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(toggle).toHaveAccessibleName(/add a refactor to the roadmap every/i);
  await expect(toggle).not.toBeChecked();
});

When('I turn on the refactor cadence every {int} runs', async ({ e2e }, every) => {
  const toggle = byId(e2e.window, 'refactor-cadence-toggle');
  await toggle.check();
  await expect(toggle).toBeChecked({ timeout: LOAD_TIMEOUT });
  const input = byId(e2e.window, 'refactor-cadence-every');
  await expect(input).toBeEditable({ timeout: LOAD_TIMEOUT });
  await input.fill(String(every));
  await input.press('Tab');
  await expect(input).toHaveValue(String(every));
});

Then('the refactor cadence says {string}', async ({ e2e }, text) => {
  await expect(byId(e2e.window, 'refactor-cadence-next')).toContainText(new RegExp(escapeRe(text), 'i'), { timeout: LOAD_TIMEOUT });
});

Then('the Refactor tab says nothing is ready to add', async ({ e2e }) => {
  await expect(byId(e2e.window, 'refactor-nothing-ready')).toContainText('Nothing ready to add: prioritize or file a proposal', { timeout: LOAD_TIMEOUT });
});
