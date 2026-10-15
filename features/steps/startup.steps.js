// Steps of features/app.feature's startup scenarios (#389): the window shows and Home draws from the
// index before any slow read; the top bar's usage widget and 24/7 chip load after the first paint and
// show a loading state meanwhile; the app stays responsive. A step's "within N seconds" counts from
// the moment the step starts (right after `Given the app is open`, i.e. the window's DOM loaded).
// Locators are roles and data-testid only (skills/ui-conventions):
//   home-flow-strip      Home's flow overview (features/steps/home.steps.js)
//   backlog-board / backlog-list   the Backlog screen
//   usage-widget         the top bar's usage button ("<tokens> tok · $<cost>" once loaded)
//   occupancy-chip       the top bar's 24/7 chip ("24/7 · …" once loaded)
// While a widget is loading it is visible with aria-busy="true"; loaded, aria-busy is absent or "false".

const { expect } = require('@playwright/test');
const { Then } = require('./fixtures');

const WIDGETS = {
  'usage widget': { testId: 'usage-widget', loaded: /\d+(\.\d+)?[KMB]?\s*tok\s*·\s*\$\d/ },
  '24/7 chip': { testId: 'occupancy-chip', loaded: /24\/7\s*·\s*\S/ },
};
const widget = (name) => {
  const found = WIDGETS[name];
  if (!found) throw new Error(`unknown top bar widget "${name}" (one of ${Object.keys(WIDGETS).join(', ')})`);
  return found;
};

Then('Home shows its overview within {int} seconds', async ({ e2e }, seconds) => {
  await expect(e2e.window.getByTestId('home-flow-strip')).toBeVisible({ timeout: seconds * 1000 });
});

Then('the Backlog screen is shown within {int} seconds', async ({ e2e }, seconds) => {
  const page = e2e.window;
  await expect(page.getByTestId('backlog-board').or(page.getByTestId('backlog-list')).first()).toBeVisible({ timeout: seconds * 1000 });
});

// right after the first paint: the widget is on screen, either loading (aria-busy) or with its
// figures; never hidden or blank while its data is read
Then('the top bar\'s {string} shows that it is loading or its figures', async ({ e2e }, name) => {
  const { testId, loaded } = widget(name);
  const el = e2e.window.getByTestId(testId);
  await expect(el, `the ${name}`).toBeVisible({ timeout: 3000 });
  const busy = await el.getAttribute('aria-busy');
  const text = (await el.innerText()).trim();
  expect(busy === 'true' || loaded.test(text), `the ${name} is loading or shows its figures (aria-busy=${busy}, text "${text}")`).toBe(true);
});

Then('the top bar\'s {string} then shows its figures', async ({ e2e }, name) => {
  const { testId, loaded } = widget(name);
  const el = e2e.window.getByTestId(testId);
  await expect(el, `the ${name}`).not.toHaveAttribute('aria-busy', 'true');
  await expect(el, `the ${name}`).toHaveText(loaded);
});
