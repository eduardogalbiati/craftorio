// Steps of fronts/build/features/product-owner.feature's #609 scenarios: the plan answer's split and
// epic proposals (fronts/build/views/backlog/backlog-po-proposals.js). A click on one proposal's action
// marks only that button as working (aria-busy="true", disabled) while its request is in flight; the
// other proposals' buttons stay clickable. While the Product Owner itself answers, every split and epic
// button stays disabled.
// The demo backlog's simulated plan answer ("Build a roadmap") proposes: a split of #15 "Run safety:
// one app per workspace…" (data-testid="po-split-card"), placing #9 in the epic "Run reports" (Place in
// epic) and a new epic "Ui" for #16 and #10 (Create epic). Each epic proposal is a
// data-testid="po-epic-card" (new in #609).
// The simulated requests answer in milliseconds, so a Given holds them: it replaces the main process's
// handler of the channel (po:split, po:epic, po:ask) with one that never answers (e2e.app.evaluate:
// the electron module apps/desktop/host/main.js uses), as scripts/screenshot/channels.js holds po:ask
// for --po working. The hold lasts until the scenario's app closes.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const splitCard = (page, title) => poDrawer(page).getByTestId('po-split-card').filter({ hasText: title }).first();
// the card holds an element whose whole text is the title: a text match on the card would run the
// title into the next element ("UiNew epic", the new epic's title is short: "Ui")
const epicCard = (page, title, action) => poDrawer(page).getByTestId('po-epic-card')
  .filter({ has: page.getByText(title, { exact: true }) })
  .filter({ has: page.getByRole('button', { name: action, exact: true }) })
  .first();
const button = (card, name) => card.getByRole('button', { name, exact: true });

async function holdChannels(e2e, channels) {
  await e2e.app.evaluate(({ ipcMain }, list) => {
    for (const channel of list) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => new Promise(() => {}));
    }
  }, channels);
}

Given("applying the Product Owner's proposals takes a while", async ({ e2e }) => {
  await holdChannels(e2e, ['po:split', 'po:epic']);
});

Given("the Product Owner's next answer takes a while", async ({ e2e }) => {
  await holdChannels(e2e, ['po:ask']);
});

// #26: the Product Owner's turn fails (po:ask rejects, as a provider error would); until the app closes
Given("the Product Owner's answers fail", async ({ e2e }) => {
  await e2e.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('po:ask');
    ipcMain.handle('po:ask', () => { throw new Error('The Product Owner could not answer (E2E: a failed turn).'); });
  });
});

// ---- the proposals' buttons -------------------------------------------------------------------------

const proposals = {
  split: (page, title, action) => button(splitCard(page, title), action),
  epic: (page, title, action) => button(epicCard(page, title, action), action),
  newEpic: (page, title, action) => button(epicCard(page, title, action), action),
};

async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeEnabled();
  await locator.click();
}

async function working(locator) {
  await expect(locator, 'the clicked button shows it is working').toHaveAttribute('aria-busy', 'true');
  await expect(locator, 'the clicked button cannot be clicked again').toBeDisabled();
}

async function clickable(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await expect(locator).not.toHaveAttribute('aria-busy', 'true');
  // actionable: visible, enabled, stable and receiving the click (no overlay), without clicking
  await locator.click({ trial: true });
}

When('I click {string} on the split card of {string}', async ({ e2e }, action, title) => {
  await click(proposals.split(e2e.window, title, action));
});

When("I click {string} on the Product Owner's proposal for the epic {string}", async ({ e2e }, action, title) => {
  await click(proposals.epic(e2e.window, title, action));
});

Then('{string} on the split card of {string} shows it is working and cannot be clicked again', async ({ e2e }, action, title) => {
  await working(proposals.split(e2e.window, title, action));
});

Then('{string} on the proposal for the epic {string} shows it is working and cannot be clicked again', async ({ e2e }, action, title) => {
  await working(proposals.epic(e2e.window, title, action));
});

Then('{string} on the split card of {string} can still be clicked', async ({ e2e }, action, title) => {
  await clickable(proposals.split(e2e.window, title, action));
});

Then('{string} on the proposal for the epic {string} can still be clicked', async ({ e2e }, action, title) => {
  await clickable(proposals.epic(e2e.window, title, action));
});

Then('{string} on the proposal for the new epic {string} can still be clicked', async ({ e2e }, action, title) => {
  await clickable(proposals.newEpic(e2e.window, title, action));
});

// While the Product Owner answers (its working line shown), every button of the split cards and the
// epic proposals is disabled.
Then("every split and epic button of the Product Owner's answer is disabled while it answers", async ({ e2e }) => {
  const page = e2e.window;
  const drawer = poDrawer(page);
  await expect(drawer.getByTestId('po-working'), 'the Product Owner is answering').toBeVisible({ timeout: 30000 });
  const buttons = drawer.getByTestId('po-split-card').getByRole('button')
    .or(drawer.getByTestId('po-epic-card').getByRole('button'));
  await expect(drawer.getByTestId('po-split-card').getByRole('button', { name: 'Split', exact: true }).first()).toBeAttached();
  await expect(drawer.getByTestId('po-epic-card').getByRole('button').first()).toBeAttached();
  const count = await buttons.count();
  expect(count, 'split and epic buttons in the answer').toBeGreaterThan(0);
  for (let n = 0; n < count; n += 1) await expect(buttons.nth(n)).toBeDisabled();
  await expect(drawer.getByTestId('po-working'), 'still answering when checked').toBeVisible();
});
