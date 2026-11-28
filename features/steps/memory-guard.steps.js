// Steps of features/settings.feature's memory guard scenarios (#129: the memory guard is off by default).
// Settings › Execution › Memory guard (#276): the switch is data-testid="memory-guard-enabled" (a checkbox,
// aria-label "Memory guard on"), the fields data-testid="memory-guard-limit" / "memory-guard-floor"; the
// fields show only while the guard is on. Turning the switch saves the group (settings.memoryGuard).
// The other memory guard steps ("the memory guard is on", "the memory guard's {word} is {int}", ...) are
// in app.steps.js; a workspace that never saved it is app.steps.js's
// 'the workspace never saved its "memory guard setting"'.

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const memoryGuard = (page, field) => page.getByTestId(`memory-guard-${field}`);

Then('the memory guard is off', async ({ e2e }) => {
  await expect(memoryGuard(e2e.window, 'enabled')).toBeChecked({ checked: false, timeout: LOAD_TIMEOUT });
});

When('I turn the memory guard on', async ({ e2e }) => {
  const box = memoryGuard(e2e.window, 'enabled');
  await expect(box).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await box.setChecked(true);
  await expect(box).toBeChecked();
});

Then("the memory guard's limit and floor are hidden", async ({ e2e }) => {
  await expect(memoryGuard(e2e.window, 'limit')).toBeHidden();
  await expect(memoryGuard(e2e.window, 'floor')).toBeHidden();
});
