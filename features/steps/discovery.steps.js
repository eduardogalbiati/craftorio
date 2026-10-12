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
// #166, the clarity score (the bar: 85% by default) and the ready forecast:
//   clarity-badge                            a card's clarity badge on the board ("clarity 72%")
//   clarity-missing                          in the card's panel: the list of missing points, one
//                                            role=listitem per point
//   clarity-scored                           in the card's panel: who scored it, with a <time> whose
//                                            datetime is the score's ISO time
//   clarity-refused                          the message of a move to Ready refused under the bar
//   grill-me                                 a card's "Grill me" button (an interview in its thread)
//   clarity-move-anyway                      a card's "Move anyway" button (the forced override)
//   clarity-override-dialog                  the override's dialog (role=dialog): its reason textbox
//   clarity-override-reason, -confirm        and its confirm button, disabled while the reason is empty
//   clarity-override                         the recorded override, on the card's face and in its
//                                            panel (the panel shows the reason)
//   ready-forecast                           the board's "n nights ready (about h of agent work)"
// A card gets its score and estimate through the app's service (window.api: discovery:create,
// discovery:update with clarity { score, gaps, ts, by } and estimate { minutes }, discovery:move),
// the way the scoring agent will record them.

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

// ---- #166: the clarity score, the bar and the ready forecast ----------------------------------------

const overrideDialog = (page) => page.getByTestId('clarity-override-dialog');

// A card in `colTitle` (not Ready: a move there goes through the bar) with its clarity and estimate,
// recorded through the app's service; the board shows it when Discovery is opened.
async function seedCard(e2e, { title, colTitle, clarity, minutes }) {
  const res = await e2e.window.evaluate(async ({ projectId, title, column, clarity, minutes }) => {
    try {
      const card = await window.api.createDiscoveryCard(projectId, title, `Notes about ${title}`, 'idea');
      const fields = { clarity };
      if (minutes != null) fields.estimate = { minutes };
      await window.api.updateDiscoveryCard(projectId, card.id, fields);
      await window.api.moveDiscoveryCard(projectId, card.id, column);
      return { id: card.id };
    } catch (e) {
      return { thrown: String(e?.message || e) };
    }
  }, { projectId: e2e.project.id, title, column: columnKey(colTitle), clarity, minutes });
  expect(res?.thrown, `the card "${title}" could not be recorded`).toBeFalsy();
}

const scoredNow = (score) => ({ score, gaps: [], ts: new Date().toISOString(), by: 'Product Owner' });

// the card's "Move anyway": the reason is required, then the card goes to Ready
async function moveAnyway(page, title, reason) {
  await boardCard(page, title).getByTestId('clarity-move-anyway').click();
  const dialog = overrideDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('clarity-override-reason').fill(reason);
  await dialog.getByTestId('clarity-override-confirm').click();
  await expect(dialog).toBeHidden();
}

Given('the Discovery card {string} waits in {string}, scored {int}% clear by {string} on {string}, missing:', async ({ e2e }, title, colTitle, score, by, ts, table) => {
  const gaps = table.hashes().map((r) => r.point);
  await seedCard(e2e, { title, colTitle, clarity: { score, gaps, ts, by } });
});

Given('the Discovery card {string} waits in {string}, {int}% clear with about {int} h of work', async ({ e2e }, title, colTitle, score, hours) => {
  await seedCard(e2e, { title, colTitle, clarity: scoredNow(score), minutes: hours * 60 });
});

Given('these Discovery cards wait in {string}:', async ({ e2e }, colTitle, table) => {
  for (const r of table.hashes()) {
    await seedCard(e2e, { title: r.title, colTitle, clarity: scoredNow(Number(r.clarity)), minutes: Number(r.hours) * 60 });
  }
});

Then('the Discovery card {string} shows the clarity {string}', async ({ e2e }, title, text) => {
  await expect(boardCard(e2e.window, title).getByTestId('clarity-badge')).toHaveText(text);
});

When('I open the Discovery card {string}', async ({ e2e }, title) => {
  await boardCard(e2e.window, title).getByTestId('discovery-card-title').click();
  await expect(cardDetail(e2e.window)).toBeVisible();
});

Then('the card\'s panel lists the missing points {string} and {string}', async ({ e2e }, first, second) => {
  const items = cardDetail(e2e.window).getByTestId('clarity-missing').getByRole('listitem');
  await expect(items).toHaveText([first, second]);
});

Then('the card\'s panel says it was scored by {string} on {string}', async ({ e2e }, by, ts) => {
  const scored = cardDetail(e2e.window).getByTestId('clarity-scored');
  await expect(scored).toContainText(by);
  await expect(scored.locator('time')).toHaveAttribute('datetime', ts);
});

Then('the move is refused because the card is below the clarity bar of {int}%', async ({ e2e }, bar) => {
  const msg = e2e.window.getByTestId('clarity-refused');
  await expect(msg).toBeVisible();
  await expect(msg).toContainText(`${bar}%`);
  await expect(msg).toContainText(/clarity/i);
});

Then('the Discovery card {string} offers {string}', async ({ e2e }, title, action) => {
  const button = boardCard(e2e.window, title).getByTestId('grill-me');
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(action);
});

When('I choose to move the Discovery card {string} anyway', async ({ e2e }, title) => {
  const button = boardCard(e2e.window, title).getByTestId('clarity-move-anyway');
  await expect(button).toHaveAccessibleName('Move anyway');
  await button.click();
  await expect(overrideDialog(e2e.window)).toBeVisible();
});

Then('moving it anyway needs a reason', async ({ e2e }) => {
  const dialog = overrideDialog(e2e.window);
  await expect(dialog).toHaveRole('dialog');
  await expect(dialog.getByTestId('clarity-override-reason')).toHaveValue('');
  await expect(dialog.getByTestId('clarity-override-confirm')).toBeDisabled();
});

When('I give the reason {string} and confirm', async ({ e2e }, reason) => {
  const dialog = overrideDialog(e2e.window);
  await dialog.getByTestId('clarity-override-reason').fill(reason);
  await expect(dialog.getByTestId('clarity-override-confirm')).toBeEnabled();
  await dialog.getByTestId('clarity-override-confirm').click();
  await expect(dialog).toBeHidden();
});

When('I move the Discovery card {string} to {string} anyway because {string}', async ({ e2e }, title, target, reason) => {
  const page = e2e.window;
  await moveCard(page, title, target);
  await expect(page.getByTestId('clarity-refused')).toBeVisible();
  await moveAnyway(page, title, reason);
});

Then('the Discovery card {string} shows it was moved anyway because {string}', async ({ e2e }, title, reason) => {
  const page = e2e.window;
  await expect(boardCard(page, title).getByTestId('clarity-override')).toBeVisible();
  await boardCard(page, title).getByTestId('discovery-card-title').click();
  await expect(cardDetail(page).getByTestId('clarity-override')).toContainText(reason);
});

Then('the board shows {string} with {string}, labelled as an estimate', async ({ e2e }, nights, hours) => {
  const forecast = board(e2e.window).getByTestId('ready-forecast');
  await expect(forecast).toContainText(new RegExp(`(^|\\D)${escapeRe(nights)}`));
  await expect(forecast).toContainText(hours);
  await expect(forecast).toContainText(/estimate/i);
});

// ---- #258: commit a clear Ready card to the backlog -----------------------------------------------------
// Assumes these data-testids (the developer adds them):
//   discovery-commit                         in the card's panel: the "Commit to the backlog" button,
//                                            disabled under the clarity bar
//   discovery-commit-dialog                  the commit dialog (role=dialog): the proposed split, one
//   discovery-commit-issue                   row per issue, and its "File the issues" button
//   discovery-committed                      the Committed list beside the board
//   discovery-committed-card                 a card in it, data-card (its id)
//   discovery-delivery                       a committed card's progress line (To do, running,
//                                            merged locally, done)
//   issue-discovery-card                     a backlog issue's badge of its Discovery card (opens the
//                                            card read-only)
// In simulation the split comes from the PO's simulated proposal (its titles are not asserted) and
// the issues are filed into the project's local backlog.

const commitDialog = (page) => page.getByTestId('discovery-commit-dialog');
const committedCard = (page, title) => page.getByTestId('discovery-committed').getByTestId('discovery-committed-card').filter({ hasText: title });
const discoveryBadge = (page, title) => page.getByTestId('backlog-list').getByTestId('issue-discovery-card').filter({ hasText: title });

async function openCommitDialog(page) {
  const button = cardDetail(page).getByTestId('discovery-commit');
  await expect(button).toHaveAccessibleName('Commit to the backlog');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(commitDialog(page)).toBeVisible();
}

async function fileIssues(page, name) {
  const dialog = commitDialog(page);
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

When('I choose {string} in the card\'s panel', async ({ e2e }, action) => {
  const button = cardDetail(e2e.window).getByTestId('discovery-commit');
  await expect(button).toHaveAccessibleName(action);
  await openCommitDialog(e2e.window);
});

Then('the commit dialog lists the proposed issues', async ({ e2e }) => {
  const dialog = commitDialog(e2e.window);
  await expect(dialog).toHaveRole('dialog');
  const issues = dialog.getByTestId('discovery-commit-issue');
  await expect(issues.first()).toBeVisible();
  expect(await issues.count()).toBeGreaterThan(0);
});

When('I confirm the commit with {string}', async ({ e2e }, name) => {
  await fileIssues(e2e.window, name);
});

Then('the Committed list shows the card {string} with its issues\' progress {string}', async ({ e2e }, title, progress) => {
  const card = committedCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-card', /.+/);
  await expect(card.getByTestId('discovery-delivery')).toContainText(progress);
});

Then('the committed card {string} cannot be moved back to the board', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(committedCard(page, title)).toBeVisible();
  await expect(committedCard(page, title).getByTestId('card-move')).toHaveCount(0);
  await expect(boardCard(page, title)).toHaveCount(0);
});

Then('the card\'s panel shows {string} disabled', async ({ e2e }, action) => {
  const button = cardDetail(e2e.window).getByTestId('discovery-commit');
  await expect(button).toHaveAccessibleName(action);
  await expect(button).toBeDisabled();
});

Then('the card\'s panel offers {string}', async ({ e2e }, action) => {
  const button = cardDetail(e2e.window).getByTestId('card-grill-me');
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(action);
});

When('I commit the Discovery card {string} to the backlog', async ({ e2e }, title) => {
  const page = e2e.window;
  await boardCard(page, title).getByTestId('discovery-card-title').click();
  await expect(cardDetail(page)).toBeVisible();
  await openCommitDialog(page);
  await expect(commitDialog(page).getByTestId('discovery-commit-issue').first()).toBeVisible();
  await fileIssues(page, 'File the issues');
  await expect(committedCard(page, title)).toBeVisible();
});

Then('an issue of the list shows the badge of the Discovery card {string}', async ({ e2e }, title) => {
  await expect(discoveryBadge(e2e.window, title).first()).toBeVisible();
});

When('I open the badge of the Discovery card {string}', async ({ e2e }, title) => {
  await discoveryBadge(e2e.window, title).first().click();
});

Then('the Discovery card {string} opens read-only', async ({ e2e }, title) => {
  const detail = cardDetail(e2e.window);
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(title);
  await expect(detail.getByTestId('card-type')).toBeDisabled();
  await expect(detail.getByTestId('discovery-commit')).toHaveCount(0);
  await expect(detail.getByTestId('card-move')).toHaveCount(0);
});

// ---- #259: column automations (on_enter pipelines, mode ask / on / off; ask by default) -------------
// Assumes these data-testids (the developer adds them):
//   discovery-column-automation              a column's automation button (in its discovery-column)
//   discovery-automation-dialog              its settings dialog (role=dialog): the pipeline name and
//   discovery-automation-mode                the mode <select> (values ask, on, off; labels "Ask me",
//                                            "On", "Off"); a change is saved at once, Escape closes it
//   discovery-automation-proposal            after a move into an "ask" column: the proposal dialog
//                                            (role=dialog) with the pipeline name and a cost estimate
//   discovery-automation-run                 its button that starts the (simulated) run; Escape
//                                            dismisses the proposal
//   discovery-card-automation                a card's automation status ("Running" while it runs)

const automationDialog = (page) => page.getByTestId('discovery-automation-dialog');
const automationProposal = (page) => page.getByTestId('discovery-automation-proposal');
const MODE_LABELS = ['Ask me', 'On', 'Off'];

async function openAutomationSettings(page, colTitle) {
  await column(page, colTitle).getByTestId('discovery-column-automation').click();
  const dialog = automationDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveRole('dialog');
}

When('I open the automation settings of the Discovery column {string}', async ({ e2e }, colTitle) => {
  await openAutomationSettings(e2e.window, colTitle);
});

When('I set the automation of the Discovery column {string} to {string}', async ({ e2e }, colTitle, label) => {
  const page = e2e.window;
  await openAutomationSettings(page, colTitle);
  await automationDialog(page).getByTestId('discovery-automation-mode').selectOption({ label });
  await page.keyboard.press('Escape');
  await expect(automationDialog(page)).toBeHidden();
  // the mode is kept: the reopened settings show it
  await openAutomationSettings(page, colTitle);
  const mode = automationDialog(page).getByTestId('discovery-automation-mode');
  await expect(mode.locator('option:checked')).toHaveText(label);
  await page.keyboard.press('Escape');
  await expect(automationDialog(page)).toBeHidden();
});

Then('the automation settings show the pipeline {string} in mode {string}', async ({ e2e }, pipeline, label) => {
  const dialog = automationDialog(e2e.window);
  await expect(dialog).toContainText(pipeline);
  await expect(dialog.getByTestId('discovery-automation-mode').locator('option:checked')).toHaveText(label);
});

Then('the automation mode offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const options = automationDialog(e2e.window).getByTestId('discovery-automation-mode').getByRole('option');
  await expect(options).toHaveText([a, b, c]);
  expect([a, b, c].sort()).toEqual([...MODE_LABELS].sort());
});

Then('the move proposes running {string} on the card, with a cost estimate', async ({ e2e }, pipeline) => {
  const proposal = automationProposal(e2e.window);
  await expect(proposal).toBeVisible();
  await expect(proposal).toHaveRole('dialog');
  await expect(proposal).toContainText(pipeline);
  // the estimate is a cost: a currency amount (simulated runs still estimate)
  await expect(proposal).toContainText(/\$\s?\d/);
  await expect(proposal.getByTestId('discovery-automation-run')).toBeEnabled();
});

When('I run the proposed automation', async ({ e2e }) => {
  const proposal = automationProposal(e2e.window);
  await proposal.getByTestId('discovery-automation-run').click();
  await expect(proposal).toBeHidden();
});

Then('no automation is proposed', async ({ e2e }) => {
  // the proposal dialog stays in the page, hidden; only a shown one has a role in the accessibility tree
  await expect(e2e.window.getByRole('dialog', { name: /^Run the automation/ })).toHaveCount(0);
});

Then('the Discovery card {string} shows its automation {string}', async ({ e2e }, title, status) => {
  await expect(boardCard(e2e.window, title).getByTestId('discovery-card-automation')).toContainText(status);
});

Then('the Discovery card {string} shows no automation', async ({ e2e }, title) => {
  const card = boardCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('discovery-card-automation')).toHaveCount(0);
});
