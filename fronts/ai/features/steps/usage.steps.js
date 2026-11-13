// Steps of fronts/ai/features/usage.feature (#783): in a browser tab against the engine server, the ▶ of
// the GitHub Actions card's `gh auth refresh -s user` asks for confirmation, then opens a terminal tab of
// the dock running that command on the engine (term:open kind 'command'). The served engine and its
// browser UI come from features/support/served.js ("Given the engine is served on this machine" and
// "When I open the served UI in the browser" in features/steps/engine-version.steps.js); "the confirm
// dialog asks {string}" is fronts/build/features/steps/roadmap-stage-menu.steps.js's.
//
// Locators are roles and data-testid only (skills/ui-conventions), all existing:
//   button "Run in a terminal: <command>"   the ▶ of a suggested command (packages/ui-kit/command-hint.js)
//   confirm-modal                           the app's confirm dialog (index.html)
//   region "Terminals"                      the terminal dock (#term-dock); its tabs are role tab
//   toast                                   a toast

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
// what getActionsUsage answers when gh lacks the `user` scope (packages/engine/domains/usage/actions-usage.js)
const NO_SCOPE = { error: 'GitHub billing usage needs the gh "user" scope', hint: 'gh auth refresh -s user', includedMinutes: 2000 };

const apiPath = (url) => decodeURIComponent(new URL(url).pathname);
const actionsCard = (page) => page.locator('[data-provider="actions"]').filter({ visible: true }).first();
const confirmModal = (page) => page.getByTestId('confirm-modal');
const termDock = (page) => page.getByRole('region', { name: 'Terminals', exact: true });
const termTabs = (page) => termDock(page).getByRole('tab');

// The served engine's gh has no account in the scenario's HOME: its answer without the scope is faked at
// the HTTP surface the browser sees (set before the served UI opens, the window is still on about:blank).
Given('gh on the served engine lacks the {string} scope for GitHub\'s billing usage', async ({ e2e }, scope) => {
  expect(scope).toBe('user');
  await e2e.window.route((url) => apiPath(url.href) === '/api/usage:actions', (route) => route.fulfill({ json: { result: NO_SCOPE } }));
});

Then('the GitHub Actions card says {string} and suggests {string}', async ({ e2e }, text, command) => {
  const card = actionsCard(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText('GitHub Actions');
  await expect(card).toContainText(text, { timeout: LOAD_TIMEOUT });
  await expect(card.getByRole('button', { name: `Run in a terminal: ${command}`, exact: true })).toBeVisible();
});

// The browser's calls to the engine's term:open from here on are recorded (e2e.termOpens), with the
// engine's HTTP status, to check the terminal is the engine's and the engine accepted the command.
When('I click the ▶ of {string}', async ({ e2e }, command) => {
  const page = e2e.window;
  e2e.termOpens = [];
  page.on('response', (res) => {
    if (res.request().method() !== 'POST' || apiPath(res.url()) !== '/api/term:open') return;
    let arg = null;
    try { arg = JSON.parse(res.request().postData() || '{}').arg; } catch { arg = null; }
    e2e.termOpens.push({ arg, status: res.status() });
  });
  await page.getByRole('button', { name: `Run in a terminal: ${command}`, exact: true }).filter({ visible: true }).first().click();
});

When('I click {string} in the confirm dialog', async ({ e2e }, name) => {
  const dialog = confirmModal(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
});

Then('a terminal tab opens in the dock running {string}', async ({ e2e }, command) => {
  const page = e2e.window;
  await expect(termDock(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(termTabs(page)).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(termDock(page).getByRole('tab', { selected: true })).toBeVisible();
  // the engine was asked for that exact command, kind 'command', and accepted it
  await expect.poll(() => e2e.termOpens.length, { timeout: LOAD_TIMEOUT, message: 'the browser called the engine\'s term:open' }).toBeGreaterThan(0);
  expect(e2e.termOpens.map((o) => ({ kind: o.arg?.kind, command: o.arg?.command }))).toEqual([{ kind: 'command', command }]);
  expect(e2e.termOpens[0].status, 'the engine accepted the command (term:open answered 200)').toBe(200);
  // the tab shows the command it runs (its pane, its title or its label)
  const tab = termDock(page).getByRole('tab', { selected: true });
  const said = async () => `${await tab.getAttribute('title') || ''} ${await tab.getAttribute('aria-label') || ''} ${await termDock(page).innerText()}`;
  await expect.poll(said, { timeout: LOAD_TIMEOUT }).toContain(command);
});

Then('no terminal tab opens in the dock', async ({ e2e }) => {
  // the dialog has closed on Cancel (the click step waits for it): a declined command opens nothing after
  await expect(termTabs(e2e.window)).toHaveCount(0);
  expect(e2e.termOpens || [], 'the browser never called the engine\'s term:open').toEqual([]);
});

Then('no toast says {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('toast').filter({ hasText: text })).toHaveCount(0);
});
