// #263: the Agents window in the renderer. Two seams, acceptance tests written before the code,
// through the whole page (test/agent-chat-page-harness.js):
// - from the main window: each agent drawer (Oracle #oracle-drawer, Product Owner #po-drawer,
//   Supervisor #svc-drawer) has a button [data-testid="agent-chat-open-window"] that calls
//   api.openAgentsWindow({ agent }) (channel agents-window:open); Ctrl+Shift+A does the same;
// - the window's page: window.AgentsWindow (src/renderer/agents-window.js, loaded with the page
//   scripts) with mount(root, { agent }) and register({ id, name, mount }): a rail
//   [data-testid="agents-rail"] (nav, aria-label "Agents") of [data-testid="agents-rail-item"][data-agent]
//   buttons (oracle, product-owner, supervisor, then the registered ones), each named after its agent,
//   with [data-testid="agents-rail-unread"] (the count) when it has unread answers and data-busy="true" while it
//   answers; a pane [data-testid="agents-window-pane"] with [data-testid="agents-window-header"] naming
//   the selected agent and its chat through the shared component ([data-testid="agent-chat"]).
// The chats are the same conversations as the drawers' (one conversation, two places).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle, deferred, part, openOracle, openSupervisor, openProductOwner } = require('./agent-chat-page-harness');

const BUILT_IN = ['oracle', 'product-owner', 'supervisor'];

// ---- the main window: a button in each drawer, a shortcut ----------------------------------------------

test('#263 the Oracle drawer has an "open in a window" button that asks the main process for the Oracle', async () => {
  const page = await openOracle({});
  part(page, '#oracle-drawer', 'agent-chat-open-window').click();
  await settle();
  const calls = page.callsTo('openAgentsWindow');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].agent, 'oracle');
});

test('#263 the Product Owner drawer has an "open in a window" button that asks for the Product Owner', async () => {
  const page = await openProductOwner({});
  part(page, '#po-drawer', 'agent-chat-open-window').click();
  await settle();
  const calls = page.callsTo('openAgentsWindow');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].agent, 'product-owner');
});

test('#263 the Supervisor drawer has an "open in a window" button that asks for the Supervisor', async () => {
  const page = await openSupervisor({});
  part(page, '#svc-drawer', 'agent-chat-open-window').click();
  await settle();
  const calls = page.callsTo('openAgentsWindow');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].agent, 'supervisor');
});

test('#263 Ctrl+Shift+A opens the Agents window once', async () => {
  const page = await loadPage({});
  page.dom.keydown(page.document.body, 'A', { ctrlKey: true, shiftKey: true });
  await settle();
  assert.equal(page.callsTo('openAgentsWindow').length, 1);
});

// ---- the window's page: AgentsWindow.mount / register ------------------------------------------------------

/** window.AgentsWindow, resolved inside the test (missing until agents-window.js loads with the page). */
function agentsWindow(page) {
  const aw = page.sandbox.AgentsWindow;
  assert.equal(typeof aw?.mount, 'function', 'src/renderer/agents-window.js defines window.AgentsWindow.mount (loaded by index.html)');
  assert.equal(typeof aw?.register, 'function', 'window.AgentsWindow.register');
  return aw;
}
async function mounted(page, opts) {
  const aw = agentsWindow(page);
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"aw-root\"></div>')");
  const root = page.$('#aw-root');
  aw.mount(root, opts);
  await settle();
  return root;
}
const railItems = (root) => root.querySelectorAll('[data-testid="agents-rail-item"]');
const railItem = (root, id) => {
  const el = root.querySelector(`[data-testid="agents-rail-item"][data-agent="${id}"]`);
  assert.ok(el, `the rail has the ${id} item`);
  return el;
};
const nameOf = (el) => el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el);
const pane = (root) => {
  const el = root.querySelector('[data-testid="agents-window-pane"]');
  assert.ok(el, 'the window has its pane');
  return el;
};
const paneChat = (root, id, name) => pane(root).querySelector(`[data-testid="agent-chat"][data-agent="${id}"], [data-testid="agent-chat"][data-agent="${name}"]`);
const inPane = (root, testid) => {
  const el = pane(root).querySelector(`[data-testid="${testid}"]`);
  assert.ok(el, `the pane has [data-testid="${testid}"]`);
  return el;
};

test('#263 the rail is a nav named Agents listing the Oracle, the Product Owner and the Supervisor in that order, each named', async () => {
  const page = await loadPage({});
  const root = await mounted(page);
  const rail = root.querySelector('[data-testid="agents-rail"]');
  assert.ok(rail, 'the rail');
  assert.equal(rail.tagName.toLowerCase(), 'nav');
  assert.equal(rail.getAttribute('aria-label'), 'Agents');
  const items = railItems(root);
  assert.deepEqual(items.map((i) => i.getAttribute('data-agent')), BUILT_IN);
  assert.deepEqual(items.map(nameOf), ['Oracle', 'Product Owner', 'Supervisor']);
});

test('#263 the Oracle is selected by default: the header names it and its chat is in the pane', async () => {
  const page = await loadPage({});
  const root = await mounted(page);
  assert.match(textOf(inPane(root, 'agents-window-header')), /Oracle/);
  assert.ok(paneChat(root, 'oracle', 'Oracle'), 'the Oracle\'s chat in the pane');
  inPane(root, 'agent-chat-input');
  inPane(root, 'agent-chat-send');
});

// The Product Owner's unread rule (backlog-po.js #149): an answer that arrives while the owner is not
// looking at the drawer (another screen) is unread until the drawer is in view again. (The Oracle's
// rule needs Oracle answers rendered, and their link decoration uses a TreeWalker test/mini-dom.js lacks.)
test('#263 the Product Owner rail item shows its unread answer (one answer arrived while the owner was on another screen)', async () => {
  const asked = deferred();
  const page = await openProductOwner({ askProductOwner: () => asked.promise });
  page.dom.type(part(page, '#po-drawer', 'agent-chat-input'), 'Which issues should run first?');
  part(page, '#po-drawer', 'agent-chat-send').click();
  await settle();
  page.run("state.view = 'workflows'");
  const answer = { id: 'p2', role: 'po', mode: 'plan', text: 'Run #1 first.', ts: '2026-10-08T09:01:00.000Z', costUsd: 0.01 };
  asked.resolve({ message: answer, messages: [{ id: 'p1', role: 'user', text: 'Which issues should run first?', ts: '2026-10-08T09:00:00.000Z' }, answer] });
  await settle(20);
  assert.equal(page.$('#btn-bl-po').classList.contains('st-waiting'), true, 'the main window counts the answer as unread (its own rule)');
  // the Oracle selected: the Product Owner's conversation is not in view in the window either
  const root = await mounted(page, { agent: 'oracle' });
  const unread = railItem(root, 'product-owner').querySelector('[data-testid="agents-rail-unread"]');
  assert.ok(unread, 'the Product Owner item has its unread badge');
  assert.equal(textOf(unread), '1');
});

test('#263 an agent without unread answers has no unread count on its rail item', async () => {
  const page = await loadPage({});
  const root = await mounted(page, { agent: 'product-owner' });
  const unread = railItem(root, 'supervisor').querySelector('[data-testid="agents-rail-unread"]');
  assert.equal(unread === null ? '' : textOf(unread), '');
});

test('#263 selecting the Product Owner shows its chat and the header names it', async () => {
  const page = await loadPage({});
  const root = await mounted(page);
  railItem(root, 'product-owner').click();
  await settle();
  assert.match(textOf(inPane(root, 'agents-window-header')), /Product Owner/);
  assert.ok(paneChat(root, 'product-owner', 'Product Owner'), 'the Product Owner\'s chat in the pane');
  assert.equal(paneChat(root, 'oracle', 'Oracle'), null, 'the Oracle\'s chat is not in the pane');
  inPane(root, 'agent-chat-input');
  inPane(root, 'agent-chat-send');
});

test('#263 mount({ agent }) selects that agent at once', async () => {
  const page = await loadPage({});
  const root = await mounted(page, { agent: 'supervisor' });
  assert.match(textOf(inPane(root, 'agents-window-header')), /Supervisor/);
  assert.ok(paneChat(root, 'supervisor', 'Supervisor'), 'the Supervisor\'s chat in the pane');
});

test('#263 a message sent from the window\'s Product Owner chat is the drawer\'s conversation too: one service call, shown in both', async () => {
  const asked = deferred();
  const page = await openProductOwner({ askProductOwner: () => asked.promise });
  const root = await mounted(page, { agent: 'product-owner' });
  page.dom.type(inPane(root, 'agent-chat-input'), 'Which issues should run first?');
  inPane(root, 'agent-chat-send').click();
  await settle();
  const calls = page.callsTo('askProductOwner');
  assert.equal(calls.length, 1, 'one service call (askProductOwner), not one per place');
  assert.ok(JSON.stringify(calls[0]).includes('Which issues should run first?'));
  assert.match(textOf(pane(root)), /Which issues should run first\?/, 'shown in the window');
  assert.match(textOf(part(page, '#po-drawer', 'agent-chat-messages')), /Which issues should run first\?/, 'shown in the main window\'s drawer');
});

test('#263 the rail item of an agent answering is marked busy until the answer arrives', async () => {
  const asked = deferred();
  const page = await loadPage({ api: { askOracle: () => asked.promise } });
  const root = await mounted(page, { agent: 'oracle' });
  page.dom.type(inPane(root, 'agent-chat-input'), 'Which runs failed last night?');
  inPane(root, 'agent-chat-send').click();
  await settle();
  assert.equal(page.callsTo('askOracle').length, 1, 'the question was sent');
  assert.equal(railItem(root, 'oracle').getAttribute('data-busy'), 'true', 'busy while the Oracle answers');
  // the owner's message only: an Oracle answer's links are decorated with a TreeWalker test/mini-dom.js lacks
  asked.resolve({ message: null, messages: [{ id: 'm1', role: 'user', text: 'Which runs failed last night?', ts: '2026-10-08T09:00:00.000Z' }], state: {} });
  await settle(20);
  assert.notEqual(railItem(root, 'oracle').getAttribute('data-busy'), 'true', 'not busy once the answer arrived');
});

test('#263 register() adds an agent after the built-in ones, with its own pane', async () => {
  const page = await loadPage({});
  const aw = agentsWindow(page);
  aw.register({ id: 'custom-inbox', name: 'Custom inbox', mount: (el) => { el.textContent = 'custom pane'; } });
  const root = await mounted(page);
  const items = railItems(root);
  assert.equal(items.length, 4);
  assert.equal(items[3].getAttribute('data-agent'), 'custom-inbox');
  assert.equal(nameOf(items[3]), 'Custom inbox');
  items[3].click();
  await settle();
  assert.match(textOf(pane(root)), /custom pane/);
  assert.match(textOf(inPane(root, 'agents-window-header')), /Custom inbox/);
});

// Not tested here: the window's own page picking its agent from the query string (loadPage has no
// location option; the E2E scenario covers the window opening on the asked agent).
