// Steps of features/home.feature (#255): Home, the first screen, with its Overview and Analytics
// tabs. Locators are roles and data-testid only (skills/ui-conventions):
//   home-tab-overview, home-tab-analytics   Home's tabs (role="tab", named "Overview" / "Analytics")
//   home-flow-strip                         the flow from Inbox to Release
//   home-flow-stage (data-stage)            a stage: inbox, discovery, ready, todo, running, merged,
//                                           released (a stage without a screen is not rendered)
//   home-flow-count                         a stage's count (a button: opens its screen, filtered)
//   home-needs-you, home-needs-item         "What needs you" and its items (data-kind: gate,
//                                           failed-item, discovery), each with one action button
//   home-today                              today's summary (cost, runs, 24/7 occupancy, next stage)
// Analytics' own tabs: role="tablist" named "Analytics" (features/steps/run.steps.js opens them).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

// the stages in the order of the flow: label in the feature → data-stage
const STAGES = [
  ['Inbox', 'inbox'],
  ['Discovery', 'discovery'],
  ['Ready', 'ready'],
  ['Backlog To do', 'todo'],
  ['Running', 'running'],
  ['Merged locally', 'merged'],
  ['Released', 'released'],
];
const stageId = (label) => {
  const found = STAGES.find(([name]) => name === label);
  if (!found) throw new Error(`unknown stage "${label}" (one of ${STAGES.map(([n]) => n).join(', ')})`);
  return found[1];
};

const homeTab = (page, name) => page.getByTestId(`home-tab-${name.toLowerCase()}`);
const strip = (page) => page.getByTestId('home-flow-strip');
const stage = (page, label) => strip(page).locator(`[data-testid="home-flow-stage"][data-stage="${stageId(label)}"]`);
const needsYou = (page) => page.getByTestId('home-needs-you');
const needsItems = (page, kind) => needsYou(page).locator(kind ? `[data-testid="home-needs-item"][data-kind="${kind}"]` : '[data-testid="home-needs-item"]');
const analyticsTabs = (page) => page.getByRole('tablist', { name: 'Analytics', exact: true });

Then('Home is on its {string} tab', async ({ e2e }, name) => {
  const tab = homeTab(e2e.window, name);
  await expect(tab).toHaveRole('tab');
  await expect(tab).toHaveAccessibleName(name);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
});

When('I open the {string} tab of Home', async ({ e2e }, name) => {
  await homeTab(e2e.window, name).click();
});

Then('the flow strip shows its stages in the order of the flow, each with a count', async ({ e2e }) => {
  const page = e2e.window;
  await expect(strip(page)).toBeVisible();
  const stages = strip(page).getByTestId('home-flow-stage');
  await expect(stages.first()).toBeVisible();
  const order = STAGES.map(([, id]) => id);
  const shown = await stages.evaluateAll((els) => els.map((el) => el.getAttribute('data-stage')));
  expect(shown.length, 'the strip shows stages').toBeGreaterThan(0);
  // every stage is known, shown once, in the flow's order (a stage without a screen is left out)
  const positions = shown.map((id) => order.indexOf(id));
  expect(positions, `the stages ${shown.join(', ')}`).not.toContain(-1);
  expect(positions, 'the stages follow the flow').toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(shown).size, 'no stage twice').toBe(shown.length);
  // left to right on screen too
  let lastX = -Infinity;
  for (const el of await stages.all()) {
    const box = await el.boundingBox();
    expect(box, 'a stage is visible').not.toBeNull();
    expect(box.x).toBeGreaterThan(lastX);
    lastX = box.x;
    await expect(el.getByTestId('home-flow-count')).toHaveText(/^\s*\d+\s*$/);
  }
});

Then('the flow strip shows the stages {string} and {string}', async ({ e2e }, a, b) => {
  for (const label of [a, b]) {
    await expect(stage(e2e.window, label), `the stage "${label}"`).toBeVisible();
    await expect(stage(e2e.window, label).getByTestId('home-flow-count')).toHaveText(/^\s*\d+\s*$/);
  }
});

When('I open the {string} stage of the flow', async ({ e2e }, label) => {
  await stage(e2e.window, label).getByTestId('home-flow-count').click();
});

Then('"What needs you" lists a waiting gate with its age', async ({ e2e }) => {
  const gate = needsItems(e2e.window, 'gate').first();
  await expect(gate).toBeVisible();
  // its age: "95 min", "1h 35m", "2 hours ago"…
  await expect(gate).toContainText(/\d+\s*(s|m|min|h|d|sec|second|minute|hour|day)/i);
});

Then('"What needs you" lists a failed roadmap item', async ({ e2e }) => {
  await expect(needsItems(e2e.window, 'failed-item').first()).toBeVisible();
});

Then('every item of "What needs you" offers one action', async ({ e2e }) => {
  const items = needsItems(e2e.window);
  await expect(items.first()).toBeVisible();
  for (const item of await items.all()) {
    await expect(item.getByRole('button').first(), 'the item\'s action').toBeEnabled();
  }
});

Then('Home shows today\'s summary', async ({ e2e }) => {
  const today = e2e.window.getByTestId('home-today');
  await expect(today).toBeVisible();
  await expect(today).toContainText(/\d/);
});

// a tab's name may be longer than the feature's word ("Repository performance" for "Performance")
Then('the Analytics tabs offer {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const tabs = analyticsTabs(e2e.window);
  await expect(tabs).toBeVisible();
  for (const name of [a, b, c, d]) {
    await expect(tabs.getByRole('tab', { name }), `the Analytics tab "${name}"`).toBeVisible();
  }
});

Then('the Analytics tab {string} is selected', async ({ e2e }, name) => {
  await expect(analyticsTabs(e2e.window).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
});

Then('the Backlog screen is shown', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('backlog-board').or(page.getByTestId('backlog-list')).first()).toBeVisible();
});
