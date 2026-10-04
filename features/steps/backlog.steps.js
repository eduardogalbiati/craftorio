// Steps of features/backlog.feature and features/visual.feature (#222): the Backlog's Board (list,
// kanban) and Roadmap on the demo project, and their visual baselines; the Roadmap's progress ring
// popover (#236), its Resume confirm (#243) and a finished stage scope (#237), and
// features/product-owner.feature's Product Owner drawer (#234, #235); epics kept off the Board and
// listed on the Epics view (#253); the Roadmap opened from the menu (#254); the alerts at the top of
// the Board and the Roadmap (#270). Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const board = (page) => page.getByTestId('backlog-board');

When('I open the Board as a kanban', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(board(page)).toBeVisible();
});

// #254: the Roadmap is its own screen (Code & Build › Roadmap), no longer a Backlog tab
When('I open the Roadmap', async ({ e2e }) => {
  await e2e.window.getByRole('navigation').getByRole('button', { name: /^Roadmap(\s+\d+)?$/ }).click();
  await expect(e2e.window.getByTestId('roadmap-stage').first()).toBeVisible();
});

Then('the board shows the column {string}', async ({ e2e }, name) => {
  await expect(board(e2e.window).getByRole('heading', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
});

Then('the board shows the issue {string}', async ({ e2e }, title) => {
  await expect(board(e2e.window).getByRole('link', { name: title, exact: true })).toBeVisible();
});

Then('the board shows the label {string}', async ({ e2e }, label) => {
  await expect(board(e2e.window).getByText(label, { exact: true }).first()).toBeVisible();
});

Then('the roadmap shows at least {int} stages', async ({ e2e }, n) => {
  const stages = e2e.window.getByTestId('roadmap-stage');
  await expect(stages.first()).toBeVisible();
  expect(await stages.count()).toBeGreaterThanOrEqual(n);
});

Then('the roadmap shows the item {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByTestId('roadmap-item').filter({ hasText: title }).first()).toBeVisible();
});

// the demo roadmap's item whose start was refused (#196)
const refused = (page) => page.getByTestId('roadmap-item').filter({ has: page.getByRole('button', { name: 'Retry', exact: true }) }).first();

Then('a refused item offers Retry and Skip, enabled', async ({ e2e }) => {
  const item = refused(e2e.window);
  await expect(item.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(item.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
});

Then('the roadmap bar says why the start was refused and offers {string}', async ({ e2e }, button) => {
  const page = e2e.window;
  await expect(page.getByText(/Could not start #\d+/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
});

When('I click {string} in the roadmap bar', async ({ e2e }, button) => {
  await e2e.window.getByRole('button', { name: button, exact: true }).click();
});

Then('the refused item is in view', async ({ e2e }) => {
  await expect(refused(e2e.window)).toBeInViewport();
});

Then('the board looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(board(e2e.window)).toHaveScreenshot(name);
});

// ---- epics off the Board, on the Epics view (#253) ------------------------------------------------------
// The demo backlog's epics: #14 "Workspace safety and recovery" (members #11, #8) and #13 "Run
// reports" (member #12). Assumes data-testid="backlog-epic" on each epic card of the Epics view and
// data-testid="backlog-count" on the Board's "N issues" count.

const epicCard = (page, title) => page.getByTestId('backlog-epic').filter({ hasText: title }).first();

Then('the board does not show the issue {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(board(page).getByRole('link').first()).toBeVisible();
  await expect(board(page).getByRole('link', { name: title, exact: true })).toHaveCount(0);
});

When('I open the Epics view', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: 'Epics', exact: true }).click();
  await expect(page.getByTestId('backlog-epic').first()).toBeVisible();
});

Then('the Epics view lists the epic {string} with its member {string}', async ({ e2e }, title, member) => {
  const card = epicCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: member, exact: true })).toBeVisible();
});

Then('the Epics view shows the progress of the epic {string}', async ({ e2e }, title) => {
  await expect(epicCard(e2e.window, title)).toContainText(/\b\d+\/\d+\b/);
});

Then('the epic {string} cannot be selected for a workflow', async ({ e2e }, title) => {
  const card = epicCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card.getByRole('checkbox')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /Assign workflow|Start/ })).toHaveCount(0);
});

// the count of the Board's list ("6 issues") is the number of rows it lists, epics left out
Then("the Board's issue count leaves out the epics", async ({ e2e }) => {
  const page = e2e.window;
  const rows = page.getByTestId('backlog-list').getByTestId('backlog-issue');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await expect(page.getByTestId('backlog-count')).toHaveText(`${n} issue${n === 1 ? '' : 's'}`);
});

// ---- the Roadmap's progress ring and its steps popover (#236) ----------------------------------------

Given('the app is open in a {int}x{int} window', async ({ e2e }, w, h) => {
  await e2e.open({ size: `${w}x${h}` });
});

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const ringOf = (item) => item.getByRole('button', { name: /Show the run's steps/ });
const stepsPopover = (page) => page.getByRole('group', { name: "The run's steps" }).filter({ visible: true }).first();

When('I hover the progress ring of the roadmap item {string}', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await item.scrollIntoViewIfNeeded();
  await ringOf(item).hover();
  await expect(stepsPopover(e2e.window)).toBeVisible();
});

Then("the run's steps popover shows the run summary", async ({ e2e }) => {
  // the summary the ring's native tooltip used to carry: the estimate, what runs now, the run id
  const summary = stepsPopover(e2e.window).getByTestId('roadmap-run-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Estimate:');
  await expect(summary).toContainText('Now:');
  await expect(summary).toContainText(/Run \d{8}-\d{6}-\w+/);
});

Then('the progress ring has no native tooltip', async ({ e2e }) => {
  const progress = e2e.window.getByTestId('roadmap-item').filter({ has: stepsPopover(e2e.window) }).first();
  await expect(ringOf(progress)).not.toHaveAttribute('title');
});

When("I hover an agent in the run's steps popover", async ({ e2e }) => {
  await stepsPopover(e2e.window).getByTestId('progress-agent').first().hover();
});

Then('the agent card is shown inside the window', async ({ e2e }) => {
  const page = e2e.window;
  const card = stepsPopover(page).getByRole('tooltip').filter({ visible: true }).first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const view = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
});

// ---- the Roadmap's Resume (#243) and a stage run on its own that finished while paused (#237) --------

// The demo roadmap (scripts/screenshot.js demoRoadmap) in the scratch workspace, rewritten before the
// Backlog opens (the app follows the file live): stage N is the Nth of its stages, Show all or not.
const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}
const stageAt = (r, n) => {
  const stage = r.stages[n - 1];
  expect(stage, `the demo roadmap's stage ${n}`).toBeTruthy();
  return stage;
};

// "Run this stage", then Pause: the roadmap paused with that stage as its scope (#141)
Given('the roadmap was paused while stage {int} ran on its own', async ({ e2e }, n) => {
  editRoadmap(e2e, (r) => Object.assign(r, { state: 'paused', pausedBy: null, error: null, budget: null, scope: { stage: stageAt(r, n).id } }));
});

Given('every item of stage {int} is done', async ({ e2e }, n) => {
  editRoadmap(e2e, (r) => { for (const item of stageAt(r, n).items) Object.assign(item, { status: 'done', error: null }); });
});

const rmBar = (page) => page.getByTestId('roadmap-bar');
const confirmModal = (page) => page.getByTestId('confirm-modal');
const simulatedBox = (page) => rmBar(page).getByRole('checkbox', { name: 'Simulated', exact: true });

// Simulated off: a start of real runs asks first (the scenario cancels it; the engine refuses real
// runs anyway). The demo's stage 5 item pushes while the default workflow merges locally: the
// "will push and open PRs" choice (#195) comes first, "Start anyway" goes on to the confirm.
When('I press Resume on the roadmap with Simulated off', async ({ e2e }) => {
  const page = e2e.window;
  await simulatedBox(page).uncheck();
  await rmBar(page).getByRole('button', { name: 'Resume', exact: true }).click();
  const dialog = confirmModal(page);
  await expect(dialog).toBeVisible();
  const anyway = dialog.getByRole('button', { name: 'Start anyway', exact: true });
  if (await anyway.isVisible()) await anyway.click();
});

When('I resume the roadmap as a simulation', async ({ e2e }) => {
  const page = e2e.window;
  await simulatedBox(page).check();
  await rmBar(page).getByRole('button', { name: 'Resume', exact: true }).click();
});

Then('the confirm dialog is titled {string} with a {string} button', async ({ e2e }, title, button) => {
  const dialog = e2e.window.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: button, exact: true })).toBeVisible();
});

Then('the confirm dialog says the roadmap pauses again when the stage is done', async ({ e2e }) => {
  await expect(confirmModal(e2e.window)).toContainText(/pauses again when (this|that|the) stage is done/i);
});

When('I press Cancel in the confirm dialog', async ({ e2e }) => {
  const dialog = confirmModal(e2e.window);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});

// the roadmap bar's text: its state badge ("Paused · stage 5 only", #266: a readable status) and its message; the roadmap
// may change on its own (the app's sequencing), hence the longer wait
Then('the roadmap bar shows {string}', async ({ e2e }, text) => {
  await expect(rmBar(e2e.window)).toContainText(text, { timeout: 20000 });
});

Then('the roadmap bar does not show {string}', async ({ e2e }, text) => {
  await expect(rmBar(e2e.window)).not.toContainText(text, { timeout: 20000 });
});

Then('the Backlog shows no error {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByText(text, { exact: false })).toHaveCount(0);
});

// ---- the alerts at the top of the Board and the Roadmap (#270) ---------------------------------------
// What the screen exposes (new for #270):
// - data-testid="page-alerts": the alerts component, one alert at a time, at the top of the page (above
//   data-testid="filter-row"); hidden when there is no alert.
// - data-testid="page-alert": the alert shown, data-level = error | warning | info, with its actions
//   (buttons: "Retry", "Skip", "Resume", "Push…", "Refresh now", "Dismiss for today"…).
// - data-testid="alerts-counter": "1/3" (the alert shown / how many); buttons "Previous alert" and
//   "Next alert". Errors come first, then warnings, then infos.
// The demo workspace has a roadmap paused by a refused start ("Could not start #14: …", an error) and
// 2 commits merged locally and not pushed ("Not pushed", an info; the project's folder is not a git
// repository, so the cached status in backlog/<id>.local.json stays).

const alerts = (page) => page.getByTestId('page-alerts').filter({ visible: true }).first();
const shownAlert = (page) => alerts(page).getByTestId('page-alert').filter({ visible: true }).first();
const counter = (page) => alerts(page).getByTestId('alerts-counter');
const counted = async (page) => {
  await expect(counter(page)).toHaveText(/^\d+\/\d+$/, { timeout: 20000 });
  return (await counter(page).innerText()).trim().split('/').map(Number);
};

Then('the alerts show alert {int} of at least {int}', async ({ e2e }, n, least) => {
  await expect.poll(async () => (await counted(e2e.window))[0]).toBe(n);
  const [, total] = await counted(e2e.window);
  expect(total).toBeGreaterThanOrEqual(least);
});

Then('the shown alert is at level {string} and says {string}', async ({ e2e }, level, text) => {
  const alert = shownAlert(e2e.window);
  await expect(alert).toHaveAttribute('data-level', level, { timeout: 20000 });
  await expect(alert).toContainText(text);
});

Then('the shown alert is not at level {string}', async ({ e2e }, level) => {
  await expect(shownAlert(e2e.window)).not.toHaveAttribute('data-level', level);
});

Then('the shown alert offers {string} and {string}', async ({ e2e }, a, b) => {
  for (const name of [a, b]) await expect(shownAlert(e2e.window).getByRole('button', { name, exact: true })).toBeEnabled();
});

When('I show the next alert', async ({ e2e }) => {
  await alerts(e2e.window).getByRole('button', { name: 'Next alert', exact: true }).click();
});

When('I show the previous alert', async ({ e2e }) => {
  await alerts(e2e.window).getByRole('button', { name: 'Previous alert', exact: true }).click();
});

// Next alert until the alert with `text` is shown (at most one round of the alerts)
When('I show the alert {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  const [, total] = await counted(page);
  for (let k = 0; k < total && !(await shownAlert(page).innerText()).includes(text); k += 1) {
    await alerts(page).getByRole('button', { name: 'Next alert', exact: true }).click();
  }
  await expect(shownAlert(page)).toContainText(text);
});

Then('the alerts are at the top of the page, above the filter row', async ({ e2e }) => {
  const page = e2e.window;
  const box = await alerts(page).boundingBox();
  const row = await page.getByTestId('filter-row').filter({ visible: true }).first().boundingBox();
  expect(box && row, 'the alerts and the filter row are shown').toBeTruthy();
  expect(box.y + box.height, 'the alerts end above the filter row').toBeLessThanOrEqual(row.y + 1);
});

When('I click {string} in the shown alert', async ({ e2e }, name) => {
  await shownAlert(e2e.window).getByRole('button', { name, exact: true }).click();
});

// the push dialog (#push-modal): its title names the commits and the base
Then('the push dialog opens, titled {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByRole('heading', { name: title, exact: true })).toBeVisible();
});

// ---- Backlog › Product Owner (#234, #235) ------------------------------------------------------------

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const poAsk = (page) => poDrawer(page).getByTestId('agent-chat-send');
const poPills = (page) => poDrawer(page).getByTestId('po-pill');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

When('I open the Product Owner', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('button', { name: 'Product Owner', exact: true }).click();
  await expect(poDrawer(page)).toBeVisible();
});

When('I switch the Product Owner to {string}', async ({ e2e }, mode) => {
  await poDrawer(e2e.window).getByRole('group', { name: 'What to do with the Product Owner' }).getByRole('button', { name: mode, exact: true }).click();
});

// The simulated Product Owner answers in a few milliseconds: a MutationObserver records the drawer's
// states from before the click to the answer (window.__poWatch), checked once it has answered.
When("I watch the Product Owner's drawer", async ({ e2e }) => {
  await e2e.window.evaluate(() => {
    const drawer = document.querySelector('[data-testid="po-drawer"]') || document.querySelector('aside[aria-label="Product Owner"]');
    const q = (id) => drawer.querySelector(`[data-testid="${id}"]`);
    const watch = { states: [], firstInView: {} };
    const snap = () => {
      const pills = [...drawer.querySelectorAll('[data-testid="po-pill"]')];
      const log = q('agent-chat-messages');
      const working = q('po-working');
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const state = {
        pills: pills.length,
        pillsDisabled: pills.length > 0 && pills.every((p) => p.disabled),
        registerDisabled: pills.some((p) => /Register an issue/.test(p.textContent) && p.disabled),
        askDisabled: !!q('agent-chat-send')?.disabled,
        questionEnabled: !!q('agent-chat-input') && !q('agent-chat-input').disabled && !q('agent-chat-input').readOnly,
        working: shown(working) ? working.textContent.replace(/\s+/g, ' ').trim() : '',
      };
      watch.states.push(state);
      // a "You" bubble's first appearance: was it inside the conversation's visible area?
      if (log) {
        const lr = log.getBoundingClientRect();
        for (const b of log.querySelectorAll('[data-testid="po-message-you"]')) {
          const text = b.textContent.replace(/\s+/g, ' ').trim();
          if (text in watch.firstInView) continue;
          const r = b.getBoundingClientRect();
          watch.firstInView[text] = r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
        }
      }
    };
    // the bubbles already there before the question are not the new one
    for (const b of drawer.querySelectorAll('[data-testid="po-message-you"]')) watch.firstInView[b.textContent.replace(/\s+/g, ' ').trim()] = null;
    snap();
    new MutationObserver(snap).observe(drawer, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__poWatch = watch;
  });
});

const watched = (page) => page.evaluate(() => window.__poWatch);
// the states recorded while the Product Owner worked (Ask disabled or the working line shown)
const busyStates = (w) => w.states.filter((s) => s.askDisabled || s.working);

When('I click the suggested question {string}', async ({ e2e }, question) => {
  await poPills(e2e.window).filter({ hasText: question }).first().click();
});

When('I ask the Product Owner {string}', async ({ e2e }, question) => {
  const page = e2e.window;
  await poDrawer(page).getByTestId('agent-chat-input').fill(question);
  await poAsk(page).click();
});

Then('the Product Owner answers', async ({ e2e }) => {
  const page = e2e.window;
  await expect(poDrawer(page).getByText(/^Product Owner · /).last()).toBeVisible({ timeout: 30000 });
  await expect(poAsk(page)).toBeEnabled({ timeout: 30000 });
});

Then('the suggested questions, {string} and Ask were disabled while the Product Owner worked', async ({ e2e }, register) => {
  expect(register).toMatch(/^Register an issue/);
  const busy = busyStates(await watched(e2e.window));
  expect(busy.length, 'the Product Owner was never seen working').toBeGreaterThan(0);
  expect(busy.some((s) => s.pillsDisabled && s.registerDisabled && s.askDisabled), 'pills and Ask disabled together').toBe(true);
  expect(busy.filter((s) => s.pills > 0).every((s) => s.pillsDisabled && s.askDisabled), 'no pill or Ask enabled while it worked').toBe(true);
});

Then('the text field stayed enabled while the Product Owner worked', async ({ e2e }) => {
  const busy = busyStates(await watched(e2e.window));
  expect(busy.length, 'the Product Owner was never seen working').toBeGreaterThan(0);
  expect(busy.every((s) => s.questionEnabled)).toBe(true);
});

Then('the working line {string} with its timer showed while the Product Owner worked', async ({ e2e }, line) => {
  const w = await watched(e2e.window);
  const re = new RegExp(`${escapeRe(line)}\\s*\\d+:\\d{2}`);
  expect(w.states.map((s) => s.working).filter(Boolean), 'the working line and its timer').toEqual(expect.arrayContaining([expect.stringMatching(re)]));
});

Then('the suggested questions, {string} and Ask are enabled again', async ({ e2e }, register) => {
  const page = e2e.window;
  const pills = poPills(page);
  await expect(pills.first()).toBeEnabled();
  for (let n = 0, count = await pills.count(); n < count; n += 1) await expect(pills.nth(n)).toBeEnabled();
  await expect(pills.filter({ hasText: register })).toBeEnabled();
  await expect(poAsk(page)).toBeEnabled();
  await expect(poDrawer(page).getByTestId('agent-chat-input')).toBeEnabled();
});

Then('the working line is gone', async ({ e2e }) => {
  await expect(poDrawer(e2e.window).getByTestId('po-working')).toBeHidden();
});

Then('my question {string} was in view in the conversation as soon as I asked', async ({ e2e }, question) => {
  const w = await watched(e2e.window);
  const entry = Object.entries(w.firstInView).find(([text, inView]) => inView !== null && text.includes(question));
  expect(entry, `a new "You" bubble with "${question}"`).toBeTruthy();
  expect(entry[1], 'the new "You" bubble was in view when it appeared').toBe(true);
});

const poWorkflow = (page) => poDrawer(page).getByTestId('po-workflow');

Then("the plan's workflow choice offers {string} and {string}", async ({ e2e }, a, b) => {
  const select = poWorkflow(e2e.window);
  await expect(select).toBeVisible();
  const labels = (await select.locator('option').allTextContents()).map((t) => t.trim());
  for (const name of [a, b]) expect(labels.map((t) => t.toLowerCase())).toContain(name.toLowerCase());
});

When('I plan with the workflow {string}', async ({ e2e }, name) => {
  const select = poWorkflow(e2e.window);
  const labels = (await select.locator('option').allTextContents()).map((t) => t.trim());
  // the display name, whatever the case of its words ("AI Development" / "AI development")
  const label = labels.find((t) => t.toLowerCase() === name.toLowerCase());
  expect(label, `the workflow "${name}" among ${labels.join(', ')}`).toBeTruthy();
  await select.selectOption({ label });
});

const costChip = (page) => poDrawer(page).getByRole('combobox', { name: 'Cost of the next answer' });

Then('the Cost chip is hidden', async ({ e2e }) => {
  await expect(costChip(e2e.window)).toBeHidden();
});

Then('the Cost chip is shown', async ({ e2e }) => {
  await expect(costChip(e2e.window)).toBeVisible();
});

Then("the plan shows the workflow's options", async ({ e2e }) => {
  const options = poDrawer(e2e.window).getByTestId('po-workflow-options');
  await expect(options).toBeVisible();
  await expect(options.getByRole('radiogroup', { name: 'Unit tests' })).toBeVisible();
  await expect(options.getByRole('radiogroup', { name: 'E2E tests' })).toBeVisible();
});

Then("the Product Owner's header says {string}", async ({ e2e }, text) => {
  await expect(poDrawer(e2e.window).getByText(/^Planning for /)).toHaveText(new RegExp(`^${escapeRe(text)}$`, 'i'));
});

// ---- Backlog › Product Owner: a split proposal's card (#242) ------------------------------------------

const splitCard = (page, title) => poDrawer(page).getByTestId('po-split-card').filter({ hasText: title }).first();
// `inner` lies inside `outer` (1px of rounding allowed)
const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
  && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

Then('the Product Owner proposes to split {string}', async ({ e2e }, title) => {
  const card = splitCard(e2e.window, title);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
});

Then('the split card of {string} fits within the drawer', async ({ e2e }, title) => {
  const page = e2e.window;
  const card = splitCard(page, title);
  await card.scrollIntoViewIfNeeded();
  const drawer = await poDrawer(page).boundingBox();
  const box = await card.boundingBox();
  expect(drawer).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box.x, 'the card starts inside the drawer').toBeGreaterThanOrEqual(drawer.x - 1);
  expect(box.x + box.width, 'the card ends inside the drawer').toBeLessThanOrEqual(drawer.x + drawer.width + 1);
  // nothing inside the card spills past its sides (no element wider than the card)
  const spill = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll('*')].filter((c) => c.getClientRects().length && getComputedStyle(c).visibility !== 'hidden')
      .map((c) => c.getBoundingClientRect()).filter((c) => c.width && (c.left < r.left - 1 || c.right > r.right + 1)).length;
  });
  expect(spill, 'elements of the card past its sides').toBe(0);
});

Then('the conversation does not scroll sideways', async ({ e2e }) => {
  const log = poDrawer(e2e.window).getByTestId('agent-chat-messages');
  const { scroll, client } = await log.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll, 'the conversation\'s content width').toBeLessThanOrEqual(client);
});

Then('the task lines of the split card of {string} show no Markdown marks', async ({ e2e }, title) => {
  const tasks = splitCard(e2e.window, title).getByTestId('po-split-task');
  await expect(tasks.first()).toBeVisible();
  for (const text of await tasks.allTextContents()) {
    expect(text, 'a task line with bold marks').not.toContain('**');
    expect(text, 'a task line with backticks').not.toContain('`');
  }
});

Then('the split card of {string} shows {string} and {string} inside it', async ({ e2e }, title, a, b) => {
  const card = splitCard(e2e.window, title);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  for (const name of [a, b]) {
    const button = card.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const at = await button.boundingBox();
    expect(at).not.toBeNull();
    expect(inside(at, box), `"${name}" inside the card`).toBe(true);
  }
});
