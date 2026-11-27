// Steps of features/agents-window.feature (#263): the Agents window, a second Electron window with
// the three agents' shared chat (packages/ui-kit/agent-chat.js). Opening a drawer reuses oracle.steps.js,
// backlog.steps.js and agent-inbox.steps.js; the drawer's answer, agent-chat.steps.js. Locators are
// roles and data-testid only (skills/ui-conventions):
//   agent-chat-open-window   in each drawer, the "Open in a window" button (Ctrl+Shift+A does the same)
//   agents-rail              in the window, the rail (a nav named "Agents") of agents-rail-item
//                            (data-agent: oracle | product-owner | supervisor; named by the agent;
//                            agents-rail-unread, data-busy="true" while answering)
//   agents-window-pane       the selected agent's pane: agents-window-header names the agent, and the
//                            shared chat (agent-chat with data-agent, agent-chat-input, agent-chat-send,
//                            agent-chat-messages, agent-chat-message)
// The window is found among the app's windows (e2e.app.windows()) by its rail, after the click or the
// shortcut, and kept on the scenario's fixture as e2e.agentsWindow. The fixture closes the app, and
// every window with it, after the scenario (fixtures.js): a scenario closes it only to check what that leaves (#76).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const AGENT_IDS = { Oracle: 'oracle', 'Product Owner': 'product-owner', Supervisor: 'supervisor' };
// the words each simulated agent's answer carries (agent-chat.steps.js, no model call)
const ANSWERS = { oracle: /Simulated Oracle/, 'product-owner': /Product Owner · /, supervisor: /Simulated supervisor/ };
// each agent's drawer in the main window (a closed drawer is aria-hidden, so only the open one matches)
const DRAWERS = {
  Oracle: (page) => page.getByRole('complementary', { name: 'Oracle', exact: true }),
  'Product Owner': (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true }),
  Supervisor: (page) => page.getByTestId('svc-drawer'),
};

const agentId = (name) => {
  const id = AGENT_IDS[name];
  expect(id, `a known agent (${Object.keys(AGENT_IDS).join(', ')})`).toBeTruthy();
  return id;
};
const drawer = (page, name) => {
  const of = DRAWERS[name];
  expect(of, `a known drawer (${Object.keys(DRAWERS).join(', ')})`).toBeTruthy();
  return of(page);
};

const rail = (win) => win.getByTestId('agents-rail');
const railItems = (win) => rail(win).getByTestId('agents-rail-item');
const railItem = (win, name) => rail(win).locator(`[data-testid="agents-rail-item"][data-agent="${agentId(name)}"]`);
const pane = (win) => win.getByTestId('agents-window-pane');

function agentsWindow(e2e) {
  expect(e2e.agentsWindow, 'the Agents window was opened in this scenario').toBeTruthy();
  return e2e.agentsWindow;
}

// the app's window, other than the main one, whose rail shows (a window not loaded yet does not match)
async function findAgentsWindow(e2e) {
  for (const win of e2e.app.windows()) {
    if (win === e2e.window || win.isClosed()) continue;
    if (await rail(win).isVisible().catch(() => false)) return win;
  }
  return null;
}

async function openAgentsWindow(e2e, trigger) {
  await trigger();
  await expect.poll(async () => !!(await findAgentsWindow(e2e)), { timeout: LOAD_TIMEOUT, message: 'the Agents window opened' }).toBe(true);
  e2e.agentsWindow = await findAgentsWindow(e2e);
  await e2e.agentsWindow.waitForLoadState('domcontentloaded');
}

When('I open the Agents window from the {string} drawer', async ({ e2e }, name) => {
  const button = drawer(e2e.window, name).getByTestId('agent-chat-open-window');
  await expect(button).toBeVisible();
  await openAgentsWindow(e2e, () => button.click());
});

When('I open the Agents window with Ctrl+Shift+A', async ({ e2e }) => {
  await openAgentsWindow(e2e, () => e2e.window.keyboard.press('Control+Shift+A'));
});

Then('the Agents window opens', async ({ e2e }) => {
  const win = agentsWindow(e2e);
  await expect(rail(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(win.getByRole('navigation', { name: 'Agents', exact: true })).toBeVisible();
});

Then('the Agents window\'s rail lists {string}, {string} and {string} in that order', async ({ e2e }, a, b, c) => {
  const items = railItems(agentsWindow(e2e));
  await expect(items).toHaveCount(3, { timeout: LOAD_TIMEOUT });
  for (const [i, name] of [a, b, c].entries()) {
    await expect(items.nth(i), `the rail's entry ${i + 1}`).toHaveAttribute('data-agent', agentId(name));
    await expect(items.nth(i), `the rail's entry ${i + 1}`).toHaveAccessibleName(name);
  }
});

Then('the Agents window shows the {string} conversation', async ({ e2e }, name) => {
  const win = agentsWindow(e2e);
  await expect(pane(win).getByTestId('agents-window-header')).toContainText(name, { timeout: LOAD_TIMEOUT });
  await expect(pane(win).locator(`[data-testid="agent-chat"][data-agent="${agentId(name)}"]`)).toBeVisible();
});

When('I pick {string} in the Agents window', async ({ e2e }, name) => {
  const win = agentsWindow(e2e);
  await railItem(win, name).click();
  await expect(pane(win).getByTestId('agents-window-header')).toContainText(name, { timeout: LOAD_TIMEOUT });
});

When('I send the message {string} in the Agents window', async ({ e2e }, message) => {
  const chat = pane(agentsWindow(e2e));
  const input = chat.getByTestId('agent-chat-input');
  await expect(input).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await input.fill(message);
  const send = chat.getByTestId('agent-chat-send');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(chat.getByTestId('agent-chat-messages')).toContainText(message);
});

// one conversation, two places: the drawer open in the main window shows the message sent from the window
Then('the main window\'s {string} conversation shows {string}', async ({ e2e }, name, message) => {
  await expect(drawer(e2e.window, name).getByTestId('agent-chat-messages')).toContainText(message, { timeout: LOAD_TIMEOUT });
});

Then('the Agents window\'s conversation answers', async ({ e2e }) => {
  const chat = pane(agentsWindow(e2e)).getByTestId('agent-chat');
  const id = await chat.getAttribute('data-agent');
  const answer = ANSWERS[id];
  expect(answer, `a known agent in the pane (${id})`).toBeTruthy();
  await expect(chat.getByTestId('agent-chat-messages')).toContainText(answer, { timeout: LOAD_TIMEOUT });
  await expect(chat.getByTestId('agent-chat-send')).toBeEnabled({ timeout: LOAD_TIMEOUT });
});

// #77: the header's model (data-testid="agents-window-model", new: the model span of headerHtml in
// packages/ui-kit/agents-window.js) is the one the Oracle's status in the pane shows: its badge
// data-testid="oracle-model" is titled with the model id, then ", effort <effort>" when set.
const headerModel = (win) => pane(win).getByTestId('agents-window-header').getByTestId('agents-window-model');
const statusModel = (win) => pane(win).getByTestId('oracle-model');
const isStatusModel = (title, model) => !!model && (title === model || title.startsWith(`${model},`));

Then('the Agents window\'s header shows the model {string}', async ({ e2e }, model) => {
  await expect(headerModel(agentsWindow(e2e))).toHaveText(model, { timeout: LOAD_TIMEOUT });
});

Then('the Agents window\'s header shows the model the Oracle\'s status shows', async ({ e2e }) => {
  const win = agentsWindow(e2e);
  await expect(statusModel(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(headerModel(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const model = (await headerModel(win).textContent() || '').trim();
  const title = (await statusModel(win).getAttribute('title')) || '';
  expect(isStatusModel(title, model), `the header's model "${model}" is the Oracle's status model ("${title}")`).toBe(true);
});

// never a model the Oracle does not use: no model in the header while the status shows none, and the
// status's model as soon as it shows one (checked right away, so before the Oracle's state loads too)
Then('the Agents window\'s header shows no model but the Oracle\'s', async ({ e2e }) => {
  const win = agentsWindow(e2e);
  const check = async () => {
    const shown = await headerModel(win).count();
    if (!shown) return true;
    const model = (await headerModel(win).first().textContent() || '').trim();
    const title = (await statusModel(win).count()) ? (await statusModel(win).first().getAttribute('title')) || '' : '';
    return shown === 1 && isStatusModel(title, model);
  };
  expect(await check(), 'the header shows no model, or the Oracle\'s status model').toBe(true);
  await expect(statusModel(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(check, { timeout: LOAD_TIMEOUT, message: 'the header shows the Oracle\'s status model only' }).toBe(true);
  await expect(headerModel(win)).toHaveCount(1);
});

// #76: closed as its title bar's X does (the window's own close), and gone from the app's windows
When('I close the Agents window', async ({ e2e }) => {
  const win = agentsWindow(e2e);
  const native = await e2e.app.browserWindow(win);
  await native.evaluate((w) => w.close());
  await expect.poll(() => e2e.app.windows().includes(win), { timeout: LOAD_TIMEOUT, message: 'the Agents window closed' }).toBe(false);
  e2e.agentsWindow = null;
});

// modelled on "the board looks like the baseline" (backlog.steps.js): the whole second window
Then('the Agents window looks like the baseline {string}', async ({ e2e }, name) => {
  const win = agentsWindow(e2e);
  await expect(rail(win)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(win).toHaveScreenshot(name);
});
