// #274: the Oracle, Product Owner and Supervisor drawers render their chat through the shared
// component (packages/ui-kit/agent-chat.js, contract in test/agent-chat-274.test.js), and in every one
// the text box empties as soon as Send is clicked; the Oracle gives the text back when the send fails
// or is refused. Acceptance tests, written before the code.
//
// Seams: the drawers' public entry points (window.OracleChat.open, window.BacklogPO.open,
// window.openSupervisorChat), their existing ids (#oracle-drawer, #po-drawer, #svc-drawer) and, inside
// each, the component's markers: [data-testid="agent-chat"] (the marker that a drawer renders through
// the component), agent-chat-input, agent-chat-send, agent-chat-messages, agent-chat-message,
// agent-chat-error. The api call a Send makes (askOracle, askProductOwner, askSupervisorChat) stays
// pending until the test settles it. The whole page is loaded by test/agent-chat-page-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { settle, deferred, part, openOracle, openSupervisor, openProductOwner, pageScripts } = require('./agent-chat-page-harness');

// ---- each drawer renders through the component -------------------------------------------------------

test('#274 the Oracle drawer renders its chat through the shared component ([data-testid="agent-chat"] inside #oracle-drawer)', async () => {
  const page = await openOracle({});
  part(page, '#oracle-drawer', 'agent-chat');
  part(page, '#oracle-drawer', 'agent-chat-messages');
  part(page, '#oracle-drawer', 'agent-chat-input');
});

test('#274 the Product Owner drawer renders its chat through the shared component ([data-testid="agent-chat"] inside #po-drawer)', async () => {
  const page = await openProductOwner({});
  part(page, '#po-drawer', 'agent-chat');
  part(page, '#po-drawer', 'agent-chat-messages');
  part(page, '#po-drawer', 'agent-chat-input');
});

test('#274 the Supervisor drawer renders its chat through the shared component ([data-testid="agent-chat"] inside #svc-drawer)', async () => {
  const page = await openSupervisor({});
  part(page, '#svc-drawer', 'agent-chat');
  part(page, '#svc-drawer', 'agent-chat-messages');
  part(page, '#svc-drawer', 'agent-chat-input');
});

test('#274 the component loads with the page: index.html lists agent-chat.js before the views that use it', () => {
  const scripts = pageScripts();
  const at = scripts.indexOf('agent-chat.js');
  assert.ok(at >= 0, 'index.html loads agent-chat.js (npm run docs lists it)');
  for (const view of ['views/oracle/oracle.js', 'views/backlog/backlog-po.js', 'views/supervisor/supervisor.js']) {
    assert.ok(scripts.indexOf(view) > at, `${view} loads after agent-chat.js`);
  }
});

// ---- the Oracle: the input clears on Send -----------------------------------------------------------

test('#274 the Oracle empties its text box as soon as Send is clicked, while the answer is still pending', async () => {
  const asked = deferred();
  const page = await openOracle({ askOracle: () => asked.promise });
  const input = part(page, '#oracle-drawer', 'agent-chat-input');
  page.dom.type(input, 'Which runs failed last night?');
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  assert.equal(input.value, '', 'emptied in the click itself');
  await settle();
  assert.equal(page.callsTo('askOracle').length, 1, 'the question was sent');
  assert.equal(page.callsTo('askOracle')[0][0].question, 'Which runs failed last night?');
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-input').value, '', 'still empty while the Oracle answers');
});

test('#274 the Oracle shows the question in the conversation at once, before the answer', async () => {
  const asked = deferred();
  const page = await openOracle({ askOracle: () => asked.promise });
  page.dom.type(part(page, '#oracle-drawer', 'agent-chat-input'), 'Which runs failed last night?');
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  await settle();
  const mine = page.document.querySelectorAll('#oracle-drawer [data-testid="agent-chat-message"][data-role="user"]');
  assert.ok(mine.some((m) => /Which runs failed last night\?/.test(textOf(m))), 'the owner\'s question is in the conversation');
});

test('#274 when the Oracle\'s send fails, the question comes back in the text box with the error', async () => {
  const page = await openOracle({ askOracle: async () => { throw new Error('The Oracle is still answering the previous message.'); } });
  page.dom.type(part(page, '#oracle-drawer', 'agent-chat-input'), 'Which runs failed last night?');
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  await settle();
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-input').value, 'Which runs failed last night?');
  assert.match(textOf(page.$('#oracle-drawer')), /The Oracle is still answering the previous message\./);
});

test('#274 when a budget refuses the Oracle\'s question, the question comes back in the text box with the refusal', async () => {
  const question = 'Which runs failed last night?';
  const refused = { reason: 'monthly-budget', text: 'The Oracle reached its monthly budget (20.00 USD).' };
  const page = await openOracle({
    askOracle: async () => ({ refused, message: null, messages: [{ id: 'm1', role: 'user', text: question, ts: '2026-10-04T09:00:00.000Z', refused }], state: {} }),
  });
  page.dom.type(part(page, '#oracle-drawer', 'agent-chat-input'), question);
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  await settle();
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-input').value, question);
  assert.match(textOf(page.$('#oracle-drawer')), /monthly budget/);
});

// ---- the Product Owner and the Supervisor: the input clears on Send too ---------------------------------

test('#274 the Product Owner empties its text box as soon as Ask is clicked, while the answer is still pending', async () => {
  const asked = deferred();
  const page = await openProductOwner({ askProductOwner: () => asked.promise });
  const input = part(page, '#po-drawer', 'agent-chat-input');
  page.dom.type(input, 'Which issues should run first?');
  part(page, '#po-drawer', 'agent-chat-send').click();
  assert.equal(input.value, '', 'emptied in the click itself');
  await settle();
  assert.equal(page.callsTo('askProductOwner').length, 1, 'the question was sent');
  assert.ok(JSON.stringify(page.callsTo('askProductOwner')[0]).includes('Which issues should run first?'));
});

test('#274 the Supervisor empties its text box as soon as Send is clicked, while the answer is still pending', async () => {
  const asked = deferred();
  const page = await openSupervisor({ askSupervisorChat: () => asked.promise });
  const input = part(page, '#svc-drawer', 'agent-chat-input');
  page.dom.type(input, 'What am I looking at?');
  part(page, '#svc-drawer', 'agent-chat-send').click();
  assert.equal(input.value, '', 'emptied in the click itself');
  await settle();
  assert.equal(page.callsTo('askSupervisorChat').length, 1, 'the question was sent');
  assert.equal(page.callsTo('askSupervisorChat')[0][0].question, 'What am I looking at?');
});
