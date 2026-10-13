// Steps of features/settings.feature for the machine profile (#367): Settings › Execution ›
// Concurrent runs shows one line sizing parallel runs and test workers from this machine
// ("This machine: 20 threads, 32 GB → up to 5 runs at once, 2 test workers per run"), its state
// (auto | manual | unknown) and the "Use these values" / "back to auto" controls. Navigation reuses
// app.steps.js ("I open {string} in the sidebar", "I open the {string} settings tab", "I reload the app").
// The machine's figures vary (CI vs the owner's PC): the steps check the line's shape, never the numbers.
// data-testids: machine-profile-line (the line), machine-profile-state (data-state="auto|manual|unknown"),
// machine-profile-use ("Use these values" button), machine-profile-back-to-auto (the link).
// The manual value is the existing "Maximum concurrent runs" number input (aria-label).

const { expect } = require('@playwright/test');
const { Then, When } = require('./fixtures');

const LINE = /This machine: \d+ threads, \d+ GB → up to (\d+) runs? at once, \d+ test workers? per run/;
const line = (page) => page.getByTestId('machine-profile-line');
const state = (page) => page.getByTestId('machine-profile-state');
const maxRuns = (page) => page.getByRole('spinbutton', { name: 'Maximum concurrent runs', exact: true });

Then("Concurrent runs shows this machine's threads and memory, with the runs and test workers it allows", async ({ e2e }) => {
  await expect(line(e2e.window)).toBeVisible();
  await expect(line(e2e.window)).toHaveText(LINE);
});

// name: auto | manual | unknown
Then('the machine profile is in {word} state', async ({ e2e }, name) => {
  await expect(state(e2e.window)).toHaveAttribute('data-state', name);
});

// a control by its name: a button or a link ("back to auto" may be either)
const control = (page, name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }));

Then('the machine profile offers {string}', async ({ e2e }, name) => {
  await expect(control(e2e.window, name).first()).toBeVisible();
});

Then('the machine profile does not offer {string}', async ({ e2e }, name) => {
  await expect(line(e2e.window)).toBeVisible();
  await expect(control(e2e.window, name).filter({ visible: true })).toHaveCount(0);
});

When("I use the machine profile's values", async ({ e2e }) => {
  await e2e.window.getByTestId('machine-profile-use').click();
});

When('I go back to auto in the machine profile', async ({ e2e }) => {
  await e2e.window.getByTestId('machine-profile-back-to-auto').click();
});

// fills the field and leaves it (Tab): the Execution tab saves on change
When('I set the maximum concurrent runs to {int}', async ({ e2e }, value) => {
  const input = maxRuns(e2e.window);
  await input.fill(String(value));
  await input.press('Tab');
});

Then('the maximum concurrent runs is {int}', async ({ e2e }, value) => {
  await expect(maxRuns(e2e.window)).toHaveValue(String(value));
});

Then("the maximum concurrent runs is the machine profile's runs at once", async ({ e2e }) => {
  await expect(line(e2e.window)).toHaveText(LINE);
  const runs = (await line(e2e.window).innerText()).match(LINE)[1];
  await expect(maxRuns(e2e.window)).toHaveValue(runs);
});
