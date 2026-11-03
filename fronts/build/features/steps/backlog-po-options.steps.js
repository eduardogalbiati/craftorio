// Steps of fronts/build/features/product-owner.feature's #431 scenarios: the Product Owner drawer's foot
// ("Plan with [workflow]" and the workflow's options) takes less room. The main options (Mode, Unit
// tests, E2E tests, Screenshots) come first under small group labels (How it runs, Tests, Developer,
// Checks); the others wait behind a "Show more options" link (then "Show fewer options"). A chevron on
// the right of the "Plan with" row collapses the options to a one-line summary of the chosen values
// ("Automatic · Unit: Write and run · E2E: Write and run · Screenshots: All"); remembered per viewer.
// Reuses backlog.steps.js ("I open the Product Owner", "I switch the Product Owner to {string}",
// "I plan with the workflow {string}") and app.steps.js ("I open {string} in the sidebar").
//
// Assumes these data-testids (the developer adds them; skills/ui-conventions), inside the drawer
// (role=complementary "Product Owner"):
//   po-wf-toggle     the chevron button on the "Plan with" row (aria-expanded, a tooltip)
//   po-wf-summary    the one-line summary shown while the options are collapsed
//   po-workflow-options  the options' box (exists today; hidden while collapsed)
//   wf-more-toggle   the "Show more options" / "Show fewer options" link
//   wf-group-label   each small group label
// The options keep WorkflowInputs' markup: a field's label text, a pill choice a role=radiogroup named
// by its label. The drawer's close button is named "Close (Esc)". Locators are roles and data-testid only.

const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const wfToggle = (page) => poDrawer(page).getByTestId('po-wf-toggle');
const wfSummary = (page) => poDrawer(page).getByTestId('po-wf-summary');
const wfOptions = (page) => poDrawer(page).getByTestId('po-workflow-options');
const moreToggle = (page) => wfOptions(page).getByTestId('wf-more-toggle');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (text) => new RegExp(`^\\s*${escapeRe(text)}\\s*$`);
// a field's label inside the options, in view
const fieldLabel = (page, name) => wfOptions(page).getByText(name, { exact: true }).filter({ visible: true });

Then("the plan's options show {string}, {string}, {string} and {string}", async ({ e2e }, a, b, c, d) => {
  for (const name of [a, b, c, d]) await expect(fieldLabel(e2e.window, name).first(), `the option "${name}"`).toBeVisible();
});

Then("the plan's options show {string}", async ({ e2e }, name) => {
  await expect(fieldLabel(e2e.window, name).first(), `the option "${name}"`).toBeVisible();
});

Then("the plan's options do not show {string}", async ({ e2e }, name) => {
  await expect(wfOptions(e2e.window)).toBeVisible();
  await expect(fieldLabel(e2e.window, name), `the option "${name}" waits behind "Show more options"`).toHaveCount(0);
});

Then("the plan's options are grouped under {string} and {string}", async ({ e2e }, a, b) => {
  const labels = wfOptions(e2e.window).getByTestId('wf-group-label');
  for (const name of [a, b]) await expect(labels.filter({ hasText: exactly(name) }).first(), `the group label "${name}"`).toBeVisible();
});

When("I click {string} in the plan's options", async ({ e2e }, label) => {
  const link = moreToggle(e2e.window);
  await expect(link).toHaveText(exactly(label));
  await link.click();
});

Then("the plan's options offer {string}", async ({ e2e }, label) => {
  await expect(moreToggle(e2e.window)).toHaveText(exactly(label));
});

When("I collapse the plan's options", async ({ e2e }) => {
  const toggle = wfToggle(e2e.window);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

When("I expand the plan's options", async ({ e2e }) => {
  const toggle = wfToggle(e2e.window);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(wfOptions(e2e.window)).toBeVisible();
});

// collapsed: the options' body hidden, the "Plan with" row (its workflow choice and the chevron, with
// its tooltip) still in view
Then("the plan's options are hidden, the {string} row stays", async ({ e2e }, row) => {
  const page = e2e.window;
  expect(row).toBe('Plan with');
  await expect(wfOptions(page)).toBeHidden();
  await expect(poDrawer(page).getByTestId('po-workflow')).toBeVisible();
  const toggle = wfToggle(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('title', /\S/);
});

Then("the plan's summary shows {string}", async ({ e2e }, text) => {
  const summary = wfSummary(e2e.window);
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(text);
});

Then('{string} is still chosen for {string} in the plan\'s options', async ({ e2e }, option, field) => {
  const group = wfOptions(e2e.window).getByRole('radiogroup', { name: field });
  await expect(group.getByRole('radio', { name: option, exact: true })).toHaveAttribute('aria-checked', 'true');
});

When('I close the Product Owner', async ({ e2e }) => {
  const drawer = poDrawer(e2e.window);
  await drawer.getByRole('button', { name: /^Close/ }).first().click();
  await expect(drawer).toBeHidden();
});
