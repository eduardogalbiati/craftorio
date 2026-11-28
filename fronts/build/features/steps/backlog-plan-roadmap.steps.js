// Steps of fronts/build/features/backlog-plan-roadmap-605.feature (#605, #446): the Backlog's plain
// queue is retired. The Assign dialog adds its issues to the roadmap as one item in a new stage at the
// end, with a "Run now" choice that starts only that stage (nothing is queued); the Backlog has no
// queue bar, no "Queue" alert, and the Roadmap no "Move into the roadmap".
// Reuses backlog-archive.steps.js (added issues, the Board's list, selecting rows), backlog.steps.js
// (Open the Roadmap, the roadmap bar) and roadmap-stage-menu.steps.js (scroll to stage n).
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps):
// - the Board's selection bar: the button "Assign workflow… (n)" (exists).
// - the Assign dialog: data-testid="assign-modal" (NEW: today only the element id is assign-modal),
//   inside it a checkbox (or switch) named "Run now", unticked when the dialog opens (NEW), and the
//   button "Add to roadmap" (exists) that adds the dialog's issues as ONE item in a new last stage and,
//   with "Run now" ticked, starts that stage only; then the Roadmap screen is shown (as today).
// - data-testid="roadmap-stage" (exists), titled "Stage N"; data-testid="roadmap-item" (exists) with
//   data-status; data-testid="run-chip" (exists) on an item once a run started for it.
// - the plain queue's bar data-testid="queue-bar" and the alerts data-testid="page-alert" (exist).

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');
const workflows = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;

const assignDialog = (page) => page.getByTestId('assign-modal');
const runNow = (page) => {
  const dialog = assignDialog(page);
  return dialog.getByRole('checkbox', { name: 'Run now', exact: true }).or(dialog.getByRole('switch', { name: 'Run now', exact: true })).first();
};
const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();

// ---- the Assign dialog -----------------------------------------------------------------------------

When('I open the Assign dialog for the selected issues', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('button', { name: /^Assign workflow/ }).click();
  await expect(assignDialog(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the Assign dialog offers {string}, unticked', async ({ e2e }, name) => {
  expect(name, 'the only choice of this step').toBe('Run now');
  await expect(runNow(e2e.window)).toBeVisible();
  await expect(runNow(e2e.window)).not.toBeChecked();
});

When('I tick {string} in the Assign dialog', async ({ e2e }, name) => {
  expect(name, 'the only choice of this step').toBe('Run now');
  await runNow(e2e.window).check();
  await expect(runNow(e2e.window)).toBeChecked();
});

When('I add the issues to the roadmap from the Assign dialog', async ({ e2e }) => {
  const page = e2e.window;
  const add = assignDialog(page).getByRole('button', { name: 'Add to roadmap', exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(assignDialog(page)).toBeHidden({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('roadmap-stage').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// #29: the chosen workflow, by its display title (the select labelled "Workflow", exists)
Then('the Assign dialog has the {string} workflow chosen', async ({ e2e }, title) => {
  const select = assignDialog(e2e.window).getByRole('combobox', { name: 'Workflow', exact: true });
  await expect(select).toHaveValue(workflows.fileOf(title), { timeout: LOAD_TIMEOUT });
});

// #29: the one-line description under the workflow select: data-testid="assign-wf-desc" (NEW: today only
// the element id is assign-wf-desc); it says something, and not the given words
Then("the Assign dialog's workflow description does not say {string}", async ({ e2e }, words) => {
  const desc = assignDialog(e2e.window).getByTestId('assign-wf-desc');
  await expect(desc).toHaveText(/\S/, { timeout: LOAD_TIMEOUT });
  await expect(desc).not.toContainText(words, { ignoreCase: true });
});

// #40: a workflow waiting for the owner's acceptance is marked in the Assign dialog (NEW: an element
// data-testid="assign-workflow-awaiting-acceptance" naming the workflow and saying it awaits acceptance, on its
// option of the "Workflow" select or next to it) and is never the one the dialog opens on
Then('the Assign dialog marks the workflow {string} as awaiting acceptance', async ({ e2e }, name) => {
  const marker = assignDialog(e2e.window).getByTestId('assign-workflow-awaiting-acceptance').filter({ hasText: name }).first();
  await expect(marker).toBeAttached({ timeout: LOAD_TIMEOUT });
  await expect(marker).toContainText(/accept/i);
});

Then('the Assign dialog does not have the workflow {string} chosen', async ({ e2e }, name) => {
  const select = assignDialog(e2e.window).getByRole('combobox', { name: 'Workflow', exact: true });
  await expect(select).toHaveValue(/\S/, { timeout: LOAD_TIMEOUT });
  await expect(select).not.toHaveValue(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ---- the new last stage ----------------------------------------------------------------------------

Then('stage {int} is the last stage of the roadmap, with one item holding {string} and {string}', async ({ e2e }, n, a, b) => {
  const page = e2e.window;
  const target = stage(page, n);
  await expect(target).toBeAttached({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('roadmap-stage').last()).toContainText(new RegExp(`\\bStage ${n}\\b`));
  await expect(stage(page, n + 1)).toHaveCount(0);
  const items = target.getByTestId('roadmap-item');
  await expect(items).toHaveCount(1);
  // one locator for the item holding both: the roadmap redraws as the stage starts, so an element read
  // between two checks may already be replaced
  await expect(items.filter({ hasText: a }).filter({ hasText: b })).toHaveCount(1);
});

Then('stage {int} of the roadmap has started', async ({ e2e }, n) => {
  const item = stage(e2e.window, n).getByTestId('roadmap-item').first();
  // its run chip is in its open row (hidden while the row is closed): the row has it once a run started
  await expect(item.getByTestId('run-chip')).toHaveAttribute('data-run', /\S/, { timeout: LOAD_TIMEOUT });
  await expect(item).not.toHaveAttribute('data-status', 'planned');
});

Then('nothing in stage {int} of the roadmap has started', async ({ e2e }, n) => {
  const items = stage(e2e.window, n).getByTestId('roadmap-item');
  await expect(items.first()).toBeAttached({ timeout: LOAD_TIMEOUT });
  const count = await items.count();
  for (let k = 0; k < count; k += 1) {
    await expect(items.nth(k)).toHaveAttribute('data-status', 'planned');
    await expect(items.nth(k).getByTestId('run-chip')).toHaveCount(0);
  }
});

// ---- no plain queue anywhere -----------------------------------------------------------------------

// the queue's own alert was titled "Queue" (#422); every alert is walked through once
Then('the Backlog shows no Queue alert', async ({ e2e }) => {
  const page = e2e.window;
  const alerts = page.getByTestId('page-alerts').filter({ visible: true }).first();
  const shown = () => alerts.getByTestId('page-alert').filter({ visible: true }).first();
  const queueAlert = /^\s*Queue\b/;
  await expect(page.getByTestId('page-alert').filter({ hasText: queueAlert }).filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  const counter = alerts.getByTestId('alerts-counter');
  if (await counter.count()) {
    const total = Number((await counter.innerText()).trim().split('/')[1]) || 1;
    for (let k = 0; k < total; k += 1) {
      await expect(shown()).not.toHaveText(queueAlert);
      await alerts.getByRole('button', { name: 'Next alert', exact: true }).click();
    }
  }
});

Then('the screen offers no {string} button', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-stage').or(page.getByTestId('backlog-list')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('button', { name, exact: true }).filter({ visible: true })).toHaveCount(0);
});
