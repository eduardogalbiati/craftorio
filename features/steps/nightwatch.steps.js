// Steps of features/nightwatch.feature (#239): the Night watch screen's permissions (what the
// Oracle may do without asking), ticked, saved and found again. Locators are roles and data-testid
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
