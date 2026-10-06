// Steps of features/inbox.feature (#256): the Inbox screen (Plan & Design > Inbox) on the private
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

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

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
