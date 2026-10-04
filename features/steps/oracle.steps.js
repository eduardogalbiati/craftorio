// Steps of features/oracle.feature (#208): the Oracle's panel (docked on the Dashboard, a drawer
// elsewhere) in a narrow window: the app never shifts sideways, the panel's header stays readable.
// #244: a routine wake-up is a code-only notice, the daily budget counts each turn's own cost (not
// Claude's cumulative session cost), the status shows the model and a fresh or resumed session.
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// the Oracle's panel in view: the Dashboard's dock or the drawer (a closed drawer is aria-hidden and
// the dock of a hidden Dashboard is not rendered, so only the open one matches)
const oraclePanel = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });
const HEADER_BUTTONS = ['Night watch', 'Memory', 'New session'];

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

When('I open the Oracle', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('navigation').getByRole('button', { name: /^Oracle(\s+\d+)?$/ }).click();
  const panel = oraclePanel(page);
  await expect(panel).toBeVisible();
  // opening it focuses its question box: the moment a focus scroll would shift the page
  await expect(panel.getByRole('textbox')).toBeFocused();
});

When('I open the Oracle\'s {string} form', async ({ e2e }, button) => {
  const panel = oraclePanel(e2e.window);
  await panel.getByRole('button', { name: button, exact: true }).click();
  // the Night watch form has a Start button, the Memory form a Save button
  await expect(panel.getByRole('button', { name: /^(Start|Save|Edit)$/ }).first()).toBeVisible();
});

Then('the page has not scrolled sideways', async ({ e2e }) => {
  const shifted = await e2e.window.evaluate(() => {
    const boxes = [document.scrollingElement, document.querySelector('.shell'), document.querySelector('main.content'), document.querySelector('#view-dashboard')];
    return boxes.filter(Boolean).map((el) => ({ el: el.className || el.tagName, left: el.scrollLeft })).filter((x) => x.left !== 0);
  });
  expect(shifted).toEqual([]);
});

Then('the sidebar is visible', async ({ e2e }) => {
  const sidebar = e2e.window.getByRole('navigation');
  await expect(sidebar).toBeInViewport();
  const box = await sidebar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
});

Then('the Oracle\'s title is readable, not covered by its header buttons', async ({ e2e }) => {
  const panel = oraclePanel(e2e.window);
  const title = panel.getByRole('heading', { name: 'Oracle', exact: true });
  await expect(title).toBeVisible();
  const t = await title.boundingBox();
  expect(t).not.toBeNull();
  expect(t.width).toBeGreaterThan(0);
  // not clipped: the whole word fits in its box
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const name of HEADER_BUTTONS) {
    const button = panel.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const b = await button.boundingBox();
    expect(overlaps(t, b), `"${name}" covers the title`).toBe(false);
  }
});

// ---- #244 ------------------------------------------------------------------------------------------

// a wake-up waits for its batch window (src/oracle-wake.js BATCH_MS, 30 s) before it is posted
const WAKE_TIMEOUT = 90000;

When('I untick the Oracle wake-up {string}', async ({ e2e }, label) => {
  const box = e2e.window.getByRole('checkbox', { name: label, exact: true });
  await box.uncheck();
  await expect(box).not.toBeChecked();
});

// the run of the gate card in view, stopped (confirmed in the "Stop workflow" dialog)
When('I stop the run', async ({ e2e }) => {
  const page = e2e.window;
  e2e.stoppedRunId = await page.getByTestId('run-gate').first().getAttribute('data-run');
  expect(e2e.stoppedRunId, 'the gate card names its run').toBeTruthy();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('dialog', { name: 'Stop workflow' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText(/cancelled/i, { timeout: 30000 });
});

Then('the Oracle shows a notice for the run with the status {string} and its cost', async ({ e2e, $testInfo }, status) => {
  $testInfo.setTimeout($testInfo.timeout + WAKE_TIMEOUT);
  const notice = oraclePanel(e2e.window).getByTestId('oracle-run-notice').filter({ hasText: e2e.stoppedRunId });
  await expect(notice).toBeVisible({ timeout: WAKE_TIMEOUT });
  await expect(notice).toContainText(status);
  await expect(notice).toContainText(/\$\d+\.\d{2}/);
});

// a fresh workspace's chat holds no other turn: any simulated answer would be the wake-up's model turn
Then('the Oracle did not answer the run\'s wake-up with a model turn', async ({ e2e }) => {
  await expect(oraclePanel(e2e.window)).not.toContainText('Simulated Oracle');
});

// <workspace>/oracle/usage.jsonl: one line per turn, as src/oracle.js recordUsage writes them, with the
// cost Claude reports for a resumed session (cumulative over the session)
Given('the Oracle\'s usage log holds one session today reporting the cumulative costs {string}', async ({ e2e }, list) => {
  const costs = list.split(',').map((c) => Number(c.trim()));
  const dir = path.join(e2e.scratch, 'workspace', 'oracle');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const lines = costs.map((costUsd, i) => JSON.stringify({
    ts: new Date(now - (costs.length - i) * 1000).toISOString(), provider: 'claude', model: 'claude-opus-5-5', tokens: {}, costUsd, sessionId: 'e2e-session-244',
  }));
  fs.appendFileSync(path.join(dir, 'usage.jsonl'), `${lines.join('\n')}\n`);
});

Then('the Oracle is not paused by budget', async ({ e2e }) => {
  const panel = oraclePanel(e2e.window);
  await expect(panel.getByRole('textbox')).toBeEnabled();
  await expect(panel).not.toContainText('Paused by budget');
});

Then('the Oracle\'s footer shows {string}', async ({ e2e }, text) => {
  await expect(oraclePanel(e2e.window)).toContainText(text);
});

When('I ask the Oracle {string}', async ({ e2e }, question) => {
  const panel = oraclePanel(e2e.window);
  const box = panel.getByRole('textbox');
  await expect(box).toBeEnabled({ timeout: 30000 });
  await box.fill(question);
  const send = panel.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
});

Then('the Oracle\'s status shows the model {string}', async ({ e2e }, model) => {
  await expect(oraclePanel(e2e.window).getByTestId('oracle-model')).toContainText(model);
});

// "fresh" (the last turn started a new session) or "resumed" (it went on with the session)
Then('the Oracle\'s status shows the session {string}', async ({ e2e }, mode) => {
  await expect(oraclePanel(e2e.window).getByTestId('oracle-session-mode')).toContainText(mode, { timeout: 30000 });
});
