// Steps of features/agents.feature (#297): the Agents screen's workflow agents, their "Customize
// look" editor with its full-size robot preview, the robots on their cards painted in their role
// colour, and the Analytics Agents tab's small card robots. Opening the screen, Home's tabs and
// Analytics' tabs reuse app.steps.js, home.steps.js and run.steps.js. Locators are roles and
// data-testid only (skills/ui-conventions):
//   agent-card           an agent's card on the Agents screen (data-id: the agent's id; a workflow's
//                        agent is `workflow:<file>:<agent key>`)
//   agent-card-robot     inside it, the card's robot (data-color: the colour it is painted in, the
//                        role's `color` of the workflow YAML while the look was never customised)
//   agent-editor-robot   the agent editor's robot preview
//   agents-card-robot    the robot of an Analytics › Agents card (agents-card-<id>, analytics-agents.steps.js)
// The editor's title is a heading; its prompt a textbox named "Prompt …"; it closes with "Cancel".

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// a desktop window's preview: 280 px, give or take the rounding of borders and zoom
const TOLERANCE = 10;
const ANALYTICS_IDS = { Oracle: 'oracle', 'Product Owner': 'product-owner', Supervisor: 'supervisor' };

const workflowCard = (page, key, file) => page.locator(`[data-testid="agent-card"][data-id="workflow:${file}:${key}"]`);
const cardRobot = (page, key, file) => workflowCard(page, key, file).getByTestId('agent-card-robot');
const editorRobot = (page) => page.getByTestId('agent-editor-robot');

async function expectSize(locator, w, h, what) {
  await expect(locator, what).toBeVisible({ timeout: LOAD_TIMEOUT });
  const box = await locator.boundingBox();
  expect(box, `${what} has a size`).toBeTruthy();
  expect(box.width, `${what}'s width (${box.width})`).toBeGreaterThanOrEqual(w - TOLERANCE);
  expect(box.width, `${what}'s width (${box.width})`).toBeLessThanOrEqual(w + TOLERANCE);
  expect(box.height, `${what}'s height (${box.height})`).toBeGreaterThanOrEqual(h - TOLERANCE);
  expect(box.height, `${what}'s height (${box.height})`).toBeLessThanOrEqual(h + TOLERANCE);
}

Then('the workflow agent {string} of {string} offers {string} and not {string}', async ({ e2e }, key, file, shown, gone) => {
  const card = workflowCard(e2e.window, key, file);
  await card.scrollIntoViewIfNeeded({ timeout: LOAD_TIMEOUT });
  await expect(card.getByRole('button', { name: shown, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
});

When('I click {string} on the workflow agent {string} of {string}', async ({ e2e }, button, key, file) => {
  const card = workflowCard(e2e.window, key, file);
  await card.scrollIntoViewIfNeeded({ timeout: LOAD_TIMEOUT });
  await card.getByRole('button', { name: button, exact: true }).click();
});

Then('the agent editor is titled {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the agent editor\'s robot preview is {int}x{int} pixels', async ({ e2e }, w, h) => {
  await expectSize(editorRobot(e2e.window), w, h, 'the agent editor\'s robot preview');
});

Then('the agent editor\'s prompt is read-only', async ({ e2e }) => {
  const prompt = e2e.window.getByRole('textbox', { name: /^Prompt\b/ }).filter({ visible: true }).first();
  await expect(prompt).toBeVisible();
  await expect(prompt).not.toBeEditable();
});

When('I close the agent editor', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('button', { name: 'Cancel', exact: true }).filter({ visible: true }).first().click();
  await expect(editorRobot(page)).toBeHidden();
});

Then('the robots of the Analytics agent cards {string}, {string} and {string} are {int}x{int} pixels', async ({ e2e }, a, b, c, w, h) => {
  for (const name of [a, b, c]) {
    const id = ANALYTICS_IDS[name];
    expect(id, `a known Analytics agent (${Object.keys(ANALYTICS_IDS).join(', ')})`).toBeTruthy();
    await expectSize(e2e.window.getByTestId(`agents-card-${id}`).getByTestId('agents-card-robot'), w, h, `the robot of the ${name} card`);
  }
});

Then('the card robot of the workflow agent {string} of {string} is painted {string}', async ({ e2e }, key, file, color) => {
  const robot = cardRobot(e2e.window, key, file);
  await robot.scrollIntoViewIfNeeded({ timeout: LOAD_TIMEOUT });
  await expect(robot).toHaveAttribute('data-color', new RegExp(`^${color}$`, 'i'));
});

// the drawings themselves differ, not only their data-color
Then('the card robots of the workflow agents {string} and {string} of {string} look different', async ({ e2e }, k1, k2, file) => {
  const page = e2e.window;
  const markup = async (key) => {
    const robot = cardRobot(page, key, file);
    await expect(robot.locator('svg').first()).toBeAttached({ timeout: LOAD_TIMEOUT });
    // the svg's own ids (gradients, filters) differ per drawing: compare without them
    return (await robot.innerHTML()).replace(/\b(id|filter|fill|clip-path|mask)="url\(#[^)]*\)"/g, '').replace(/\bid="[^"]*"/g, '');
  };
  expect(await markup(k1), `${k1} and ${k2} draw the same robot`).not.toEqual(await markup(k2));
});
