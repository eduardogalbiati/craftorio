// Steps of features/settings.feature's phone gates (#226): Settings › Phone gates, the pairing code
// and QR code for the gates page the app serves, the setup steps and the list of paired devices;
// and of features/phone-gates.feature (#819): the phone's own gates page, further down.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { callEngine } = require('../support/engine-api');

const section = (page) => page.getByTestId('phone-gates');

When('I ask for a code to pair a phone', async ({ e2e }) => {
  await section(e2e.window).getByRole('button', { name: /^Pair a phone/ }).click();
});

Then('the phone gates section shows a pairing code', async ({ e2e }) => {
  await expect(section(e2e.window).getByTestId('phone-pairing-code')).toHaveText(/[A-Z0-9]{4,}/i);
});

Then('the phone gates section shows a QR code to pair a phone', async ({ e2e }) => {
  const qr = section(e2e.window).getByRole('img', { name: /QR code/i });
  await expect(qr).toBeVisible();
  const box = await qr.boundingBox();
  expect(box.width, 'the QR code is big enough to scan').toBeGreaterThanOrEqual(96);
});

Then('the phone gates section lists the steps to reach the gates page from the phone', async ({ e2e }) => {
  const steps = section(e2e.window).getByTestId('phone-setup-steps');
  await expect(steps).toBeVisible();
  expect(await steps.getByRole('listitem').count()).toBeGreaterThanOrEqual(2);
});

Then("the steps give the gates page's address", async ({ e2e }) => {
  await expect(section(e2e.window).getByTestId('phone-setup-steps')).toContainText(/https?:\/\/[\w.-]+:\d+/);
});

Then('the phone gates section lists the paired devices', async ({ e2e }) => {
  await expect(section(e2e.window).getByTestId('phone-devices')).toBeVisible();
});

Then('the paired devices list says no phone is paired yet', async ({ e2e }) => {
  const list = section(e2e.window).getByTestId('phone-devices');
  await expect(list).toContainText(/No phone is paired/i);
  await expect(list.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
});

// --- features/phone-gates.feature (#819): the phone's own gates page -------------------------------
// The phone is the served engine's browser window (e2e.window, features/support/served.js) on the
// gates page's address; the address and a one-time code come from the phonegates:pair channel, as
// Settings › Phone gates gets them (it also starts the page). Locators:
//   phone-gates-page     the page's <main> (existing)
//   phone-gate-choice    NEW: each choice link of the phone's gate page (leads to the confirmation)
//   the note field, the links and the pairing form by role and accessible name (existing)

const PHONE_TIMEOUT = 30000;
const TOKEN_KEY = 'multiagent-phone-token'; // the phone page's localStorage key for its device token
const ORDINALS = { first: 0, second: 1, third: 2 };

const phonePage = (e2e) => e2e.window.getByTestId('phone-gates-page');
const noteField = (e2e) => e2e.window.getByRole('textbox', { name: /^Note for the run/ });

// a pairing code from the engine → { code, link: <page address>/?pair=<code> }; starts the page
async function askPairing(e2e) {
  const pairing = await callEngine(e2e, 'phonegates:pair');
  expect(pairing.link, 'the engine gives the gates page\'s pairing link').toMatch(/^https?:\/\/[^/]+\/\?pair=/);
  e2e.phoneUrl = new URL(pairing.link).origin;
  return pairing;
}

Given('the gates page for phones is served', async ({ e2e }) => {
  await askPairing(e2e);
});

When('I pair my phone with the gates page', async ({ e2e }) => {
  const { link } = await askPairing(e2e);
  await e2e.window.goto(link);
  await expect(phonePage(e2e).getByRole('link', { name: 'Open the gate' }).first()).toBeVisible({ timeout: PHONE_TIMEOUT });
});

When('I open the gates page on my phone without pairing it', async ({ e2e }) => {
  expect(e2e.phoneUrl, 'the gates page is served').toBeTruthy();
  await e2e.window.goto(`${e2e.phoneUrl}/`);
  await expect(e2e.window.getByRole('textbox', { name: 'Pairing code' })).toBeVisible({ timeout: PHONE_TIMEOUT });
});

// each code is sent and answered before the next; a wrong code is never one the engine handed out
When('I enter {int} wrong pairing code(s) on my phone', async ({ e2e }, attempts) => {
  const page = e2e.window;
  const button = page.getByRole('button', { name: 'Pair this phone' });
  for (let i = 0; i < attempts; i += 1) {
    await page.getByRole('textbox', { name: 'Pairing code' }).fill(`WRONG${String(i).padStart(3, '0')}`);
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/pair');
    await button.click();
    await answered;
    await expect(button).toBeEnabled();
  }
});

When('I open the waiting gate on my phone', async ({ e2e }) => {
  await phonePage(e2e).getByRole('link', { name: 'Open the gate' }).first().click();
  await expect(phonePage(e2e).getByTestId('phone-gate-choice').first()).toBeVisible({ timeout: PHONE_TIMEOUT });
});

When('I pick the gate\'s {word} choice on my phone', async ({ e2e }, ordinal) => {
  expect(ordinal in ORDINALS, `"${ordinal}" is one of ${Object.keys(ORDINALS).join(', ')}`).toBe(true);
  const choices = phonePage(e2e).getByTestId('phone-gate-choice');
  await expect(choices.nth(ORDINALS[ordinal])).toBeVisible({ timeout: PHONE_TIMEOUT });
  await choices.nth(ORDINALS[ordinal]).click();
  await expect(noteField(e2e)).toBeVisible({ timeout: PHONE_TIMEOUT });
});

When('I write the note {string} on my phone', async ({ e2e }, note) => {
  await noteField(e2e).fill(note);
  // the page says the draft is kept in this tab (the field's description) before leaving it
  await expect(noteField(e2e)).toHaveAccessibleDescription(/Draft saved/);
});

When('I go back to the gate on my phone', async ({ e2e }) => {
  await phonePage(e2e).getByRole('link', { name: 'Back to the gate' }).click();
  await expect(phonePage(e2e).getByTestId('phone-gate-choice').first()).toBeVisible({ timeout: PHONE_TIMEOUT });
});

When('I reload the page on my phone', async ({ e2e }) => {
  await e2e.window.reload();
  await expect(phonePage(e2e)).toBeVisible({ timeout: PHONE_TIMEOUT });
});

// nothing pre-filled: the page may still say a note was written for another choice
Then('the note on my phone is empty', async ({ e2e }) => {
  await expect(noteField(e2e)).toHaveValue('');
});

Then('the note on my phone reads {string}', async ({ e2e }, note) => {
  await expect(noteField(e2e)).toHaveValue(note);
});

// the page is visible again (visibilitychange) or the browser is back online ('online'); the window
// may be hidden in E2E, so the step sets document.hidden itself: hidden, then visible again
When('I come back to the gates page on my phone after {string}', async ({ e2e }, interruption) => {
  const events = { 'switching to another tab': 'visibility', 'losing the connection': 'online' };
  expect(interruption in events, `"${interruption}" is one of ${Object.keys(events).map((k) => `"${k}"`).join(', ')}`).toBe(true);
  await e2e.window.evaluate((kind) => {
    const setHidden = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    setHidden(true);
    if (kind === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
    else window.dispatchEvent(new Event('offline'));
    setHidden(false);
    if (kind === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
    else window.dispatchEvent(new Event('online'));
  }, events[interruption]);
  // the page's read after coming back has run (a re-read needs no answer from the engine when unpaired)
  await e2e.window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
});

Then('my phone says {string}', async ({ e2e }, text) => {
  await expect(phonePage(e2e).getByRole('alert')).toContainText(text, { timeout: PHONE_TIMEOUT });
});

Then('my phone still says {string}', async ({ e2e }, text) => {
  await expect(phonePage(e2e).getByRole('alert')).toContainText(text);
});

Then('my phone does not say it is not paired', async ({ e2e }) => {
  await expect(phonePage(e2e)).not.toContainText(/not paired/i);
});

Then('my phone keeps no pairing', async ({ e2e }) => {
  expect(await e2e.window.evaluate((key) => localStorage.getItem(key), TOKEN_KEY), 'no device token is stored').toBeNull();
});
