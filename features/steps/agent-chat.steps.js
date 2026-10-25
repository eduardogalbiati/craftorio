// Steps of features/agent-chat.feature (#274): the one chat shared by the Oracle's, the Product Owner's
// and the Supervisor's drawers (packages/ui-kit/agent-chat.js). The text box empties as soon as the owner
// clicks Send / Ask and the message shows in the conversation at once, before the answer.
// The shared component's markers (data-testid, new in #274), inside each agent's drawer:
//   agent-chat-input     the text box the owner types in
//   agent-chat-send      the Send / Ask button
//   agent-chat-messages  the conversation
// The simulated agents answer fast, so a click listener records the chat in the first frame after the
// click (window.__agentChatWatch): what the owner saw at once, whatever the answer's speed.
// Locators are roles and data-testid only (skills/ui-conventions).

const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');

// each agent's drawer in view (a closed drawer is aria-hidden, so only the open one matches), and the
// words its simulated answer carries (no model call)
const AGENTS = {
  Oracle: {
    drawer: (page) => page.getByRole('complementary', { name: 'Oracle', exact: true }),
    answer: /Simulated Oracle/,
  },
  'Product Owner': {
    drawer: (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true }),
    answer: /Product Owner · /,
  },
  Supervisor: {
    drawer: (page) => page.getByTestId('svc-drawer'),
    answer: /Simulated supervisor/,
  },
};

function agent(name) {
  const a = AGENTS[name];
  if (!a) throw new Error(`Unknown chat "${name}": one of ${Object.keys(AGENTS).join(', ')}`);
  return a;
}

const chatInput = (page, name) => agent(name).drawer(page).getByTestId('agent-chat-input');
const chatSend = (page, name) => agent(name).drawer(page).getByTestId('agent-chat-send');
const chatMessages = (page, name) => agent(name).drawer(page).getByTestId('agent-chat-messages');

When('I send the message {string} to the {string} chat', async ({ e2e }, message, name) => {
  const page = e2e.window;
  const drawer = agent(name).drawer(page);
  await expect(drawer).toBeVisible();
  const input = chatInput(page, name);
  await expect(input).toBeEnabled({ timeout: 30000 });
  // the watch: on the click on this drawer's Send (a window listener, after the app's own handlers and
  // a form's submit), the text box's value and whether the conversation shows the message, in the
  // next frame (what the owner sees at once)
  await drawer.evaluate((el, msg) => {
    const watch = { clicked: false, frame: null };
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const snap = () => {
      const input = el.querySelector('[data-testid="agent-chat-input"]');
      const log = el.querySelector('[data-testid="agent-chat-messages"]');
      return { value: input ? input.value : null, shown: !!log && norm(log.textContent).includes(norm(msg)) };
    };
    const onClick = (e) => {
      const send = e.target instanceof Element ? e.target.closest('[data-testid="agent-chat-send"]') : null;
      if (!send || !el.contains(send)) return;
      window.removeEventListener('click', onClick);
      watch.clicked = true;
      requestAnimationFrame(() => { watch.frame = snap(); });
    };
    window.addEventListener('click', onClick);
    window.__agentChatWatch = watch;
  }, message);
  await input.fill(message);
  const send = chatSend(page, name);
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => page.evaluate(() => window.__agentChatWatch?.frame ?? null), { message: 'the click on Send was seen' }).not.toBeNull();
});

const watchedFrame = (page) => page.evaluate(() => window.__agentChatWatch?.frame ?? null);

Then('the {string} chat\'s text box was empty as soon as I sent it', async ({ e2e }, name) => {
  agent(name);
  const frame = await watchedFrame(e2e.window);
  expect(frame, 'the chat was watched when I sent the message').not.toBeNull();
  expect(frame.value, `the ${name} chat's text box in the first frame after Send`).toBe('');
});

Then('my message {string} was in the {string} conversation as soon as I sent it', async ({ e2e }, message, name) => {
  agent(name);
  const frame = await watchedFrame(e2e.window);
  expect(frame, 'the chat was watched when I sent the message').not.toBeNull();
  expect(frame.shown, `"${message}" in the ${name} conversation in the first frame after Send`).toBe(true);
  await expect(chatMessages(e2e.window, name)).toContainText(message);
});

Then('the {string} chat answers', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(chatMessages(page, name)).toContainText(agent(name).answer, { timeout: 30000 });
  await expect(chatSend(page, name)).toBeEnabled({ timeout: 30000 });
});

// the answer does not put the sent text back in the box (only a refused or failed send does)
Then('the {string} chat\'s text box is still empty', async ({ e2e }, name) => {
  await expect(chatInput(e2e.window, name)).toHaveValue('');
});
