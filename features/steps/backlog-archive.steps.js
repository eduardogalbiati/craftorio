// Steps of features/backlog.feature's Archive scenarios (#238): archiving issues from the Backlog's
// selection bar (closed as not planned, labelled `archived`), the Archived state chip, Restore, and
// the guard of an issue planned in the roadmap. The demo backlog (scripts/screenshot.js) gets extra
// issues written to the scratch workspace before the Backlog opens (it reads the file when shown).
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// ---- the demo backlog with added issues -------------------------------------------------------------

const backlogFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.json`);
function addIssues(e2e, specs) {
  const file = backlogFile(e2e);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  // the demo's plain issue (#10: no epic, no body) as the model of the added ones
  const model = data.issues.find((i) => i.number === 10);
  expect(model, "the demo backlog's issue #10").toBeTruthy();
  let next = Math.max(...data.issues.map((i) => i.number)) + 1;
  const plain = { ...model };
  delete plain.epic;
  delete plain.isEpic;
  const added = specs.map(({ title, state = 'open', labels = [] }) => {
    const number = next++;
    return { ...plain, number, title, state, labels, url: model.url.replace(/\d+$/, String(number)), updatedAt: new Date().toISOString() };
  });
  data.issues = [...added, ...data.issues];
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return added;
}

// #17 and #18 (the demo's issues end at #16)
Given('the backlog has the open issues {string} and {string}', async ({ e2e }, a, b) => {
  addIssues(e2e, [{ title: a }, { title: b }]);
});

Given('the backlog has the archived issue {string}', async ({ e2e }, title) => {
  addIssues(e2e, [{ title, state: 'closed', labels: [{ name: 'archived', color: '#ededed' }] }]);
});

// ---- the Board's list, its state chips and its rows ---------------------------------------------------

const list = (page) => page.getByTestId('backlog-list');
const issueRow = (page, title) => list(page).getByTestId('backlog-issue').filter({ hasText: title }).first();
const stateChip = (page, name) => page.getByTestId(`backlog-state-${name.toLowerCase()}`);

When('I open the Board as a list', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'List', exact: true }).click();
  await expect(list(page)).toBeVisible();
});

When('I select the issue {string}', async ({ e2e }, title) => {
  await issueRow(e2e.window, title).getByRole('checkbox', { name: /^Select #\d+$/ }).check();
});

When('I click {string} in the selection bar', async ({ e2e }, name) => {
  const button = e2e.window.getByTestId('backlog-archive-selection');
  await expect(button).toHaveText(name);
  await expect(button).toBeEnabled();
  await button.click();
});

When('I show the {string} issues', async ({ e2e }, name) => {
  const chip = stateChip(e2e.window, name);
  await chip.click();
  await expect(chip).toHaveClass(/\bactive\b/);
});

Then('the list shows the issue {string}', async ({ e2e }, title) => {
  await expect(issueRow(e2e.window, title)).toBeVisible();
});

// matched by the row's title, not its whole text: a member issue's epic badge carries the epic's title (#253)
Then('the list does not show the issue {string}', async ({ e2e }, title) => {
  await expect(list(e2e.window).getByTestId('backlog-issue').locator('.bl-title').getByText(title, { exact: true })).toHaveCount(0);
});

// "at once": the Open chip still active, the issues gone without a reload or a filter change
Then('the Open view does not show {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(stateChip(page, 'Open')).toHaveClass(/\bactive\b/);
  await expect(list(page).getByTestId('backlog-issue').filter({ hasText: title })).toHaveCount(0);
});

// ---- the archive confirm -----------------------------------------------------------------------------

const confirmModal = (page) => page.getByTestId('confirm-modal');

Then('the archive confirm names {string} and {string}, closed as not planned on GitHub and labelled archived', async ({ e2e }, a, b) => {
  const dialog = confirmModal(e2e.window);
  await expect(dialog).toBeVisible();
  for (const n of [a, b]) await expect(dialog).toContainText(n);
  await expect(dialog).toContainText(/not planned on GitHub/);
  await expect(dialog).toContainText(/label(led|s)? (them|it) archived/);
});

When('I confirm the archive', async ({ e2e }) => {
  const dialog = confirmModal(e2e.window);
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog).toBeHidden();
});

// ---- Restore -----------------------------------------------------------------------------------------

When('I restore the issue {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await issueRow(page, title).getByRole('button', { name: 'Restore', exact: true }).click();
  // a confirm, if Restore asks one (it reopens the issue on the platform): wait for it or for the row to go
  const dialog = confirmModal(page);
  const rows = list(page).getByTestId('backlog-issue').filter({ hasText: title });
  await expect.poll(async () => (await dialog.isVisible()) || (await rows.count()) === 0).toBe(true);
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

// ---- the guard: an issue planned in the roadmap ------------------------------------------------------

const issueMenu = (page) => page.getByRole('menu', { name: /^Actions for #\d+$/ }).filter({ visible: true }).first();

When('I open the menu of the issue {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await issueRow(page, title).getByTestId('backlog-issue-menu').click();
  await expect(issueMenu(page)).toBeVisible();
});

// the reason shows in the menu, next to the disabled action (a tooltip alone is not enough)
Then('its Archive action is disabled with the reason {string}', async ({ e2e }, reason) => {
  const menu = issueMenu(e2e.window);
  await expect(menu.getByRole('menuitem', { name: /^Archive\b/ })).toBeDisabled();
  await expect(menu).toContainText(reason);
});
