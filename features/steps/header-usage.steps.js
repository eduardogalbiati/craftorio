// Steps of features/23-24-ptbr-onboarding-craftorio-name.feature (#24): the header's usage counter (the
// existing data-testid="usage-widget" button in the banner, packages/ui-kit/usage-widget.js) names the
// product, Craftorio, in its tooltip (the button's title, what hovering it shows), never the old
// "Orchestrator" / "Orquestrador". The tooltip is read once the counter has loaded its figures
// (aria-busy="false"). The interface language is chosen with settings-language.steps.js. Locators are
// roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const counter = (page) => page.getByRole('banner').getByTestId('usage-widget');

When('I hover over the usage counter in the header', async ({ e2e }) => {
  const button = counter(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAttribute('aria-busy', 'false', { timeout: LOAD_TIMEOUT });
  await button.hover();
});

Then("the usage counter's tooltip says {string}", async ({ e2e }, text) => {
  await expect.poll(async () => (await counter(e2e.window).getAttribute('title')) || '', {
    message: `the usage counter's tooltip says "${text}"`, timeout: LOAD_TIMEOUT,
  }).toContain(text);
});

Then("the usage counter's tooltip does not say {string}", async ({ e2e }, text) => {
  const title = (await counter(e2e.window).getAttribute('title')) || '';
  expect(title, `the usage counter's tooltip "${title}"`).not.toContain(text);
});
