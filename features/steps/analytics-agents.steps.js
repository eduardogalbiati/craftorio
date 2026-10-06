// Steps of features/analytics.feature (#280): Home › Analytics › Agents, the Oracle's, Product
// Owner's and Supervisor's cost and sessions. Opening Home's tabs and Analytics' tabs, and the
// US$/Tokens radio group, reuse home.steps.js and run.steps.js. Locators are roles and data-testid
// only (skills/ui-conventions):
//   agents-card-oracle, agents-card-product-owner, agents-card-supervisor
//                                 an agent's card (clickable: filters the sessions table)
//   agents-card-cost, agents-card-turns   inside a card: its cost and its turns
//   agents-sessions-table         the sessions table (a <table>; Agent is its first column)
//   agents-session-row            a session's row (data-started: its ISO start time)
//   agents-start-reason           the "Why it started" chip (data-reason: first, compaction,
//                                 model-change, idle, reset, cleared, one-shot; its tooltip in title
//                                 or a role="tooltip" on hover)
//   agents-session-ended          the "Ended" cell ("open" while the session is open)
//   agents-cost-per-day-legend    the cost per day chart's legend (one entry per agent)
// "Show more" is a button named "Show more"; the US$/Tokens toggle a radiogroup named "Cost per day".

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const AGENT_IDS = { Oracle: 'oracle', 'Product Owner': 'product-owner', Supervisor: 'supervisor' };
const agentId = (name) => {
  const id = AGENT_IDS[name];
  if (!id) throw new Error(`unknown agent "${name}" (one of ${Object.keys(AGENT_IDS).join(', ')})`);
  return id;
};
const card = (page, name) => page.getByTestId(`agents-card-${agentId(name)}`);
const table = (page) => page.getByTestId('agents-sessions-table');
const rows = (page) => table(page).getByTestId('agents-session-row');

// clicks "Show more" until every session is listed (the table shows 50 at a time)
async function showAllSessions(page) {
  await expect(rows(page).first()).toBeVisible({ timeout: 30000 });
  const more = table(page).getByRole('button', { name: 'Show more', exact: true });
  for (let i = 0; i < 20 && (await more.isVisible()); i++) {
    const before = await rows(page).count();
    await more.click();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(before);
  }
}

Then('the Agents tab shows the cards {string}, {string} and {string} in this order', async ({ e2e }, a, b, c) => {
  let last = null;
  for (const name of [a, b, c]) {
    const el = card(e2e.window, name);
    await expect(el, `the card of ${name}`).toBeVisible({ timeout: 30000 });
    await expect(el).toContainText(name);
    const box = await el.boundingBox();
    // left to right, or top to bottom on a narrow window
    if (last) expect(box.x > last.x || box.y > last.y, `${name} comes after the previous card`).toBe(true);
    last = box;
  }
});

Then('every agent card shows its cost and its turns', async ({ e2e }) => {
  for (const name of Object.keys(AGENT_IDS)) {
    const el = card(e2e.window, name);
    await expect(el.getByTestId('agents-card-cost'), `the cost of ${name}`).toContainText(/\d/);
    await expect(el.getByTestId('agents-card-turns'), `the turns of ${name}`).toContainText(/\d/);
  }
});

Then('the agent sessions table lists sessions newest first', async ({ e2e }) => {
  const page = e2e.window;
  await expect(rows(page).first()).toBeVisible({ timeout: 30000 });
  const started = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-started')));
  expect(started.length, 'the table lists sessions').toBeGreaterThan(1);
  expect(started.length, 'at most 50 rows before "Show more"').toBeLessThanOrEqual(50);
  const times = started.map((s) => Date.parse(s));
  expect(times, 'every row has its start time').not.toContain(NaN);
  expect(times, 'newest first').toEqual([...times].sort((x, y) => y - x));
});

Then('the agent sessions show the start reasons {string}', async ({ e2e }, list) => {
  const page = e2e.window;
  await showAllSessions(page);
  const shown = new Set(await table(page).getByTestId('agents-start-reason').evaluateAll((els) => els.map((el) => el.getAttribute('data-reason'))));
  for (const reason of list.split(',').map((r) => r.trim())) {
    expect(shown.has(reason), `a session started by "${reason}" (shown: ${[...shown].join(', ')})`).toBe(true);
  }
});

Then('the start reason {string} explains {string}', async ({ e2e }, reason, text) => {
  const page = e2e.window;
  const chip = table(page).locator(`[data-testid="agents-start-reason"][data-reason="${reason}"]`).first();
  await chip.scrollIntoViewIfNeeded();
  await expect(chip).toBeVisible();
  const title = (await chip.getAttribute('title')) || '';
  if (title.toLowerCase().includes(text.toLowerCase())) return;
  await chip.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: new RegExp(text, 'i') }).first()).toBeVisible();
});

Then('an agent session still open says {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await showAllSessions(page);
  await expect(table(page).getByTestId('agents-session-ended').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`, 'i') }).first()).toBeAttached();
});

When('I choose the {string} agent card', async ({ e2e }, name) => {
  await card(e2e.window, name).click();
});

Then('the agent sessions table shows only {string} sessions', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(rows(page).first()).toBeVisible({ timeout: 30000 });
  // the filter applies: every row's Agent cell is that agent
  await expect.poll(async () => {
    const agents = await rows(page).evaluateAll((els) => els.map((el) => (el.querySelector('td, [role="cell"]')?.textContent || '').trim()));
    return agents.length > 0 && agents.every((a) => a.includes(name));
  }, { message: `only ${name} sessions`, timeout: 30000 }).toBe(true);
});

Then('the cost per day legend shows {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const legend = e2e.window.getByTestId('agents-cost-per-day-legend');
  await expect(legend).toBeVisible({ timeout: 30000 });
  for (const name of [a, b, c]) await expect(legend).toContainText(name);
});
