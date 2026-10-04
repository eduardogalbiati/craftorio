// Steps of features/releases.feature (#260): a cut line drawn on the Roadmap between two stages
// ("Release here", a name), the Releases screen (Code & Build › Releases: the shipped releases and
// the next one, its notes editable before Ship), the release run's human-only Ship gate (Ship or
// Hold). Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stages = (page) => page.getByTestId('roadmap-stage');
const cutLines = (page) => page.getByTestId('roadmap-cut-line');
const sidebar = (page) => page.getByRole('navigation');
const navItem = (page, name) => sidebar(page).getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`) });
const nextRelease = (page) => page.getByTestId('release-next');

// ---- the Roadmap's cut line ---------------------------------------------------------------------

// stage n (1-based) as shown, top to bottom
When('I draw a cut line {string} after stage {int}', async ({ e2e }, name, n) => {
  const page = e2e.window;
  const stage = stages(page).nth(n - 1);
  await expect(stage, `the roadmap's stage ${n}`).toBeVisible();
  await stage.getByRole('button', { name: 'Release here', exact: true }).first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Release name' }) });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Release name' }).fill(name);
  await dialog.getByRole('button', { name: 'Add cut line', exact: true }).click();
  await expect(dialog).toBeHidden();
});

// the cut line comes after stage n and before stage n + 1 in the page (document order)
Then('the roadmap shows a cut line {string} between stage {int} and stage {int}', async ({ e2e }, name, a, b) => {
  const page = e2e.window;
  const line = cutLines(page).filter({ hasText: name });
  await expect(line).toHaveCount(1);
  await expect(line).toBeVisible();
  await expect(line).toContainText('Release here');
  const handle = await line.elementHandle();
  const before = await stages(page).nth(a - 1).elementHandle();
  const after = await stages(page).nth(b - 1).elementHandle();
  const order = await page.evaluate(([l, x, y]) => ({
    afterFirst: !!(x.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING),
    beforeSecond: !!(l.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING),
  }), [handle, before, after]);
  expect(order.afterFirst, `the cut line "${name}" comes after stage ${a}`).toBe(true);
  expect(order.beforeSecond, `the cut line "${name}" comes before stage ${b}`).toBe(true);
});

// ---- the Releases screen ------------------------------------------------------------------------

// Assumption (the developer persists the release history): one file per project,
// <workspace>/releases/<projectId>.json = { releases: [{ version, date, issues: [{ number, title }],
// runs: [runId], cost (USD), tests: { unit: { passed, failed }, e2e: { passed, failed } }, notes,
// status: 'shipped' }] }. Written into the scratch workspace, then the app reloads to read it.
Given('the project shipped the release {string} with the issue {string}', async ({ e2e }, version, title) => {
  const dir = path.join(e2e.scratch, 'workspace', 'releases');
  fs.mkdirSync(dir, { recursive: true });
  const release = {
    version, date: '2026-01-10T18:00:00.000Z', issues: [{ number: 12, title }], runs: ['20260110-170000-rel00260'],
    cost: 1.84, tests: { unit: { passed: 412, failed: 0 }, e2e: { passed: 37, failed: 0 } },
    notes: `${version}: first release.`, status: 'shipped',
  };
  fs.writeFileSync(path.join(dir, `${e2e.project.id}.json`), JSON.stringify({ releases: [release] }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('{string} comes right after {string} in the sidebar', async ({ e2e }, name, previous) => {
  const page = e2e.window;
  const labels = [];
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    labels.push((await button.innerText()).replace(/\s+\d+$/, '').trim());
  }
  const at = labels.indexOf(previous);
  expect(at, `"${previous}" in the sidebar (${labels.join(', ')})`).toBeGreaterThanOrEqual(0);
  expect(labels[at + 1], `the entry after "${previous}"`).toBe(name);
  await expect(navItem(page, name)).toBeVisible();
});

Then('the Releases list shows the release {string} with its issues, cost and test results', async ({ e2e }, version) => {
  const row = e2e.window.getByTestId('release-row').filter({ hasText: version });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row).toContainText('#12');
  await expect(row).toContainText(/\$\s?1\.84/);
  await expect(row).toContainText(/unit/i);
  await expect(row).toContainText(/e2e/i);
  await expect(row).toContainText('412');
});

Then('the next release lists the issue {string}', async ({ e2e }, title) => {
  await expect(nextRelease(e2e.window)).toContainText(title);
});

// blurs the field so the notes are saved
When('I write {string} in the next release\'s notes', async ({ e2e }, text) => {
  const notes = nextRelease(e2e.window).locator('textarea[data-testid="release-notes"]');
  await expect(notes).toBeEditable();
  await notes.fill(text);
  await notes.blur();
});

Then('the next release\'s notes read {string}', async ({ e2e }, text) => {
  await expect(nextRelease(e2e.window).locator('textarea[data-testid="release-notes"]')).toHaveValue(text);
});

// ---- the release run's Ship gate ----------------------------------------------------------------

// The Start panel's workflow select (labelled "Workflow"), picked by file; the workflow's display
// name is "Release". The release workflow may have no main text input: filled only when shown.
When('I start a simulated run of the workflow {string}', async ({ e2e }, file) => {
  const page = e2e.window;
  if (!(await page.getByTestId('start-workflow').isVisible())) await page.getByTestId('quick-start').click();
  const select = page.getByRole('combobox', { name: 'Workflow', exact: true });
  await select.selectOption(file);
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toMatch(/^Release\b/);
  const main = page.getByTestId('start-main-input');
  if (await main.isVisible()) await main.fill('Release v1.0');
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

Then('the gate card offers {string} and {string}', async ({ e2e }, a, b) => {
  const card = e2e.window.getByTestId('run-gate').first();
  for (const name of [a, b]) await expect(card.getByTestId('run-gate-choice').filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) })).toBeEnabled();
});
