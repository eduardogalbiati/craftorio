// Steps of fronts/build/features/workflow-runs.feature (#310): Workflows › Runs filtered by workflow. Opening the
// screen and moving between its tabs reuse app.steps.js ("I open {string} in the sidebar").
// Locators are roles and data-testid only (skills/ui-conventions):
//   runs-workflow-filter   the workflow filter beside the status chips: a <select> whose options read
//                          "<workflow name> (<run count>)" (the workflows that have runs) and
//                          "All workflows" (no filter)
//   run-list-row           one run of the list (data-run: the run id); its text names its workflow
// The status chips (All, Running, Success, Failed) are buttons named "<label> <count>", the active
// one with the class `active` (run-list.js RUN_FILTERS).
// A workflow is named in the steps as people read it ("AI development local hero"): it matches the
// workflow's display name, its slug or its file name whatever the case and the separators.

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "AI development local hero" → matches "AI Development (local hero)", "ai-development-local-hero"…
const workflowRe = (name, { whole = false } = {}) => {
  const words = String(name).trim().split(/[\s_\-()]+/).filter(Boolean).map(escapeRe).join('[\\s_\\-()]+');
  return whole ? new RegExp(`^\\(?${words}\\)?(\\.ya?ml)?$`, 'i') : new RegExp(`(^|[^a-z0-9])${words}($|[^a-z0-9])`, 'i');
};
// an option's label without its run count: "AI development local hero (4)" → "AI development local hero"
const withoutCount = (label) => String(label).replace(/\s*\(\d+\)\s*$/, '').trim();
const countOf = (label) => Number((String(label).match(/\((\d+)\)\s*$/) || [])[1]);

const workflowFilter = (page) => page.getByTestId('runs-workflow-filter').filter({ visible: true }).first();
const runRows = (page) => page.getByTestId('run-list-row').filter({ visible: true });
const runRow = (page, fragment) => page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true });
const statusChip = (page, name) => page.getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`) }).filter({ visible: true }).first();

// the filter's options as { label, value }, once the workflows with runs are listed
async function filterOptions(page) {
  const select = workflowFilter(page);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => select.locator('option').count(), { timeout: LOAD_TIMEOUT }).toBeGreaterThan(1);
  return select.locator('option').evaluateAll((els) => els.map((o) => ({ label: o.textContent.trim(), value: o.value })));
}

async function optionOf(page, name) {
  const options = await filterOptions(page);
  const found = options.find((o) => workflowRe(name, { whole: true }).test(withoutCount(o.label)));
  expect(found, `the workflow filter offers "${name}" among: ${options.map((o) => o.label).join(' | ')}`).toBeTruthy();
  return found;
}

// the visible rows, once the list has some
async function listedRows(page) {
  await expect(runRows(page).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  return runRows(page);
}

When('I filter the runs by the workflow {string}', async ({ e2e }, name) => {
  const option = await optionOf(e2e.window, name);
  await workflowFilter(e2e.window).selectOption({ value: option.value });
});

When('I show the runs of all workflows', async ({ e2e }) => {
  const options = await filterOptions(e2e.window);
  const all = options.find((o) => /^All workflows\b/.test(o.label));
  expect(all, `the workflow filter offers "All workflows" among: ${options.map((o) => o.label).join(' | ')}`).toBeTruthy();
  await workflowFilter(e2e.window).selectOption({ value: all.value });
});

When('I click the {string} status chip of the runs', async ({ e2e }, name) => {
  const chip = statusChip(e2e.window, name);
  await chip.click();
  await expect(chip).toHaveClass(/\bactive\b/);
});

Then('the runs are still filtered by the workflow {string}', async ({ e2e }, name) => {
  const select = workflowFilter(e2e.window);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(async () => withoutCount(await select.evaluate((el) => el.selectedOptions[0]?.textContent.trim() || '')))
    .toMatch(workflowRe(name, { whole: true }));
});

// every row the list shows names that workflow (and no row of another workflow is left)
Then('every run row shows the workflow {string}', async ({ e2e }, name) => {
  const rows = await listedRows(e2e.window);
  const re = workflowRe(name);
  await expect.poll(async () => (await rows.evaluateAll((els) => els.map((el) => `${el.dataset.run}: ${el.innerText.replace(/\s+/g, ' ')}`)))
    .filter((text) => !re.test(text)), { timeout: LOAD_TIMEOUT, message: `rows not of the workflow "${name}"` }).toEqual([]);
});

Then('the run list shows the run {string}', async ({ e2e }, fragment) => {
  await expect(runRow(e2e.window, fragment).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the run list does not show the run {string}', async ({ e2e }, fragment) => {
  await listedRows(e2e.window);
  await expect(runRow(e2e.window, fragment)).toHaveCount(0);
});

// the chip's count is of the runs the list shows (the list holds fewer than a page: no "Loading more…")
Then('the {string} status chip counts the runs listed', async ({ e2e }, name) => {
  const page = e2e.window;
  const rows = await listedRows(page);
  const chip = statusChip(page, name);
  await expect.poll(async () => {
    const shown = Number(((await chip.innerText()).match(/(\d+)\s*$/) || [])[1]);
    return shown === await rows.count() ? 'same' : `chip ${shown}, rows ${await rows.count()}`;
  }, { timeout: LOAD_TIMEOUT }).toBe('same');
});

// the "(n)" of the workflow's option is the number of rows listed under the "All" chip
Then('the workflow filter counts as many runs for {string} as the list shows', async ({ e2e }, name) => {
  const page = e2e.window;
  const rows = await listedRows(page);
  await expect.poll(async () => {
    const count = countOf((await optionOf(page, name)).label);
    return count === await rows.count() ? 'same' : `option ${count}, rows ${await rows.count()}`;
  }, { timeout: LOAD_TIMEOUT }).toBe('same');
});
