// Steps of features/settings.feature's phone gates (#226): Settings › Phone gates, the pairing code
// and QR code for the gates page the app serves, the setup steps and the list of paired devices.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

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
