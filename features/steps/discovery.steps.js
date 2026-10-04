// Steps of features/discovery.feature (#257): the Discovery board (Plan & Design > Discovery) on the
// private discovery store. Cards get onto the board through the Inbox (capture, open, Accept: the
// card lands in Triage). Locators are roles and data-testid only (skills/ui-conventions):
//   discovery-board                          the board
//   discovery-column                         a column, data-column="triage|shape|define|ready";
//                                            data-over-wip="true" when past its WIP limit
//   discovery-column-title, -count           its title and its count ("n / 5" for Shape and Define)
//   discovery-card                           a card, data-card (its id), data-type, data-column (the
//                                            column it is in, also for a fast-lane card)
//   discovery-card-title, -type, -age        a card's title, type chip and age
//   discovery-fast-lane                      the top swimlane with the bug and hotfix cards
//   card-move                                a card's "Move to…" button: a role=menu of
//                                            role=menuitem items named by column title
//   discovery-card-detail, card-type         the opened card's side panel and its type <select>
//                                            (values idea, prd, rfc, bug, hotfix)
//   confirm-modal, #btn-confirm-yes          the app's confirm dialog (index.html) and its confirm
//                                            button (its label depends on the question)
// The fresh simulated workspace starts with an empty discovery store.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const navItem = (page, name) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`) });
const inboxCard = (page, title) => page.getByTestId('inbox-list').getByTestId('inbox-card').filter({ hasText: title });
const board = (page) => page.getByTestId('discovery-board');
const columnKey = (title) => title.toLowerCase();
const column = (page, title) => board(page).locator(`[data-testid="discovery-column"][data-column="${columnKey(title)}"]`);
const columnCard = (page, colTitle, title) => column(page, colTitle).getByTestId('discovery-card').filter({ hasText: title });
const boardCard = (page, title) => board(page).getByTestId('discovery-card').filter({ hasText: title });
const fastLane = (page) => board(page).getByTestId('discovery-fast-lane');
const cardDetail = (page) => page.getByTestId('discovery-card-detail');
const confirmModal = (page) => page.getByTestId('confirm-modal');

// capture an idea in the Inbox, open it and accept it (it leaves the Inbox for Discovery > Triage)
async function acceptIdea(page, title) {
  await navItem(page, 'Inbox').click();
  await page.getByTestId('inbox-capture-title').fill(title);
  const box = page.getByTestId('inbox-capture-text');
  await box.fill(`Notes about ${title}`);
  await box.press('Enter');
  await expect(inboxCard(page, title)).toHaveCount(1);
  await inboxCard(page, title).click();
  const detail = page.getByTestId('inbox-card-detail');
  await expect(detail).toBeVisible();
  await detail.getByTestId('card-accept').click();
  await expect(inboxCard(page, title)).toHaveCount(0);
}

// open a card's "Move to…" menu and pick a column
async function moveCard(page, title, target) {
  const card = boardCard(page, title);
  await expect(card).toHaveCount(1);
  await card.getByTestId('card-move').click();
  await page.getByRole('menuitem', { name: target, exact: true }).click();
}

Given('I accepted the idea {string} in the Inbox', async ({ e2e }, title) => {
  await acceptIdea(e2e.window, title);
});

Given('the Discovery column {string} holds {int} cards and {string} waits in Triage', async ({ e2e }, colTitle, n, extra) => {
  const page = e2e.window;
  const titles = Array.from({ length: n }, (_, i) => `Idea ${i + 1} in ${colTitle}`);
  for (const title of [...titles, extra]) await acceptIdea(page, title);
  await navItem(page, 'Discovery').click();
  await expect(board(page)).toBeVisible();
  // up to the limit: no confirm on the way
  for (const title of titles) {
    await moveCard(page, title, colTitle);
    await expect(columnCard(page, colTitle, title)).toHaveCount(1);
  }
  await expect(confirmModal(page)).toBeHidden();
  await expect(column(page, colTitle).getByTestId('discovery-card')).toHaveCount(n);
  await expect(columnCard(page, 'Triage', extra)).toHaveCount(1);
});

Then('the Discovery column {string} shows the card {string}', async ({ e2e }, colTitle, title) => {
  await expect(column(e2e.window, colTitle).getByTestId('discovery-column-title')).toHaveText(colTitle);
  await expect(columnCard(e2e.window, colTitle, title)).toBeVisible();
});

Then('the Discovery column {string} does not show the card {string}', async ({ e2e }, colTitle, title) => {
  await expect(column(e2e.window, colTitle)).toBeVisible();
  await expect(columnCard(e2e.window, colTitle, title)).toHaveCount(0);
});

Then('the Discovery card {string} shows its title, the type {string} and its age', async ({ e2e }, title, type) => {
  const card = boardCard(e2e.window, title);
  await expect(card).toHaveAttribute('data-type', type);
  await expect(card.getByTestId('discovery-card-title')).toHaveText(title);
  await expect(card.getByTestId('discovery-card-type')).toContainText(type, { ignoreCase: true });
  await expect(card.getByTestId('discovery-card-age')).not.toHaveText('');
});

When('I move the Discovery card {string} to {string}', async ({ e2e }, title, target) => {
  await moveCard(e2e.window, title, target);
});

Then('the Discovery column {string} counts {string}', async ({ e2e }, colTitle, count) => {
  await expect(column(e2e.window, colTitle).getByTestId('discovery-column-count')).toHaveText(count);
});

Then('the move asks to confirm going past the WIP limit of {string}', async ({ e2e }, colTitle) => {
  const dialog = confirmModal(e2e.window);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(colTitle);
  await expect(dialog).toContainText(/limit/i);
});

When('I confirm the move past the WIP limit', async ({ e2e }) => {
  const dialog = confirmModal(e2e.window);
  await dialog.locator('#btn-confirm-yes').click();
  await expect(dialog).toBeHidden();
});

Then('the Discovery column {string} is marked over its WIP limit', async ({ e2e }, colTitle) => {
  await expect(column(e2e.window, colTitle)).toHaveAttribute('data-over-wip', 'true');
});

When('I set the type of the Discovery card {string} to {string}', async ({ e2e }, title, type) => {
  const page = e2e.window;
  await boardCard(page, title).getByTestId('discovery-card-title').click();
  const detail = cardDetail(page);
  await expect(detail).toBeVisible();
  await detail.getByTestId('card-type').selectOption(type);
  await expect(boardCard(page, title)).toHaveAttribute('data-type', type);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

Then('the fast lane shows the card {string} in {string}', async ({ e2e }, title, colTitle) => {
  const card = fastLane(e2e.window).getByTestId('discovery-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-column', columnKey(colTitle));
});
