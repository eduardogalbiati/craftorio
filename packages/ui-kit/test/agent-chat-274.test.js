// #274: one shared chat component for the Oracle, Product Owner and Supervisor drawers; the input
// clears on Send. Acceptance tests, written before the code: packages/ui-kit/agent-chat.js does not exist
// yet, so it is read inside each test (a missing file fails that test, never the whole file).
//
// The component's contract (what the developer implements; the drawers' tests are in
// test/agent-chat-drawers-274.test.js):
//
// Module: packages/ui-kit/agent-chat.js, UMD like live-turn.js (browser: window.AgentChat; Node:
// module.exports), a plain script with no DOM work at load time. It may use app.js's globals at call
// time (esc, markdownHtml, fmtCost, errMsg) and window.LiveTurn (#180). Its own look:
// packages/ui-kit/agent-chat.css (not checked here).
//
//   const chat = AgentChat.create(container, {
//     agent: 'Oracle',                 // the agent's name: the working line says "<agent> is working"
//     send: async (text, attachments) => result,
//                                      // Send / Enter. A rejection is a failure; a result with
//                                      // `ok: false` is a refusal ({ ok: false, error: 'busy' }, a
//                                      // budget); a result with `messages` (array) replaces the
//                                      // conversation. Anything else is a success.
//     placeholder: 'Ask the Oracle…',  // optional, the text box's placeholder
//     onUnreadChange: (unread) => {},  // optional: called with true / false when the unread state flips
//   });
//   chat.setMessages(list)   // [{ role, text, ts?, costUsd?, tokens? }]: role 'user' is the owner, any
//                            // other role is the agent (its text rendered as Markdown)
//   chat.setBusy(on)         // the busy lock (#234); chat.isBusy() reads it
//   chat.setLiveTurn(turn)   // a LiveTurn state (window.LiveTurn.create/apply) drawn at the end of the
//                            // conversation with LiveTurn.html; null removes it
//   chat.addAttachment(att)  // an attachment (opaque to the component) for the next send
//   chat.setVisible(on)      // whether the owner sees the chat (default true); a reply that arrives while
//                            // hidden marks it unread (#149); setVisible(true) or chat.markSeen() clears it
//   chat.isUnread()
//   chat.slot(name)          // the element of a slot for the agent's own parts: 'head', 'top' (above the
//                            // conversation: mode switch, context chip), 'pills' (suggested questions,
//                            // starters), 'foot'; each is [data-agent-chat-slot="<name>"]
//
// The markup it renders inside `container` (asserted through these data-testids):
//   [data-testid="agent-chat"]           the component's root
//   [data-testid="agent-chat-messages"]  the scrolling conversation
//   [data-testid="agent-chat-message"]   one message, with data-role="user" or data-role="agent";
//                                        a message with costUsd shows it ("$0.12")
//   [data-testid="agent-chat-input"]     the text box (<textarea>)
//   [data-testid="agent-chat-send"]      the Send button
//   [data-testid="agent-chat-error"]     the error line (the failure's or the refusal's text)
//
// Send (a click on Send, or Enter without Shift in the text box), with some text and not busy:
// synchronously, in the handler, the text box is emptied and the owner's message is added to the
// conversation; the chat is busy (Send and the buttons of the 'pills' slot disabled, the text box
// still enabled: the owner may type the next message, Enter sends nothing), the working line shows
// and the conversation scrolls to its end; then send(text, attachments) is called. A failure or a
// refusal puts the text back in the box and shows the error. Empty text sends nothing.
//
// Tests run the module whole in a vm sandbox with test/mini-dom.js (a small real DOM: markup is
// parsed, events bubble, a submit button submits its form) and the real live-turn.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { createDom, textOf } = require('./mini-dom');

const ROOT = path.join(__dirname, '..', '..', '..');
const RENDERER = path.join(__dirname, '..');
const MODULE = path.join(RENDERER, 'agent-chat.js');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = (s) => `<p>${esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The sandbox: app.js's globals the component may use, the real LiveTurn, then agent-chat.js.
function loadModule() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
    queueMicrotask,
    esc,
    errMsg: (e) => String(e?.message || e),
    fmtCost: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    markdownHtml: md,
    marked: { parse: md, use() {}, setOptions() {} },
    DOMPurify: { sanitize: (s) => String(s ?? ''), addHook() {} },
    Robots: { svg: () => '<svg class="robot"></svg>', plaqueFor: (m) => String(m || '') },
    api: { onChatProgress: () => () => {}, cancelChatTurn: async () => {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    navigator: { platform: 'Win32', userAgent: 'node', clipboard: { writeText: async () => {} } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    FileReader: class { readAsDataURL() {} },
    Blob: class {},
    File: class {},
    URL,
  };
  const dom = createDom({ window: sandbox });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = dom.document;
  Object.assign(sandbox, dom.classes);
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(path.join(RENDERER, 'live-turn.js'), 'utf8'), sandbox, { filename: 'live-turn.js' });
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: 'agent-chat.js' });
  assert.equal(typeof sandbox.AgentChat?.create, 'function', 'agent-chat.js sets window.AgentChat with a create function');
  return { sandbox, dom, document: dom.document };
}

// A chat mounted in a container of the page. `send` defaults to a recorder whose calls stay
// pending until the test settles them (d.pending[i].resolve / reject).
function mount(options = {}) {
  const loaded = loadModule();
  const { document, sandbox } = loaded;
  const container = document.createElement('div');
  container.id = 'chat-host';
  document.body.appendChild(container);
  const sends = [];
  const pending = [];
  const unread = [];
  const send = options.send || ((text, attachments) => {
    sends.push([text, attachments]);
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  const chat = sandbox.AgentChat.create(container, { agent: 'Oracle', onUnreadChange: (u) => unread.push(u), ...options, send });
  const part = (id) => container.querySelector(`[data-testid="${id}"]`);
  const parts = {
    root: () => part('agent-chat'),
    messages: () => part('agent-chat-messages'),
    input: () => part('agent-chat-input'),
    send: () => part('agent-chat-send'),
    error: () => part('agent-chat-error'),
    all: () => container.querySelectorAll('[data-testid="agent-chat-message"]'),
    byRole: (role) => container.querySelectorAll(`[data-testid="agent-chat-message"][data-role="${role}"]`),
  };
  for (const id of ['agent-chat', 'agent-chat-messages', 'agent-chat-input', 'agent-chat-send']) {
    assert.ok(part(id), `the component renders [data-testid="${id}"] inside its container`);
  }
  const type = (text) => loaded.dom.type(parts.input(), text);
  const enter = (extra) => loaded.dom.keydown(parts.input(), 'Enter', extra);
  return { ...loaded, container, chat, parts, sends, pending, unread, type, enter };
}

const isShown = (el) => !!el && !el.hidden && !el.classList.contains('hidden') && textOf(el) !== '';

// ---- render ------------------------------------------------------------------------------------

test('#274 setMessages renders the owner\'s and the agent\'s messages, in order, each with its role', () => {
  const c = mount();
  c.chat.setMessages([
    { role: 'user', text: 'Which runs failed last night?', ts: '2026-10-04T09:00:00.000Z' },
    { role: 'oracle', text: 'Two runs failed.', ts: '2026-10-04T09:00:20.000Z' },
  ]);
  const all = c.parts.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].getAttribute('data-role'), 'user');
  assert.equal(all[1].getAttribute('data-role'), 'agent');
  assert.match(textOf(all[0]), /Which runs failed last night\?/);
  assert.match(textOf(all[1]), /Two runs failed\./);
});

test('#274 an agent message is rendered as Markdown: **bold** becomes <strong>', () => {
  const c = mount();
  c.chat.setMessages([{ role: 'po', text: 'The plan is **ready**.' }]);
  const [msg] = c.parts.byRole('agent');
  assert.ok(msg, 'the agent message is rendered');
  const strong = msg.querySelector('strong');
  assert.ok(strong, `the message has a <strong> (got ${msg.innerHTML})`);
  assert.equal(strong.textContent, 'ready');
});

test('#274 an agent message with a cost shows it ($0.12)', () => {
  const c = mount();
  c.chat.setMessages([{ role: 'assistant', text: 'Done.', costUsd: 0.12 }]);
  const [msg] = c.parts.byRole('agent');
  assert.match(textOf(msg), /\$0\.12/);
});

test('#274 setLiveTurn draws the live turn (#180) at the end of the conversation: its current step shows', () => {
  const c = mount();
  c.chat.setMessages([{ role: 'user', text: 'Where is the roadmap code?' }]);
  const turn = c.sandbox.LiveTurn.create({ agent: 'Oracle' });
  turn.status = 'working';
  // a step stores its tool and input; its label is resolved when drawn (#423)
  turn.steps.push({ name: 'Read', input: { file_path: 'src/roadmap.js' }, state: 'running' });
  c.chat.setLiveTurn(turn);
  const live = c.parts.messages().querySelector('.live-turn');
  assert.ok(live, 'the live turn (LiveTurn.html) is inside the conversation');
  assert.match(textOf(live), /Reading src\/roadmap\.js/);
  c.chat.setLiveTurn(null);
  assert.equal(c.parts.messages().querySelector('.live-turn'), null, 'null removes the live turn');
});

// ---- the busy lock (#234) ------------------------------------------------------------------------

test('#274 while busy, Send and the pills are disabled but the text box stays enabled and editable', () => {
  const c = mount();
  c.chat.slot('pills').innerHTML = '<button type="button" class="chip" data-q="Build a roadmap">Build a roadmap</button>';
  c.type('A draft');
  c.chat.setBusy(true);
  assert.equal(c.chat.isBusy(), true);
  assert.equal(c.parts.send().disabled, true, 'Send is disabled while busy');
  assert.equal(c.chat.slot('pills').querySelector('button').disabled, true, 'a pill is disabled while busy');
  assert.equal(c.parts.input().disabled, false, 'the text box is not disabled');
  assert.equal(c.parts.input().readOnly, false, 'the text box is not read-only');
  assert.equal(c.parts.input().value, 'A draft', 'what the owner typed is kept');
});

test('#274 after the busy lock lifts, Send and the pills are enabled again', () => {
  const c = mount();
  c.chat.slot('pills').innerHTML = '<button type="button" class="chip" data-q="Build a roadmap">Build a roadmap</button>';
  c.type('Next question');
  c.chat.setBusy(true);
  c.chat.setBusy(false);
  assert.equal(c.chat.isBusy(), false);
  assert.equal(c.parts.send().disabled, false);
  assert.equal(c.chat.slot('pills').querySelector('button').disabled, false);
});

test('#274 while a message is in flight, the owner can type the next one and Enter sends nothing more', async () => {
  const c = mount();
  c.type('First question');
  c.parts.send().click();
  await settle();
  c.type('Second question');
  c.enter();
  await settle();
  assert.equal(c.sends.length, 1, 'only the first message was sent');
  assert.equal(c.parts.input().value, 'Second question', 'the text typed while busy is kept');
});

test('#274 while a message is in flight a working line says "Oracle is working"; it is gone after the reply', async () => {
  const c = mount();
  c.type('What happened overnight?');
  c.parts.send().click();
  assert.match(textOf(c.parts.root()), /Oracle is working/);
  await settle();
  c.pending[0].resolve({ messages: [{ role: 'user', text: 'What happened overnight?' }, { role: 'oracle', text: 'Nothing failed.' }] });
  await settle();
  assert.doesNotMatch(textOf(c.parts.root()), /Oracle is working/);
});

// ---- the input clears on Send, and comes back on a failure -----------------------------------------

test('#274 a click on Send empties the text box at once, before the reply arrives', () => {
  const c = mount();
  c.type('Which runs failed last night?');
  c.parts.send().click();
  assert.equal(c.parts.input().value, '', 'emptied in the click itself, while the send is still pending');
});

test('#274 a click on Send shows the owner\'s message in the conversation at once', () => {
  const c = mount();
  c.type('Which runs failed last night?');
  c.parts.send().click();
  const mine = c.parts.byRole('user');
  assert.equal(mine.length, 1, 'the owner\'s message is in the conversation before the reply');
  assert.match(textOf(mine[0]), /Which runs failed last night\?/);
});

test('#274 Send calls send(text, attachments) once with the typed text and the attachments added', async () => {
  const c = mount();
  c.chat.addAttachment({ name: 'screenshot.png', dataUrl: 'data:image/png;base64,AAAA' });
  c.type('What is wrong in this screenshot?');
  c.parts.send().click();
  await settle();
  assert.equal(c.sends.length, 1);
  assert.equal(c.sends[0][0], 'What is wrong in this screenshot?');
  assert.ok(Array.isArray(c.sends[0][1]), 'the attachments are an array');
  assert.equal(c.sends[0][1].length, 1);
  assert.equal(c.sends[0][1][0].name, 'screenshot.png');
});

test('#274 Enter (without Shift) in the text box sends and empties it; Shift+Enter does not send', async () => {
  const c = mount();
  c.type('A line');
  c.enter({ shiftKey: true });
  await settle();
  assert.equal(c.sends.length, 0, 'Shift+Enter is a new line');
  c.enter();
  assert.equal(c.parts.input().value, '');
  await settle();
  assert.equal(c.sends.length, 1);
  assert.equal(c.sends[0][0], 'A line');
});

test('#274 Send with an empty or blank text box sends nothing', async () => {
  const c = mount();
  c.parts.send().click();
  c.type('   ');
  c.parts.send().click();
  await settle();
  assert.equal(c.sends.length, 0);
  assert.equal(c.parts.byRole('user').length, 0, 'no message was added');
});

test('#274 when send fails, the text comes back in the text box and the error is shown', async () => {
  const c = mount();
  c.type('Which runs failed last night?');
  c.parts.send().click();
  await settle();
  c.pending[0].reject(new Error('The model call failed'));
  await settle();
  assert.equal(c.parts.input().value, 'Which runs failed last night?');
  assert.ok(isShown(c.parts.error()), 'the error line is shown');
  assert.match(textOf(c.parts.error()), /The model call failed/);
  assert.equal(c.chat.isBusy(), false, 'no longer busy');
  assert.equal(c.parts.send().disabled, false, 'Send is enabled again, to resend');
});

test('#274 when send is refused ({ ok: false, error }: busy, a budget), the text comes back and the refusal is shown', async () => {
  const c = mount();
  c.type('Plan the next sprint');
  c.parts.send().click();
  await settle();
  c.pending[0].resolve({ ok: false, error: 'Paused by budget: the daily limit is reached.' });
  await settle();
  assert.equal(c.parts.input().value, 'Plan the next sprint');
  assert.ok(isShown(c.parts.error()), 'the error line is shown');
  assert.match(textOf(c.parts.error()), /Paused by budget: the daily limit is reached\./);
  assert.equal(c.chat.isBusy(), false);
});

test('#274 a reply with messages replaces the conversation and lifts the busy lock', async () => {
  const c = mount();
  c.type('What happened overnight?');
  c.parts.send().click();
  await settle();
  c.pending[0].resolve({ messages: [{ role: 'user', text: 'What happened overnight?' }, { role: 'oracle', text: 'Nothing failed.' }] });
  await settle();
  const all = c.parts.all();
  assert.equal(all.length, 2, 'the owner\'s message once (not duplicated) and the reply');
  assert.match(textOf(all[1]), /Nothing failed\./);
  assert.equal(c.chat.isBusy(), false);
  assert.equal(c.parts.input().value, '', 'the text box stays empty after a success');
});

// ---- scroll to the end on send --------------------------------------------------------------------

test('#274 Send scrolls the conversation to its end, even when the owner had scrolled up', async () => {
  const c = mount();
  // no layout here: the conversation is 1000 px of content in a 200 px box
  const proto = c.dom.classes.Element.prototype;
  const isList = (el) => el.getAttribute('data-testid') === 'agent-chat-messages';
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return isList(this) ? 1000 : this._sh || 0; }, set(v) { this._sh = v; } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return isList(this) ? 200 : this._ch || 0; }, set(v) { this._ch = v; } });
  c.chat.setMessages(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'oracle' : 'user', text: `Message ${i + 1}` })));
  c.parts.messages().scrollTop = 100; // scrolled up, far from the end (1000 - 200 = 800)
  c.type('One more question');
  c.parts.send().click();
  await settle();
  const list = c.parts.messages();
  const last = c.parts.all().at(-1);
  assert.ok(list.scrollTop >= 800 || last?.scrolledIntoView, `the conversation is at its end (scrollTop ${list.scrollTop}, scrollHeight 1000, clientHeight 200)`);
});

// ---- unread (#149) ---------------------------------------------------------------------------------

test('#274 a reply that arrives while the chat is hidden marks it unread; showing it clears the unread state', async () => {
  const c = mount();
  c.type('What happened overnight?');
  c.parts.send().click();
  c.chat.setVisible(false); // the drawer closed while the agent answers
  await settle();
  c.pending[0].resolve({ messages: [{ role: 'user', text: 'What happened overnight?' }, { role: 'oracle', text: 'Nothing failed.' }] });
  await settle();
  assert.equal(c.chat.isUnread(), true);
  assert.equal(c.unread.at(-1), true, 'onUnreadChange(true)');
  c.chat.setVisible(true);
  assert.equal(c.chat.isUnread(), false);
  assert.equal(c.unread.at(-1), false, 'onUnreadChange(false)');
});

test('#274 a new agent message set while the chat is hidden marks it unread; markSeen clears it', () => {
  const c = mount();
  c.chat.setMessages([{ role: 'user', text: 'Hi' }]);
  c.chat.setVisible(false);
  c.chat.setMessages([{ role: 'user', text: 'Hi' }, { role: 'po', text: 'Hello, here is the plan.' }]);
  assert.equal(c.chat.isUnread(), true);
  c.chat.markSeen();
  assert.equal(c.chat.isUnread(), false);
});

test('#274 a reply while the chat is visible is not unread, and the same messages set again while hidden are not unread', async () => {
  const c = mount();
  const history = [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello.' }];
  c.type('Hi');
  c.parts.send().click();
  await settle();
  c.pending[0].resolve({ messages: history });
  await settle();
  assert.equal(c.chat.isUnread(), false, 'seen as it arrived');
  c.chat.setVisible(false);
  c.chat.setMessages(history.map((m) => ({ ...m })));
  assert.equal(c.chat.isUnread(), false, 'nothing new arrived');
});

// ---- one place for fixes -------------------------------------------------------------------------

test('#274 agent-chat.js\'s header comment lists what it owns and the three chats that use it', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  const header = (/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\n)+/.exec(src) || [''])[0];
  assert.ok(header.trim(), 'the file starts with a header comment');
  for (const [what, re] of Object.entries({
    'the messages as Markdown': /markdown/i,
    'the live turn': /live turn/i,
    'the busy lock': /busy/i,
    'attachments and pasted images': /attach/i,
    'the working line': /working/i,
    'scroll to the end': /scroll/i,
    'the unread state': /unread/i,
    'cost / tokens per message': /cost|tokens/i,
    'the input that clears on Send': /clear|empt/i,
    'the slots': /slot/i,
    'the Oracle': /Oracle/,
    'the Product Owner': /Product Owner/,
    'the Supervisor': /Supervisor/,
  })) assert.match(header, re, `the header mentions ${what}`);
});

test('#274 docs/agents/renderer.md names agent-chat.js and says new agent chats use it', () => {
  const doc = fs.readdirSync(path.join(ROOT, 'docs', 'agents', 'renderer')).map((f) => fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'renderer', f), 'utf8')).join('\n');
  assert.match(doc, /agent-chat\.js/);
  const sentence = doc.split(/(?<=\.)\s+/).find((s) => /agent-chat\.js/.test(s) && /\bnew\b/i.test(s) && /\bchats?\b/i.test(s))
    || doc.split(/\n\s*\n|\n-\s/).find((p) => /agent-chat\.js/.test(p) && /\bnew\b[^.]*\bchats?\b/i.test(p));
  assert.ok(sentence, 'a sentence (or bullet) with agent-chat.js says a new agent chat uses it');
});

// ---- after the review ----------------------------------------------------------------------------

test('#274 a view\'s onDone that throws after a send leaves no unhandled rejection, and the chat is ready again', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const c = mount({ onDone() { throw new Error('the view failed to redraw'); } });
    c.type('hello');
    c.parts.send().click();
    c.pending[0].resolve({});
    await settle(10);
    assert.deepEqual(unhandled.map((r) => String(r?.message || r)), [], 'no unhandled rejection');
    assert.equal(c.parts.send().disabled, false, 'Send is free again');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
