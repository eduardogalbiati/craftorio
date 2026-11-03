// Steps of features/monitor.feature (#634): the Monitor group's Errors screen (view `errors`,
// fronts/ai/views/errors/, docs/work/first-project-onboarding/images/mock-8.jpg). Locators are roles and
// data-testid only (skills/ui-conventions):
//   monitor-error-row     one row per error group (data-fingerprint), its title in its text
//   monitor-error-state   the row's state badge ("new", "intent in Inbox", "fix run · waiting for you");
//                         with a fix run, it opens that run (assumption of this suite)
//   monitor-sources       the source chips area (the "Sources…" button sits on the screen's header)
//   monitor-automation    the automation line under the list
// The row's actions are buttons by name ("Diagnose", "Propose fix").
// The production errors are simulated: a log file of JSON lines in the scenario's scratch folder,
// saved as the demo project's log-file source and polled through window.api (monitor:save-source,
// monitor:poll), the way the "Sources…" dialog and the source's timer do.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { LOAD_TIMEOUT } = require('../support/run-screen');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const errorRows = (page) => page.getByTestId('monitor-error-row');
const errorRow = (page, title) => errorRows(page).filter({ hasText: title });
const errorState = (page, title) => errorRow(page, title).getByTestId('monitor-error-state');
const openedCard = (page) => page.getByTestId('inbox-card-detail');

const MESSAGE = "TypeError: cannot read 'total' of undefined";

// "POST /api/checkout" → { method, path }; "checkout.js:412" → { file, line }
Given('the demo project\'s production log records a {int} on {string} {int} times, from {string}', async ({ e2e }, status, route, times, at) => {
  const [method, ...rest] = route.split(' ');
  const [file, line] = at.split(':');
  const now = Date.now();
  const lines = Array.from({ length: times }, (_, i) => JSON.stringify({
    id: `e${i + 1}`,
    // within the last hour, oldest first
    at: new Date(now - (times - i) * 60000).toISOString(),
    status, method, path: rest.join(' '), message: MESSAGE, file, line: Number(line),
  }));
  const dir = path.join(e2e.scratch, 'production-logs');
  fs.mkdirSync(dir, { recursive: true });
  e2e.productionLog = path.join(dir, 'api.log');
  fs.writeFileSync(e2e.productionLog, `${lines.join('\n')}\n`);
});

async function callApi(e2e, method, request) {
  const res = await e2e.window.evaluate(async ({ method, request }) => {
    if (typeof window.api?.[method] !== 'function') return { missing: true };
    try {
      return { out: await window.api[method](request) };
    } catch (e) {
      return { thrown: String(e?.message || e) };
    }
  }, { method, request });
  expect(res?.missing, `window.api.${method}`).toBeFalsy();
  expect(res?.thrown, `window.api.${method} rejected`).toBeFalsy();
  expect(res?.out?.ok, `window.api.${method}: ${res?.out?.error}`).not.toBe(false);
  return res.out;
}

Given('the app watches that log as an error source', async ({ e2e }) => {
  expect(e2e.productionLog, 'a production log written by an earlier step').toBeTruthy();
  const projectId = e2e.project.id;
  await callApi(e2e, 'monitorSaveSource', { projectId, source: { type: 'log-file', path: e2e.productionLog } });
  await callApi(e2e, 'monitorPoll', { projectId });
});

Then('the Errors screen describes the production errors of {string}', async ({ e2e }, project) => {
  const main = e2e.window.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Errors', exact: true })).toBeVisible();
  await expect(main).toContainText(`Production errors of ${project}, grouped.`);
  await expect(main).toContainText('becomes an intent in the Inbox');
  await expect(main).toContainText('a fix run starts only when you say so');
});

Then('the Errors screen lists {int} error group(s)', async ({ e2e }, n) => {
  await expect(errorRows(e2e.window)).toHaveCount(n, { timeout: LOAD_TIMEOUT });
});

Then('the error {string} shows the status {string} and {string} at {string}', async ({ e2e }, title, status, message, at) => {
  const row = errorRow(e2e.window, title);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-fingerprint', /\S/);
  await expect(row).toContainText(status);
  await expect(row).toContainText(message);
  await expect(row).toContainText(at);
});

Then('the error {string} counts {int} occurrence(s)', async ({ e2e }, title, n) => {
  await expect(errorRow(e2e.window, title)).toContainText(new RegExp(`(^|[^\\d:.])${n}\\s*·`));
});

Then('the state of the error {string} reads {string}', async ({ e2e }, title, state) => {
  await expect(errorState(e2e.window, title)).toHaveText(new RegExp(`^\\s*${escapeRe(state)}\\s*$`), { timeout: LOAD_TIMEOUT });
});

Then('the error {string} offers {string}', async ({ e2e }, title, name) => {
  await expect(errorRow(e2e.window, title).getByRole('button', { name, exact: true })).toBeVisible();
});

When('I click {string} on the error {string}', async ({ e2e }, name, title) => {
  await errorRow(e2e.window, title).getByRole('button', { name, exact: true }).click();
});

When('I open the fix run of the error {string}', async ({ e2e }, title) => {
  await errorState(e2e.window, title).click();
});

Then('the Errors screen shows its sources and offers {string}', async ({ e2e }, name) => {
  const sources = e2e.window.getByTestId('monitor-sources');
  await expect(sources).toBeVisible();
  await expect(sources).not.toHaveText(/^\s*$/);
  await expect(e2e.window.getByRole('main').getByRole('button', { name, exact: true })).toBeVisible();
});

Then('the automation line says {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const line = e2e.window.getByTestId('monitor-automation');
  for (const text of [a, b, c]) await expect(line).toContainText(text);
});

Then('the opened card\'s document mentions {string}', async ({ e2e }, text) => {
  await expect(openedCard(e2e.window)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

// #650: an error group is tied to an item of docs/work/ by a <select> on its row (monitor-item-select),
// whose options are the items' titles
When('I tie the error {string} to the item {string}', async ({ e2e }, title, itemTitle) => {
  const select = errorRow(e2e.window, title).getByTestId('monitor-item-select');
  await expect(select).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label: itemTitle });
  await expect(select.locator('option:checked')).toHaveText(itemTitle);
});
