// #274, after the review: the drawers' behaviours around the shared chat (src/renderer/agent-chat.js)
// that the acceptance tests (test/agent-chat-drawers-274.test.js) do not reach: the Oracle answering
// a turn it started itself (service busy, no send from this window), a question sent from the Home
// dock seen from the drawer, the gate's queued starter, the daily-budget refusal; the Supervisor's
// pasted images, failed send and history error; the Product Owner's failed send.
// Seams: the drawers' entry points (OracleChat.open / openWith, openSupervisorChat, BacklogPO.open),
// their ids, the component's data-testids and the fake window.api (test/agent-chat-page-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { settle, deferred, loadPage, part, openOracle, openSupervisor, openProductOwner } = require('./agent-chat-page-harness');

const shown = (el) => !!el && !el.hidden && !el.classList.contains('hidden') && textOf(el).trim() !== '';
const userMessages = (page, drawer) => page.document.querySelectorAll(`${drawer} [data-testid="agent-chat-message"][data-role="user"]`);

// ---- the Oracle ----------------------------------------------------------------------------------------

test('#274 the Oracle answering a turn of its own (service busy, no send here) shows that it is working and locks Send', async () => {
  const page = await openOracle({ oracleState: async () => ({ busy: true }) });
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-send').disabled, true, 'Send is locked while the Oracle answers');
  assert.ok(shown(page.$('#oracle-drawer .agent-chat-working')), 'the working line shows while the Oracle answers');
});

test('#274 the Oracle answering a turn of its own: Enter in the text box sends nothing and keeps the text', async () => {
  const page = await openOracle({ oracleState: async () => ({ busy: true }), askOracle: async () => ({ messages: [], state: {} }) });
  const input = part(page, '#oracle-drawer', 'agent-chat-input');
  page.dom.type(input, 'Is it done yet?');
  page.dom.keydown(input, 'Enter');
  await settle();
  assert.equal(page.callsTo('askOracle').length, 0, 'nothing was sent');
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-input').value, 'Is it done yet?');
});

test('#274 a question sent from the Home dock shows in flight in the drawer opened on another screen, with the working state', async () => {
  const asked = deferred();
  const page = await loadPage({ api: { askOracle: () => asked.promise } });
  page.run("state.view = 'dashboard'");
  const input = part(page, '#oracle-dock', 'agent-chat-input');
  page.dom.type(input, 'What ran overnight?');
  part(page, '#oracle-dock', 'agent-chat-send').click();
  await settle();
  assert.equal(page.callsTo('askOracle').length, 1, 'the dock sent the question');
  page.run("state.view = 'workflows'");
  page.sandbox.OracleChat.open();
  await settle();
  assert.ok(userMessages(page, '#oracle-drawer').some((m) => /What ran overnight\?/.test(textOf(m))), 'the drawer shows the question in flight');
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-send').disabled, true, 'Send is locked in the drawer');
  assert.ok(shown(page.$('#oracle-drawer .agent-chat-working')), 'the drawer shows the working line');
});

test('#274 a gate starter clicked while the Oracle answers waits in line and is asked, with the gate, after the answer', async () => {
  const first = deferred();
  const answers = [first.promise, Promise.resolve({ messages: [], state: {} })];
  const page = await loadPage({ api: { askOracle: () => answers.shift() } });
  page.run("state.view = 'workflows'");
  page.sandbox.OracleChat.openWith({ label: 'Gate A', ref: 'r1', text: 'ctx', starters: ['Why?'] });
  await settle();
  page.dom.type(part(page, '#oracle-drawer', 'agent-chat-input'), 'What is this gate?');
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  await settle();
  const starter = page.$('#oracle-drawer [data-oracle-q="Why?"]');
  assert.ok(starter, 'the gate\'s starter is offered');
  starter.click();
  await settle();
  assert.equal(page.callsTo('askOracle').length, 1, 'the starter waits while the Oracle answers');
  assert.match(textOf(page.$('#oracle-drawer')), /queued/);
  // the owner's message only: an answer's links are decorated with a TreeWalker test/mini-dom.js lacks
  first.resolve({ messages: [{ id: 'm1', role: 'user', text: 'What is this gate?', ts: '2026-10-04T09:00:00.000Z' }], state: {} });
  await settle(20);
  const asks = page.callsTo('askOracle');
  assert.equal(asks.length, 2, 'the queued starter was asked after the answer');
  assert.equal(asks[1][0].question, 'Why?');
  assert.deepEqual({ ...asks[1][0].context }, { label: 'Gate A', ref: 'r1', text: 'ctx' });
});

test('#274 a daily-budget refusal gives the question back in the box and shows the paused notice, not an error line', async () => {
  const question = 'Which runs failed last night?';
  const refused = { reason: 'daily-budget', text: 'The Oracle reached its daily budget.' };
  const page = await openOracle({
    askOracle: async () => ({ refused, message: null, messages: [{ id: 'm1', role: 'user', text: question, ts: '2026-10-04T09:00:00.000Z', refused }], state: { paused: true, today: { spentUsd: 5, limitUsd: 5 } } }),
  });
  page.dom.type(part(page, '#oracle-drawer', 'agent-chat-input'), question);
  part(page, '#oracle-drawer', 'agent-chat-send').click();
  await settle();
  assert.equal(part(page, '#oracle-drawer', 'agent-chat-input').value, question, 'the question is back in the box');
  assert.equal(page.$('#oracle-drawer [data-testid="agent-chat-error"]'), null, 'no error line');
  assert.match(textOf(page.$('#oracle-drawer')), /Paused by budget/);
  assert.match(textOf(page.$('#oracle-drawer')), /Spent \$5\.00 of \$5\.00 today/);
});

// ---- the Supervisor ------------------------------------------------------------------------------------

test('#274 when the Supervisor\'s send fails, the question comes back in the text box with the error', async () => {
  const page = await openSupervisor({ askSupervisorChat: async () => { throw new Error('The supervisor could not answer.'); } });
  page.dom.type(part(page, '#svc-drawer', 'agent-chat-input'), 'What am I looking at?');
  part(page, '#svc-drawer', 'agent-chat-send').click();
  await settle();
  assert.equal(part(page, '#svc-drawer', 'agent-chat-input').value, 'What am I looking at?');
  assert.match(textOf(part(page, '#svc-drawer', 'agent-chat-error')), /The supervisor could not answer\./);
});

test('#274 a Supervisor suggestion chip sends without the images pasted in the box, and leaves them there', async () => {
  const asked = deferred();
  const page = await openSupervisor({ askSupervisorChat: () => asked.promise });
  const input = part(page, '#svc-drawer', 'agent-chat-input');
  // an image already pasted and saved (the clipboard is a system boundary: seeded as PasteImage keeps it)
  page.sandbox.PasteImage.attach(input);
  input._paste.items.push({ id: 'p1', name: 'image-1.png', status: 'ready', path: 'C:/shots/image-1.png', size: 1 });
  const chip = page.$('#svc-drawer [data-svc-q]');
  assert.ok(chip, 'the Supervisor offers suggestion chips');
  chip.click();
  await settle();
  const asks = page.callsTo('askSupervisorChat');
  assert.equal(asks.length, 1, 'the chip asked its question');
  assert.equal(asks[0][0].attachments, undefined, 'the chip\'s question carries no image');
  assert.deepEqual(page.sandbox.PasteImage.attachments(input).map((a) => a.path), ['C:/shots/image-1.png'], 'the pasted image stays in the box');
});

test('#274 a Supervisor history that failed to load and then loads clears its error', async () => {
  let fail = true;
  const page = await openSupervisor({
    supervisorChatHistory: async () => {
      if (fail) throw new Error('History unavailable.');
      return [{ role: 'user', text: 'Hello', ts: '2026-10-04T09:00:00.000Z' }, { role: 'supervisor', text: 'Hi.', ts: '2026-10-04T09:00:01.000Z' }];
    },
  });
  assert.match(textOf(part(page, '#svc-drawer', 'agent-chat-error')), /History unavailable\./, 'the first load shows its error');
  fail = false;
  page.sandbox.openSupervisorChat();
  await settle();
  assert.equal(page.$('#svc-drawer [data-testid="agent-chat-error"]'), null, 'the error is gone once the history loads');
});

// ---- the Product Owner ---------------------------------------------------------------------------------

test('#274 when the Product Owner\'s send fails, the question comes back in the text box with the error', async () => {
  const page = await openProductOwner({ askProductOwner: async () => { throw new Error('The Product Owner could not answer.'); } });
  page.dom.type(part(page, '#po-drawer', 'agent-chat-input'), 'Which issues should run first?');
  part(page, '#po-drawer', 'agent-chat-send').click();
  await settle();
  assert.equal(part(page, '#po-drawer', 'agent-chat-input').value, 'Which issues should run first?');
  assert.match(textOf(page.$('#po-drawer')), /The Product Owner could not answer\./);
});
