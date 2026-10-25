// Steps of features/account.feature (#315): the account only counts the people using the app (no
// trial, no plan). The E2E app runs with sign-in off (MULTIAGENT_AUTH=off), so the steps push, from
// the Electron main process, the account state src/host/main.js broadcasts on `auth:changed`
// ({ user, required, configured, providers, signingIn }), as a real sign-in would. A state pushed
// before the window's first authState() answer could be overwritten by it: a push is retried until
// the UI shows it.
// Locators are roles and data-testid only (skills/ui-conventions). data-testids:
// login-screen (the sign-in screen), account-chip (the header's account button, #account-btn).
// The account panel is the role="dialog" named "Account".

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sidebar = (page) => page.getByRole('navigation');
const entryName = (name) => new RegExp(`^${escapeRe(name)}(\\s+(☾\\s+)?\\d+)?$`);
const navItem = (page, name) => sidebar(page).getByRole('button', { name: entryName(name) });
const loginScreen = (page) => page.getByTestId('login-screen');
const accountChip = (page) => page.getByTestId('account-chip');
const accountPanel = (page) => page.getByRole('dialog', { name: 'Account', exact: true });

// a subscription trial or plan, in any wording the old UI used ("Trial · 5 days left", "Pro plan.",
// "Free trial until …", "Trial ended"); "your CLI subscriptions" (cost notes) is not about the account
const TRIAL_OR_PLAN = /\btrial\b|\b(pro|free|paid) plan\b|\bdays? left\b|credit card|checking your subscription/i;

const PROVIDERS = [{ id: 'github', name: 'GitHub', enabled: true }, { id: 'google', name: 'Google', enabled: false }];

// a trial record as an old account server still sends it: the UI must ignore it
const oldEntitlement = (active) => ({
  plan: 'trial', active, daysLeft: active ? 5 : 0, offline: false,
  trialEndsAt: new Date(Date.now() + (active ? 5 : -2) * 86400000).toISOString(),
});

async function pushAccountState(e2e, state, shown) {
  await expect(navItem(e2e.window, 'Home')).toBeVisible({ timeout: 30000 });
  await expect(async () => {
    await e2e.app.evaluate(({ BrowserWindow }, s) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('auth:changed', s);
    }, state);
    await expect(shown()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

const signedIn = (name, email, entitlement) => ({
  user: { id: 'e2e-user', name, email }, required: true, configured: true, signingIn: false, providers: PROVIDERS, entitlement,
});

When('the app asks me to sign in', async ({ e2e }) => {
  await pushAccountState(e2e, { user: null, required: true, configured: true, signingIn: false, providers: PROVIDERS }, () => loginScreen(e2e.window));
});

Given('I am signed in as {string} with the email {string}', async ({ e2e }, name, email) => {
  await pushAccountState(e2e, signedIn(name, email, oldEntitlement(true)), () => accountChip(e2e.window));
});

Given('I am signed in as {string} with the email {string} and an ended trial', async ({ e2e }, name, email) => {
  await pushAccountState(e2e, signedIn(name, email, oldEntitlement(false)), () => accountChip(e2e.window));
});

// The issue's example wording: "Create a free account. It only tells us how many people use the app."
Then('the sign-in screen says the account only tells how many people use the app', async ({ e2e }) => {
  const screen = loginScreen(e2e.window);
  await expect(screen).toBeVisible();
  await expect(screen).toContainText(/free account/i);
  await expect(screen).toContainText(/how many people use the app/i);
  await expect(screen.getByRole('button', { name: /Continue with GitHub/ })).toBeVisible();
});

Then('the sign-in screen does not mention a trial, a plan or a credit card', async ({ e2e }) => {
  const screen = loginScreen(e2e.window);
  await expect(screen).toBeVisible();
  await expect(screen).not.toContainText(TRIAL_OR_PLAN);
  await expect(screen).not.toContainText(/7-day/i);
});

Then('the account chip shows {string} and nothing else', async ({ e2e }, name) => {
  const chip = accountChip(e2e.window);
  await expect(chip).toBeVisible();
  // the avatar's initial is aria-hidden decoration: the chip's readable text is the name alone
  await expect(chip).toContainText(name);
  await expect(chip).not.toContainText(TRIAL_OR_PLAN);
  await expect(chip).not.toContainText(/\bpro\b|account unavailable/i);
  const text = (await chip.innerText()).replace(/\s+/g, ' ').trim();
  const initial = name.trim()[0].toUpperCase();
  expect([name, `${initial} ${name}`, `${initial}${name}`], 'the chip reads the name (after the avatar\'s initial)').toContain(text);
});

When('I open the account chip', async ({ e2e }) => {
  await accountChip(e2e.window).click();
  await expect(accountPanel(e2e.window)).toBeVisible();
});

Then('the account panel shows {string} and {string} without a trial or a plan', async ({ e2e }, name, email) => {
  const panel = accountPanel(e2e.window);
  await expect(panel).toContainText(name);
  await expect(panel).toContainText(email);
  await expect(panel.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(panel).not.toContainText(TRIAL_OR_PLAN);
});

// every screen the menu opens (a group's title only collapses its group: skipped); the whole window's
// visible text (header, account chip, sidebar, the screen) is read on each
Then('no screen of the menu mentions a trial or a plan', async ({ e2e }) => {
  const page = e2e.window;
  await page.keyboard.press('Escape');
  const items = [];
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    if ((await button.getAttribute('aria-expanded')) !== null) continue;
    items.push((await button.innerText()).replace(/\s+\d+$/, '').trim());
  }
  expect(items.length, 'the menu has screens').toBeGreaterThan(5);
  for (const item of items) {
    await navItem(page, item).click();
    await expect(navItem(page, 'Home')).toBeVisible();
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, `the window on "${item}"`).not.toMatch(TRIAL_OR_PLAN);
  }
});
