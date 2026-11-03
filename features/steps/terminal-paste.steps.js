// Steps of features/746-terminal-paste.feature (#746): Ctrl+V in a terminal of the dock, in a browser
// tab against the engine server, pastes through the browser's paste event (clipboardData), never
// navigator.clipboard.readText; a read-only tab refuses it with its message; a refused clipboard read
// (the terminal's right-click Paste) says "Use Ctrl+V to paste". The served engine and its browser UI
// come from features/support/served.js ("Given the engine is served on this machine" and "When I open
// the served UI in the browser" in engine-version.steps.js); the run and its gate card from
// fronts/build/features/steps/run.steps.js, whose "the terminal shows {string}" reads the dock.
//
// Locators are roles and data-testid only (skills/ui-conventions):
//   region "Terminals"           the terminal dock (#term-dock, aria-label; existing)
//   textbox "Terminal input"     xterm's input (its helper textarea's aria-label; existing)
//   run-gate                     the gate card (existing); its button "Terminal there" (existing)
//   run-session-card             a session on the Run screen (existing), its "Live terminal" button
//   term-pane                    NEW: a terminal's pane in the dock (term-dock.js openTerminal)
//   term-dock-message            NEW: the terminal bar's message (#term-msg), class "error" on an error

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the browser's own message when it denies the clipboard-read permission
const DENIED = "Failed to execute 'readText' on 'Clipboard': Read permission denied.";

const termDock = (page) => page.getByRole('region', { name: 'Terminals', exact: true });
const activePane = (page) => termDock(page).getByTestId('term-pane').filter({ visible: true }).first();
const termInput = (page) => activePane(page).getByRole('textbox', { name: 'Terminal input' });
const termMessage = (page) => page.getByTestId('term-dock-message');

// a call to the served engine's HTTP API (Authorization: Bearer <the served URL's token>)
async function callEngine(e2e, channel, arg) {
  const url = new URL(e2e.url);
  const token = url.searchParams.get('token');
  const res = await fetch(`${url.origin}/api/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ arg: arg === undefined ? null : arg }),
  });
  const body = await res.json().catch(() => ({}));
  expect(res.status, `${channel} answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
  return body.result;
}

// a served engine on a new workspace opens the first-run Setup (#319) over every page
Given('the served engine\'s first-run Setup is done', async ({ e2e }) => {
  await callEngine(e2e, 'settings:set', { setupDone: true });
});

// before the page loads: readText counts its calls and rejects as a browser denying the permission
Given('the browser refuses to let the page read the clipboard', async ({ e2e }) => {
  await e2e.window.addInitScript((message) => {
    window.__e2eClipboardReads = 0;
    const refuse = () => {
      window.__e2eClipboardReads += 1;
      return Promise.reject(new DOMException(message, 'NotAllowedError'));
    };
    Object.defineProperty(Clipboard.prototype, 'readText', { configurable: true, writable: true, value: refuse });
    Object.defineProperty(Clipboard.prototype, 'read', { configurable: true, writable: true, value: refuse });
  }, DENIED);
});

When('I open the gate card\'s {string}', async ({ e2e }, name) => {
  const card = e2e.window.getByTestId('run-gate').filter({ visible: true }).first();
  await card.getByRole('button', { name, exact: true }).click();
  await expect(activePane(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('I open the Live terminal of the run\'s first agent session', async ({ e2e }) => {
  const page = e2e.window;
  const card = page.locator('[data-testid="run-session-card"]:not([data-id="orchestrator"])').filter({ visible: true }).first();
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await card.click();
  await page.getByRole('button', { name: 'Live terminal', exact: true }).filter({ visible: true }).first().click();
  const tab = termDock(page).getByRole('tab', { selected: true });
  await expect(tab).toHaveAttribute('title', /read-only/i, { timeout: LOAD_TIMEOUT });
});

// The key, then the paste the browser fires for it. The keydown is recorded on the window (after the
// terminal's own handlers) to see whether the page let the browser paste (defaultPrevented false).
When('I press Ctrl+V in the terminal with {string} in the clipboard', async ({ e2e }, text) => {
  const page = e2e.window;
  const input = termInput(page);
  await expect(activePane(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the tab is connected (term:open answered) before the keys go in
  await expect(termDock(page).getByRole('tab', { selected: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await input.focus();
  await page.evaluate(() => {
    window.__e2eCtrlV = null;
    // capture: seen even if the terminal stops its propagation; read once the dispatch has ended
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'v') setTimeout(() => { window.__e2eCtrlV = { defaultPrevented: e.defaultPrevented }; }, 0);
    }, true);
  });
  await page.keyboard.press('Control+V');
  await input.evaluate((el, pasted) => {
    const data = new DataTransfer();
    data.setData('text/plain', pasted);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
});

When('I press Enter in the terminal', async ({ e2e }) => {
  await termInput(e2e.window).focus();
  await e2e.window.keyboard.press('Enter');
});

When('I right-click the terminal to paste', async ({ e2e }) => {
  const pane = activePane(e2e.window);
  await expect(pane).toBeVisible({ timeout: LOAD_TIMEOUT });
  await pane.click({ button: 'right' });
});

Then('the browser was free to paste for the Ctrl+V', async ({ e2e }) => {
  await expect.poll(() => e2e.window.evaluate(() => window.__e2eCtrlV), { message: 'the Ctrl+V keydown was seen' }).toBeTruthy();
  const seen = await e2e.window.evaluate(() => window.__e2eCtrlV);
  expect(seen.defaultPrevented, 'the page did not cancel the Ctrl+V keydown (the browser pastes)').toBe(false);
});

Then('the page never asked to read the clipboard', async ({ e2e }) => {
  expect(await e2e.window.evaluate(() => window.__e2eClipboardReads)).toBe(0);
});

Then('the terminal bar shows no error', async ({ e2e }) => {
  const msg = termMessage(e2e.window);
  await expect(msg).not.toHaveClass(/\berror\b/);
  await expect(msg).not.toHaveText(/readText|permission|denied|Failed/i);
});

Then('the terminal bar says {string}', async ({ e2e }, text) => {
  await expect(termMessage(e2e.window)).toHaveText(text, { timeout: LOAD_TIMEOUT });
});

Then('the terminal bar does not show the browser\'s clipboard error', async ({ e2e }) => {
  await expect(termMessage(e2e.window)).not.toHaveText(/readText|Read permission denied|Failed to execute/i);
});

Then('the terminal does not show {string}', async ({ e2e }, text) => {
  await expect(termDock(e2e.window)).not.toContainText(text);
});
