// Test helper (not a test) for the agent chats' page tests (#274): the whole page loaded, the
// drawers opened through their public entry points.
//
// src/renderer/index.html's <body> is parsed into test/mini-dom.js (a small real DOM), then every
// script index.html lists, in its order, runs in one vm sandbox with a fake window.api (every method
// resolves to null, `list*` to [], `on*` records its handler; a test overrides the methods it drives).
// app.js's init runs on DOMContentLoaded. A script that fails to load is recorded, not thrown
// (unrelated screens may need APIs the fake DOM lacks).
// Used by test/agent-chat-drawers-274.test.js and test/agent-chat-drawers-review-274.test.js.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { FileXHR, setCurrentScript } = require('@multiagent/shared/test/page-i18n');
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

// location (#488): fields over the default file:///index.html one, e.g. { search: '?import=<url>' }
async function loadPage({ api: overrides = {}, location = {} } = {}) {
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
    location: { hash: '', search: '', href: 'file:///index.html', protocol: 'file:', reload() {}, ...location },
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
    XMLHttpRequest: FileXHR, // i18n.js reads its catalogs (#329)
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
      setCurrentScript(dom.document, path.join(RENDERER, ...src.split('/')));
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

module.exports = { settle, deferred, loadPage, part, openOracle, openSupervisor, openProductOwner, pageScripts };
