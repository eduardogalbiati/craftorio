// Steps of features/backlog.feature and features/visual.feature (#222): the Backlog's Board (list,
// kanban) and Roadmap on the demo project, and their visual baselines; the Roadmap's progress ring
// popover (#236) and features/product-owner.feature's Product Owner drawer (#234, #235). Locators
// are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const board = (page) => page.getByTestId('backlog-board');

When('I open the Board as a kanban', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(board(page)).toBeVisible();
});

When('I open the Roadmap', async ({ e2e }) => {
  await e2e.window.getByRole('tab', { name: 'Roadmap', exact: true }).click();
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

// ---- Backlog › Product Owner (#234, #235) ------------------------------------------------------------

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const poAsk = (page) => poDrawer(page).getByTestId('po-ask');
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
      const log = q('po-log');
      const working = q('po-working');
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const state = {
        pills: pills.length,
        pillsDisabled: pills.length > 0 && pills.every((p) => p.disabled),
        registerDisabled: pills.some((p) => /Register an issue/.test(p.textContent) && p.disabled),
        askDisabled: !!q('po-ask')?.disabled,
        questionEnabled: !!q('po-question') && !q('po-question').disabled && !q('po-question').readOnly,
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
  await poDrawer(page).getByTestId('po-question').fill(question);
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
  await expect(poDrawer(page).getByTestId('po-question')).toBeEnabled();
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
  const log = poDrawer(e2e.window).getByTestId('po-log');
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
