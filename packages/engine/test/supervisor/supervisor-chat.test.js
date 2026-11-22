// The app-wide Supervisor chat (#28, packages/engine/domains/supervisor/supervisor-chat.js): one conversation per workspace, kept
// in <workspace>/supervisor, reached through the supervisor:chat* channels (packages/engine/service/channels/
// supervisor.js), the way the drawer and the Supervisor page call it.
// Live progress (#180): supervisor:chat's turn is pushed on chat:progress and chat:cancel stops it;
// mockSteps' delays are scaled down (like the mock provider) so these tests stay fast.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService } = require('../../service');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { createSupervisorChat, questionText } = require('../../domains/supervisor/supervisor-chat');

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-chat-ws-'));
  process.env.CRAFTORIO_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  return { service, api: service.api };
}

function chatFiles(service) {
  const dir = service.workspace().supervisor;
  return { log: path.join(dir, 'chat.jsonl'), state: path.join(dir, 'chat.json') };
}

test('supervisor:chat with mock: a user message (carrying the screen) and a simulated supervisor message land in <ws>/supervisor/chat.jsonl', async (t) => {
  const { service, api } = makeService(t);
  const out = await api['supervisor:chat']({ question: 'What am I looking at?', screen: 'Builder, editing workflow x.yaml', mock: true });
  assert.equal(out.message.role, 'supervisor');
  assert.equal(out.message.simulated, true);
  assert.equal(out.message.costUsd, 0);
  assert.match(out.message.text, /Builder, editing workflow x\.yaml/);
  assert.match(out.message.text, /\d+ workflows, \d+ projects, \d+ runs \(\d+ in progress\), \d+ skills and \d+ agents/);

  const lines = fs.readFileSync(chatFiles(service).log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].role, lines[0].text, lines[0].screen], ['user', 'What am I looking at?', 'Builder, editing workflow x.yaml']);
  assert.equal(lines[1].role, 'supervisor');
  assert.equal(lines[1].simulated, true);
  assert.deepEqual(out.messages, lines);
});

test('supervisor:chat without mock, under CRAFTORIO_SIMULATION_ONLY (set in the test env): answers from the simulated supervisor too, no model call', async (t) => {
  const { api } = makeService(t);
  const out = await api['supervisor:chat']({ question: 'How much did I spend?', screen: '' });
  assert.equal(out.message.role, 'supervisor');
  assert.equal(out.message.simulated, true);
});

test('supervisor:chatHistory returns the conversation; supervisor:chatClear empties it and removes chat.json', async (t) => {
  const { service, api } = makeService(t);
  await api['supervisor:chat']({ question: 'Hi', screen: '', mock: true });
  assert.equal((await api['supervisor:chatHistory']()).length, 2);

  const cleared = await api['supervisor:chatClear']();
  assert.deepEqual(cleared, []);
  assert.deepEqual(await api['supervisor:chatHistory'](), []);
  assert.equal(fs.existsSync(chatFiles(service).state), false);
  assert.equal(fs.existsSync(chatFiles(service).log), false);
});

test('supervisor:chat throws on an empty question', async (t) => {
  const { api } = makeService(t);
  await assert.rejects(() => api['supervisor:chat']({ question: '   ', mock: true }), /Type a message/);
});

test('supervisor:chat: a second message sent before the first answers throws "still answering"', async (t) => {
  const { api } = makeService(t);
  const first = api['supervisor:chat']({ question: 'first', mock: true });
  await assert.rejects(() => api['supervisor:chat']({ question: 'second', mock: true }), /still answering/);
  await first;
});

// ---- #180: live progress (chat:progress, chat:cancel) -------------------------------------------

test('supervisor:chat (mock): the turn streams chat:progress start/items/end for chat "supervisor"', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  await api['supervisor:chat']({ question: 'What am I looking at?', screen: '', mock: true });

  assert.equal(events[0].phase, 'start');
  assert.equal(events[0].chat, 'supervisor');
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'done');
  assert.ok(events.some((e) => e.phase === 'items' && e.items.some((it) => it.kind === 'tool_call')));
});

test('chat:cancel(\'supervisor\') stops a supervisor:chat turn in flight: the answer is kept, marked stopped, and chat:progress ends "stopped"', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  // the turn's AbortController is wired synchronously, before the mock turn's first real wait
  // (packages/engine/domains/chat/chat-progress.js's mockSteps): cancelling right after the call races it early, not at the end
  const asking = api['supervisor:chat']({ question: 'What am I looking at?', screen: '', mock: true });
  assert.equal(await api['chat:cancel']({ chat: 'supervisor', key: '' }), true);

  const out = await asking;
  assert.equal(out.message.role, 'supervisor');
  assert.equal(out.message.stopped, true);
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'stopped');
});

test('questionText: prefixes "[Screen] ..." only when the screen is non-empty', () => {
  assert.equal(questionText('Hello', 'Builder, editing workflow x.yaml'), '[Screen] Builder, editing workflow x.yaml\n\nHello');
  assert.equal(questionText('Hello', ''), 'Hello');
  assert.equal(questionText('Hello', '   '), 'Hello');
  assert.equal(questionText('Hello', null), 'Hello');
});

test('createSupervisorChat: without mock, outside a mocked run, refuseReal is consulted first and its error becomes a system message (no claude call, no bridge, no mcp)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-chat-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const chat = createSupervisorChat({
    dir: () => dir,
    tools: () => { throw new Error('tools() should not be read'); },
    bridge: { start: async () => { throw new Error('bridge.start() should not be called'); } },
    mcpCommand: () => { throw new Error('mcpCommand() should not be called'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('resolveCommand() should not be called'); },
    refuseReal: () => { throw new Error('Simulation only (CRAFTORIO_SIMULATION_ONLY=1): refusing to start the supervisor\'s CLI (claude).'); },
  });
  const { message } = await chat.ask({ question: 'Start a real run', mock: false });
  assert.equal(message.role, 'system');
  assert.equal(message.error, true);
  assert.match(message.text, /Simulation only/);
});
