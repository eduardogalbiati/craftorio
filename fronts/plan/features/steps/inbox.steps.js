// Steps of fronts/plan/features/inbox.feature (#256): the Inbox screen (Plan & Design > Inbox) on the private
// discovery store. Locators are roles and data-testid only (skills/ui-conventions):
//   inbox-capture-title, inbox-capture-text  the quick capture box's title input and text box;
//                                            Enter in either captures (Shift+Enter: a newline)
//   inbox-list, inbox-card                   the list of Inbox cards (newest first) and each card,
//                                            whose title is its accessible name / text
//   inbox-card-author, inbox-card-age        a card's author and age (e.g. "just now")
//   inbox-card-attachments                   a card's attachment count
//   inbox-empty                              the empty state (no card in the Inbox)
//   inbox-card-detail, card-document-title   the opened card (Esc closes it) and its document's title
//   card-accept, card-merge, card-discard    the opened card's triage actions
//   discard-reason, discard-confirm          the reason box and its confirm button when discarding
// The fresh simulated workspace starts with an empty Inbox.
// #322, importing a backlog document (.md/.txt, picked, dropped or pasted) for the header's project:
//   inbox-import                             the Import button: it opens the import panel (not the
//                                            native file dialog), which holds the file input
//   inbox-import-file                        the panel's <input type="file"> (driven by setInputFiles)
//   inbox-import-preview                     the preview of the items found (nothing written yet)
//   inbox-import-item                        a preview row; its title is in its text
//   inbox-import-criteria                    a row's number of acceptance criteria (its `- [ ]` lines)
//   inbox-import-confirm, inbox-import-cancel  the preview's confirm and cancel buttons
//   inbox-import-message                     why there is nothing to import (empty/unreadable file)
// The imported document is written to the scenario's scratch folder (outside the workspace).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const navItem = (page, name) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}(\\s+\\d+)?$`) });
const inboxCards = (page) => page.getByTestId('inbox-list').getByTestId('inbox-card');
const inboxCard = (page, title) => inboxCards(page).filter({ hasText: title });
const openedCard = (page) => page.getByTestId('inbox-card-detail');

async function capture(page, title, text) {
  await page.getByTestId('inbox-capture-title').fill(title);
  const box = page.getByTestId('inbox-capture-text');
  await box.fill(text);
  await box.press('Enter');
  await expect(inboxCard(page, title)).toHaveCount(1);
}

Given('I captured the idea {string} in the Inbox', async ({ e2e }, title) => {
  await navItem(e2e.window, 'Inbox').click();
  await capture(e2e.window, title, `Notes about ${title}`);
});

When('I capture the idea {string} with the text {string}', async ({ e2e }, title, text) => {
  await capture(e2e.window, title, text);
});

Then('the Inbox shows its empty state', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('inbox-empty')).toBeVisible();
  await expect(inboxCards(e2e.window)).toHaveCount(0);
});

Then('the Inbox does not show its empty state', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('inbox-list')).toBeVisible();
  await expect(e2e.window.getByTestId('inbox-empty')).toHaveCount(0);
});

Then('the Inbox shows the card {string} with its author and age', async ({ e2e }, title) => {
  // newest first: a card just captured (or kept by Esc) is the first of the list
  const card = inboxCards(e2e.window).first();
  await expect(card).toContainText(title);
  await expect(card.getByTestId('inbox-card-author')).not.toHaveText('');
  await expect(card.getByTestId('inbox-card-age')).not.toHaveText('');
  await expect(card.getByTestId('inbox-card-attachments')).toContainText('0');
});

Then('the Inbox does not show the card {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByTestId('inbox-card-detail')).toHaveCount(0);
  await expect(inboxCard(e2e.window, title)).toHaveCount(0);
});

When('I open the Inbox card {string}', async ({ e2e }, title) => {
  await inboxCard(e2e.window, title).click();
  await expect(openedCard(e2e.window)).toBeVisible();
});

Then('the opened card shows its document {string}', async ({ e2e }, title) => {
  await expect(openedCard(e2e.window).getByTestId('card-document-title')).toContainText(title);
});

When('I press Escape', async ({ e2e }) => {
  await e2e.window.keyboard.press('Escape');
});

Then('no Inbox card is open', async ({ e2e }) => {
  await expect(openedCard(e2e.window)).toHaveCount(0);
});

When('I accept the opened card', async ({ e2e }) => {
  await openedCard(e2e.window).getByTestId('card-accept').click();
});

When('I discard the opened card with the reason {string}', async ({ e2e }, reason) => {
  const card = openedCard(e2e.window);
  await card.getByTestId('card-discard').click();
  await e2e.window.getByTestId('discard-reason').fill(reason);
  await e2e.window.getByTestId('discard-confirm').click();
});

// #322: Import a document from the scratch folder through the import panel's file input
const importPreview = (page) => page.getByTestId('inbox-import-preview');
const importItems = (page) => importPreview(page).getByTestId('inbox-import-item');

async function importFile(e2e, name, content) {
  const dir = path.join(e2e.scratch, 'import');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  await e2e.window.getByTestId('inbox-import').click();
  await e2e.window.getByTestId('inbox-import-file').setInputFiles(file);
}

When('I import into the Inbox the file {string} with the content:', async ({ e2e }, name, content) => {
  await importFile(e2e, name, content);
});

When('I import into the Inbox the empty file {string}', async ({ e2e }, name) => {
  await importFile(e2e, name, '');
});

Then('the import preview lists {int} items', async ({ e2e }, n) => {
  await expect(importPreview(e2e.window)).toBeVisible();
  await expect(importItems(e2e.window)).toHaveCount(n);
});

Then('the import preview item {string} shows {int} criteria', async ({ e2e }, title, n) => {
  const item = importItems(e2e.window).filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('inbox-import-criteria')).toContainText(new RegExp(`\\b${n}\\b`));
});

When('I confirm the import', async ({ e2e }) => {
  await importPreview(e2e.window).getByTestId('inbox-import-confirm').click();
});

When('I cancel the import', async ({ e2e }) => {
  await importPreview(e2e.window).getByTestId('inbox-import-cancel').click();
});

Then('the import preview is closed', async ({ e2e }) => {
  await expect(importPreview(e2e.window)).toHaveCount(0);
});

Then('the Inbox shows these cards in this order:', async ({ e2e }, table) => {
  const titles = table.raw().map((row) => row[0].trim());
  const cards = inboxCards(e2e.window);
  for (const title of titles) await expect(cards.filter({ hasText: title })).toHaveCount(1);
  // the imported cards keep the document's order in the list (other cards may sit around them)
  const texts = await cards.allInnerTexts();
  const positions = titles.map((title) => texts.findIndex((text) => text.includes(title)));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

Then('the import says the document is empty', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('inbox-import-message')).toContainText(/empty/i);
});

Then('the import offers no item to create', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('inbox-import-item')).toHaveCount(0);
  // no confirm to press: absent, or present but disabled
  const confirm = page.getByTestId('inbox-import-confirm');
  if (await confirm.count()) await expect(confirm).toBeDisabled();
});
