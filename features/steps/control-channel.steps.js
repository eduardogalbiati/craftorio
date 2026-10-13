// Steps of features/control-channel.feature (#336): Settings › Execution's "Allow outside sessions to
// control this app" switch (a checkbox named by its aria-label, data-testid="setting-control-channel",
// off by default, its one-line description mentions human gates), its status
// (data-testid="control-channel-status": the 127.0.0.1 port and the endpoint file's path) and the
// workspace's control/endpoint.json ({ url, token }), written while the channel is on, deleted when off.
// Opening Settings and its tabs reuses app.steps.js. Locators are roles and data-testid only
// (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const switchNamed = (page, name) => page.getByRole('checkbox', { name, exact: true });
const status = (page) => page.getByTestId('control-channel-status');
const endpointFile = (e2e) => path.join(e2e.scratch, 'workspace', 'control', 'endpoint.json');
const readEndpoint = (e2e) => {
  try { return JSON.parse(fs.readFileSync(endpointFile(e2e), 'utf8')); } catch { return null; }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

When('I turn {word} the {string} switch', async ({ e2e }, state, name) => {
  const box = switchNamed(e2e.window, name);
  await expect(box).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await box.setChecked(state === 'on');
  await expect(box).toBeChecked({ checked: state === 'on' });
});

Then('the {string} switch is turned {word}', async ({ e2e }, name, state) => {
  const box = switchNamed(e2e.window, name);
  await expect(box).toBeChecked({ checked: state === 'on', timeout: LOAD_TIMEOUT });
});

// the description is the text of the switch's own row: the innermost element holding both
Then('the {string} switch\'s description mentions {string}', async ({ e2e }, name, words) => {
  const page = e2e.window;
  const box = switchNamed(page, name);
  await expect(box).toBeAttached({ timeout: LOAD_TIMEOUT });
  const row = page.locator('*', { has: box }).filter({ hasText: new RegExp(escapeRe(words), 'i') }).last();
  await expect(row).toBeVisible();
});

Then('the workspace has no control endpoint file', async ({ e2e }) => {
  await expect.poll(() => fs.existsSync(endpointFile(e2e)), { timeout: LOAD_TIMEOUT }).toBe(false);
});

Then('the workspace\'s control endpoint file gives a 127.0.0.1 address and a token', async ({ e2e }) => {
  await expect.poll(() => {
    const endpoint = readEndpoint(e2e);
    if (!endpoint || typeof endpoint.url !== 'string') return null;
    try { return new URL(endpoint.url).hostname; } catch { return null; }
  }, { timeout: LOAD_TIMEOUT }).toBe('127.0.0.1');
  const endpoint = readEndpoint(e2e);
  expect(Number(new URL(endpoint.url).port)).toBeGreaterThan(0);
  expect(typeof endpoint.token).toBe('string');
  expect(endpoint.token.length).toBeGreaterThan(0);
});

Then('the control channel status shows the endpoint file\'s port and path', async ({ e2e }) => {
  await expect.poll(() => readEndpoint(e2e)?.url || null, { timeout: LOAD_TIMEOUT }).not.toBeNull();
  const port = new URL(readEndpoint(e2e).url).port;
  const shown = status(e2e.window);
  await expect(shown).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(shown).toContainText(new RegExp(`\\b${port}\\b`));
  await expect(shown).toContainText('endpoint.json');
});

// hidden, or no address with a port any more
Then('the control channel status shows no port', async ({ e2e }) => {
  const shown = status(e2e.window);
  await expect.poll(async () => ((await shown.isVisible()) ? (await shown.innerText()) : ''), { timeout: LOAD_TIMEOUT })
    .not.toMatch(/127\.0\.0\.1:\d+|\bport\b\W*\d+/i);
});
