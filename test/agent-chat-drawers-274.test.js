// #274: the Oracle, Product Owner and Supervisor drawers render their chat through the shared
// component (src/renderer/agent-chat.js, contract in test/agent-chat-274.test.js), and in every one
// the text box empties as soon as Send is clicked; the Oracle gives the text back when the send fails
// or is refused. Acceptance tests, written before the code.
//
// The whole page is loaded: src/renderer/index.html's <body> parsed into test/mini-dom.js (a small
// real DOM), then every script index.html lists, in its order (agent-chat.js among them once
// `npm run docs` lists it), in one vm sandbox with a fake window.api (every method resolves to null,
// `list*` to [], `on*` records its handler; a test overrides the methods it drives). app.js's init
// runs on DOMContentLoaded. A script that fails to load is recorded, not thrown (unrelated screens
// may need APIs the fake DOM lacks).
// Seams: the drawers' public entry points (window.OracleChat.open, window.BacklogPO.open,
// window.openSupervisorChat), their existing ids (#oracle-drawer, #po-drawer, #svc-drawer) and, inside
// each, the component's markers: [data-testid="agent-chat"] (the marker that a drawer renders through
// the component), agent-chat-input, agent-chat-send, agent-chat-messages, agent-chat-message,
// agent-chat-error. The api call a Send makes (askOracle, askProductOwner, askSupervisorChat) stays
// pending until the test settles it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom, textOf } = require('./mini-dom');
// pageScripts / makeStorage are shared with the selector-keyed harness (requiring it also records
// unhandled rejections a view leaves behind instead of failing the run)
const { pageScripts, makeStorage, RENDERER } = require('./renderer-app-harness');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// what a few methods resolve to by default (simulation only, empty conversations)
const API_DEFAULTS = {
  appInfo: () => ({ simulationOnly: true }),
  checkEnv: () => ({}),
  getSettings: () => ({}),
  getWorkspace: () => ({}),
  oracleHistory: () => [],
  oracleState: () => ({}),
  supervisorChatHistory: () => [],
  supervisorTools: () => [],
  productOwnerHistory: () => [],
};

async function loadPage({ api: overrides = {} } = {}) {
  const calls = [];
  const handlers = {};
  const api = new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (name === 'platform') return 'win32';
      if (name in overrides) return (...args) => { calls.push([name, args]); return overrides[name](...args); };
      if (/^on[A-Z]/.test(name)) return (fn) => { (handlers[name] ||= []).push(fn); return () => {}; };
      return async (...args) => { calls.push([name, args]); return name in API_DEFAULTS ? API_DEFAULTS[name]() : /^list/.test(name) ? [] : null; };
    },
  });
  const errors = [];
  const timer = (fn, ms, ...a) => { const t = setTimeout(() => { try { fn(...a); } catch (e) { errors.push(e); } }, ms); t.unref?.(); return t; };
  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    api,
    setTimeout: timer,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => timer(fn, 0),
    cancelAnimationFrame: () => {},
    queueMicrotask,
    structuredClone,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    Blob: class {},
    File: class {},
    FileReader: class { readAsDataURL() {} readAsText() {} },
    Image: class {},
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    Notification: class { static requestPermission() { return Promise.resolve('denied'); } },
    navigator: { platform: 'Win32', userAgent: 'node', clipboard: { writeText: async () => {} }, language: 'en-US', mediaDevices: {} },
    location: { hash: '', search: '', href: 'file:///index.html', protocol: 'file:', reload() {} },
    history: { pushState() {}, replaceState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    getSelection: () => ({ toString: () => '', removeAllRanges() {} }),
    alert() {},
    confirm: () => false,
    prompt: () => null,
    open() {},
    CSS: { escape: (v) => String(v) },
    fetch: async () => { throw new Error('no network in tests'); },
    marked: { parse: (s) => String(s ?? ''), use() {}, setOptions() {} },
    DOMPurify: { sanitize: (s) => String(s ?? ''), addHook() {} },
    Terminal: class { loadAddon() {} open() {} onData() {} onResize() {} write() {} dispose() {} focus() {} },
    FitAddon: { FitAddon: class { fit() {} proposeDimensions() { return null; } } },
    innerWidth: 1600,
    innerHeight: 1000,
  };
  const dom = createDom({ window: sandbox });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = dom.document;
  Object.assign(sandbox, dom.classes);
  vm.createContext(sandbox);
  dom.loadBody(fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8'));
  for (const src of pageScripts()) {
    try {
      vm.runInContext(fs.readFileSync(path.join(RENDERER, ...src.split('/')), 'utf8'), sandbox, { filename: src });
    } catch (e) {
      errors.push(Object.assign(e, { script: src }));
    }
  }
  dom.document.readyState = 'complete';
  dom.document.dispatchEvent(new dom.classes.Event('DOMContentLoaded'));
  await settle(20);
  const document = dom.document;
  return {
    sandbox, dom, document, calls, handlers, errors,
    run: (code) => vm.runInContext(code, sandbox),
    $: (sel) => document.querySelector(sel),
    callsTo: (name) => calls.filter(([n]) => n === name).map(([, args]) => args),
  };
}

// the component's part `testid` inside a drawer
function part(page, drawer, testid) {
  const el = page.$(`${drawer} [data-testid="${testid}"]`);
  assert.ok(el, `${drawer} has the chat component's [data-testid="${testid}"] (agent-chat.js)`);
  return el;
}

// The Oracle's drawer, on a screen other than Home (on Home the Oracle is the docked panel).
async function openOracle(api) {
  const page = await loadPage({ api });
  page.run("state.view = 'workflows'");
  page.sandbox.OracleChat.open();
  await settle();
  return page;
}

async function openSupervisor(api) {
  const page = await loadPage({ api });
  page.sandbox.openSupervisorChat();
  await settle();
  return page;
}

// The Product Owner's drawer with a project chosen in the Backlog.
async function openProductOwner(api) {
  const page = await loadPage({ api });
  const actions = page.sandbox.BacklogActions;
  assert.ok(actions, 'backlog.js sets window.BacklogActions');
  actions.projectId = () => 'demo';
  actions.project = () => ({ id: 'demo', name: 'Demo project' });
  await page.sandbox.BacklogPO.open();
  await settle();
  return page;
}

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
