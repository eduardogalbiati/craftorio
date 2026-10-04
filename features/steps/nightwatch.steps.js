// Steps of features/nightwatch.feature (#239): the Night watch screen's permissions (what the
// Oracle may do without asking), ticked, saved and found again; #278: Self-healing, its switch in
// Settings › Execution › Oracle and what the Night watch screen shows of it; #279: the "Apply merged
// fixes to this app" row under it. Locators are roles and data-testid
// only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the "What the Oracle may do without asking" card
const permissions = (page) => page.getByTestId('nw-permissions');
// a permission's checkbox: its label wraps the permission's name, what it does and its undo
const permission = (page, name) => permissions(page).getByRole('checkbox', { name: new RegExp(`^\\s*${escapeRe(name)}`) });

When('I tick the permission {string}', async ({ e2e }, name) => {
  const box = permission(e2e.window, name);
  await expect(box).not.toBeChecked();
  // the card re-renders on every change: click, then check the new state
  await box.click();
  await expect(permission(e2e.window, name)).toBeChecked();
});

When('I untick every permission', async ({ e2e }) => {
  const card = permissions(e2e.window);
  await expect(card.getByRole('checkbox').first()).toBeVisible();
  const ticked = card.getByRole('checkbox', { checked: true });
  for (let left = await ticked.count(); left > 0; left -= 1) {
    await ticked.first().click();
    await expect(ticked).toHaveCount(left - 1);
  }
});

When('I save the permissions', async ({ e2e }) => {
  const save = permissions(e2e.window).getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(save).toBeHidden();
});

Then('the permissions show when they were saved', async ({ e2e }) => {
  await expect(permissions(e2e.window).getByText(/Saved \d/)).toBeVisible();
});

Then('the permission {string} is ticked', async ({ e2e }, name) => {
  await expect(permission(e2e.window, name)).toBeChecked();
});

Then('no permission is ticked', async ({ e2e }) => {
  const card = permissions(e2e.window);
  await expect(card.getByRole('checkbox').first()).toBeVisible();
  await expect(card.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

// ---- Self-healing (#278) -------------------------------------------------------------------------------
// Settings › Execution › Oracle's first row: data-testid="oracle-self-healing" (the switch, a
// checkbox, saved on change like the rest of the tab) and data-testid="self-healing-permissions"
// ("What it may do alone (n of 10) ›", opens the Night watch's permissions checklist, nw-permissions).
// The Night watch screen: data-testid="nightwatch-switch" (the watch's switch, a checkbox) and
// data-testid="nightwatch-self-healing" ("Self-healing is on", in place of "On until hh:mm");
// data-testid="nw-never-allowed" holds the never-allowed items, locked (no checkbox that can be ticked).

const selfHealing = (page) => page.getByTestId('oracle-self-healing');
const watchSwitch = (page) => page.getByTestId('nightwatch-switch');

When('I turn Self-healing {word}', async ({ e2e }, state) => {
  const box = selfHealing(e2e.window);
  await expect(box).toBeEnabled();
  await box.setChecked(state === 'on');
  await expect(box).toBeChecked({ checked: state === 'on' });
});

Then('Self-healing is {word}', async ({ e2e }, state) => {
  await expect(selfHealing(e2e.window)).toBeChecked({ checked: state === 'on' });
});

When('I open what Self-healing may do alone', async ({ e2e }) => {
  const link = e2e.window.getByTestId('self-healing-permissions');
  await expect(link).toHaveText(/What it may do alone/);
  await link.click();
});

Then('the permissions checklist is shown', async ({ e2e }) => {
  await expect(permissions(e2e.window)).toBeVisible();
  await expect(permissions(e2e.window).getByRole('checkbox').first()).toBeVisible();
});

Then('the never-allowed item {string} is shown locked', async ({ e2e }, name) => {
  const card = permissions(e2e.window);
  await expect(card.getByTestId('nw-never-allowed').getByText(name, { exact: false })).toBeVisible();
  // locked: the checklist offers no checkbox for it that could be ticked
  await expect(card.getByRole('checkbox', { name: new RegExp(`^\s*${escapeRe(name)}`), disabled: false })).toHaveCount(0);
});

Then('the Night watch says {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('nightwatch-self-healing')).toHaveText(new RegExp(escapeRe(text)));
});

Then('the Night watch does not say {string}', async ({ e2e }, text) => {
  await expect(watchSwitch(e2e.window)).toBeAttached();
  await expect(e2e.window.getByTestId('nightwatch-self-healing').filter({ hasText: text })).toHaveCount(0);
});

Then('the Night watch shows no end time', async ({ e2e }) => {
  await expect(watchSwitch(e2e.window)).toBeChecked();
  await expect(e2e.window.getByText(/On until \d/)).toHaveCount(0);
});

Then('the Night watch is off', async ({ e2e }) => {
  await expect(watchSwitch(e2e.window)).not.toBeChecked();
});

// ---- Self-healing applies merged fixes to the app (#279) ---------------------------------------------
// Under the Self-healing row: data-testid="app-update-row" (the row), data-testid="app-update-switch"
// (its checkbox, accessible name "Apply merged fixes to this app"), data-testid="app-update-reason"
// (why it is disabled: "the packaged app updates with a new install" or "no project of this workspace
// is this app's repository"), data-testid="app-update-source" (the source line, only when it applies).

const appUpdateRow = (page) => page.getByTestId('app-update-row');

Then('the {string} switch is disabled', async ({ e2e }, name) => {
  // a switch is a checkbox named by its label (aria-label)
  const box = e2e.window.getByRole('checkbox', { name, exact: true });
  await expect(box).toBeVisible();
  await expect(box).toBeDisabled();
  await expect(box).not.toBeChecked();
});

Then('applying merged fixes to the app says {string}', async ({ e2e }, text) => {
  await expect(appUpdateRow(e2e.window).getByTestId('app-update-reason')).toContainText(text);
});

Then('applying merged fixes to the app names no source', async ({ e2e }) => {
  await expect(appUpdateRow(e2e.window)).toBeVisible();
  await expect(appUpdateRow(e2e.window).getByTestId('app-update-source')).toHaveCount(0);
});
