// A test helper (not a test): loads the renderer page's own scripts (the `<script src>` lines of
// src/renderer/index.html, in their order, app.js and view-registry.js included) into one vm sandbox
// with a small permissive fake DOM and a fake `window.api`, so a test can drive the real screens:
// mount every view, call a view's show(), click a button, and read what a view rendered (an
// element's innerHTML / textContent / classList) and which api calls it made. Used by the tests of
// #253 (the Backlog Board without epics), #254 (the menu by the flow, the header's project selector)
// and #264 (the Supervisor drawer from Workflows).
//
// The fake DOM: `document.querySelector(sel)` returns one fake element per selector string (created
// on first use, so every `$('#id')` a view wires exists), or the element created with
// `document.createElement` whose id matches a `#id` selector. `querySelectorAll` returns [] (the
// delegated handlers are reached through `click(sel)`, which walks the target, the view's section and
// the document listeners, with a `closest()` that knows the target's own id and data-* attributes).
// Nothing is parsed: a test reads the markup strings the views produce.
// registerView mounts each view as it registers, like the page; `boot()` then fires DOMContentLoaded
// (app.js's init: the top bar, the sidebar's listeners, the first data from the fake api).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FileXHR, setCurrentScript } = require('./page-i18n');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
// window.api's plain values (not methods), as src/host/preload.js exposes them
const API_VALUES = { platform: 'win32' };
// what a few methods app.js's init() reads resolve to by default (simulation only, no CLI checks)
const API_DEFAULTS = {
  appInfo: () => ({ simulationOnly: true }),
  checkEnv: () => ({}),
  getSettings: () => ({}),
  getWorkspace: () => ({}),
  oracleHistory: () => [],
  supervisorChatHistory: () => [],
  supervisorTools: () => [],
};

// A rejected promise a view leaves behind (an api call that resolved to null) is recorded on the
// app that is loading or last loaded, not thrown at the test runner.
let current = null;
process.on('unhandledRejection', (e) => { current?.errors.push(e); });

/** The page's scripts (src/renderer-relative), in the order index.html loads them, vendor files and api-http.js left out. */
function pageScripts() {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1])
    .filter((src) => !src.startsWith('../../') && src !== 'api-http.js');
}

// #330 a view's markup, modals and panel are functions (drawn again in a new language): the tests read
// them as the string they draw in the current language; everything else is the view's own definition
function drawnDef(def) {
  const out = Object.create(def);
  for (const key of ['markup', 'modals', 'panel']) {
    if (typeof def[key] === 'function') Object.defineProperty(out, key, { get: () => def[key](), enumerable: true });
  }
  return out;
}

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

/**
 * Loads the page. Options:
 * - api: overrides of window.api methods ({ name: fn }); every other method resolves to null
 *   (`list*` to []), and `on*` methods record their handler.
 * - storage / session: initial localStorage / sessionStorage entries.
 * - state: fields merged into app.js's `state` after it loads.
 * - before(sandbox): runs right before the page's scripts (e.g. to preset globals).
 * - only: a filter over the script list (default: every script).
 */
function loadApp({ api: apiOverrides = {}, storage = {}, session = {}, state: stateFields = {}, only } = {}) {
  const elements = new Map(); // selector → fake element
  const created = []; // elements made by document.createElement
  const docListeners = {};
  const apiCalls = [];
  const apiHandlers = {};
  const errors = [];
  const defs = new Map(); // view id → registerView def

  let sandbox;
  const classListOf = (el) => {
    const set = new Set();
    return {
      set,
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        return on;
      },
      contains: (c) => set.has(c),
      replace: (a, b) => { if (set.delete(a)) set.add(b); },
      get length() { return set.size; },
      toString: () => [...set].join(' '),
      [Symbol.iterator]: () => set.values(),
      el,
    };
  };

  function makeEl(key = '', tag = 'div') {
    const el = {
      key,
      tagName: String(tag).toUpperCase(),
      id: key.startsWith('#') && /^#[\w-]+$/.test(key) ? key.slice(1) : '',
      innerHTML: '',
      textContent: '',
      innerText: '',
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      title: '',
      type: '',
      style: { setProperty() {}, removeProperty() {} },
      dataset: {},
      attrs: {},
      listeners: {},
      inserted: [], // insertAdjacentHTML calls: [position, html]
      appended: [], // append / prepend / appendChild / insertBefore nodes
      children: [],
      childNodes: [],
      isConnected: true,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      offsetHeight: 0,
      offsetWidth: 0,
      parentElement: null,
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return k in this.attrs; },
      toggleAttribute(k, force) { const on = force === undefined ? !(k in this.attrs) : !!force; if (on) this.attrs[k] = ''; else delete this.attrs[k]; return on; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
      dispatchEvent(ev) { for (const fn of this.listeners[ev?.type] || []) fn(ev); return true; },
      querySelector: (sel) => sandbox.document.querySelector(sel),
      querySelectorAll: () => [],
      getElementsByTagName: () => [],
      getElementsByClassName: () => [],
      closest(sel) { return matches(this, sel) ? this : null; },
      matches(sel) { return matches(this, sel); },
      insertAdjacentHTML(pos, html) { this.inserted.push([pos, html]); },
      insertAdjacentElement(pos, node) { this.appended.push(node); return node; },
      append(...nodes) { this.appended.push(...nodes); },
      prepend(...nodes) { this.appended.unshift(...nodes); },
      appendChild(node) { this.appended.push(node); return node; },
      insertBefore(node) { this.appended.push(node); return node; },
      replaceChildren(...nodes) { this.appended = [...nodes]; },
      replaceWith() {},
      before() {},
      after() {},
      remove() { this.isConnected = false; },
      removeChild(n) { return n; },
      focus() {},
      blur() {},
      select() {},
      click() { this.onclick?.(event('click', this)); this.dispatchEvent(event('click', this)); },
      scrollIntoView() {},
      scrollTo() {},
      setSelectionRange() {},
      showModal() {},
      close() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
      getClientRects: () => [],
      contains: () => false,
      cloneNode() { return makeEl('', tag); },
      animate: () => ({ finished: Promise.resolve(), cancel() {} }),
    };
    el.classList = classListOf(el);
    Object.defineProperty(el, 'className', {
      get() { return el.classList.toString(); },
      set(v) { el.classList.set.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c)); },
      enumerable: true,
    });
    Object.defineProperty(el, 'firstElementChild', { get: () => null });
    Object.defineProperty(el, 'lastElementChild', { get: () => null });
    Object.defineProperty(el, 'nextElementSibling', { get: () => null });
    Object.defineProperty(el, 'previousElementSibling', { get: () => null });
    return el;
  }

  // `#id`, `[data-x]`, `[data-x="v"]`, `.class` and comma lists, against the element's own attributes
  function matches(el, sel) {
    return String(sel).split(',').map((s) => s.trim()).some((s) => {
      let m;
      if ((m = /^#([\w-]+)$/.exec(s))) return el.id === m[1];
      if ((m = /^\.([\w-]+)$/.exec(s))) return el.classList.contains(m[1]);
      if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s))) {
        const name = m[1];
        const dataKey = name.startsWith('data-') ? name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
        const v = dataKey && dataKey in el.dataset ? el.dataset[dataKey] : el.attrs[name];
        return v !== undefined && (m[2] === undefined || String(v) === m[2]);
      }
      return false;
    });
  }

  function event(type, target, extra = {}) {
    return {
      type, target, currentTarget: target, key: '', button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra,
    };
  }

  const document = {
    hidden: false,
    activeElement: null,
    readyState: 'loading',
    title: '',
    documentElement: makeEl('html', 'html'),
    head: makeEl('head', 'head'),
    querySelector(sel) {
      const m = /^#([\w-]+)$/.exec(sel);
      if (m) {
        const made = created.find((e) => e.id === m[1]);
        if (made) return made;
      }
      if (!elements.has(sel)) elements.set(sel, makeEl(sel));
      return elements.get(sel);
    },
    querySelectorAll: () => [],
    getElementById(id) { return document.querySelector(`#${id}`); },
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    createElement(tag) { const el = makeEl('', tag); created.push(el); return el; },
    createElementNS(_ns, tag) { const el = makeEl('', tag); created.push(el); return el; },
    createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: () => makeEl('', 'fragment'),
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn); },
    dispatchEvent(ev) { for (const fn of docListeners[ev?.type] || []) fn(ev); return true; },
    execCommand: () => false,
    hasFocus: () => true,
  };
  document.body = makeEl('body', 'body');

  const api = new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (name in API_VALUES && !(name in apiOverrides)) return API_VALUES[name];
      if (name in apiOverrides) {
        if (typeof apiOverrides[name] !== 'function') return apiOverrides[name];
        return (...args) => { apiCalls.push([name, args]); return apiOverrides[name](...args); };
      }
      if (/^on[A-Z]/.test(name)) return (fn) => { (apiHandlers[name] ||= []).push(fn); return () => {}; };
      return async (...args) => { apiCalls.push([name, args]); return name in API_DEFAULTS ? API_DEFAULTS[name]() : /^list/.test(name) ? [] : null; };
    },
  });

  class FakeEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } preventDefault() {} stopPropagation() {} }
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  const timer = (fn, ms, ...a) => { const t = setTimeout(() => { try { fn(...a); } catch (e) { errors.push(e); } }, ms); t.unref?.(); return t; };

  sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    document,
    localStorage: makeStorage(storage),
    sessionStorage: makeStorage(session),
    api,
    setTimeout: timer,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => timer(fn, 0),
    cancelAnimationFrame: () => {},
    queueMicrotask,
    structuredClone,
    CustomEvent: FakeEvent,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    MutationObserver: Observer,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
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
    HTMLElement: class {},
    Element: class {},
    Node: class {},
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
  };
  sandbox.XMLHttpRequest = FileXHR; // i18n.js reads its catalogs (#329)
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = (type, fn) => document.addEventListener(type, fn);
  sandbox.removeEventListener = (type, fn) => document.removeEventListener(type, fn);
  sandbox.dispatchEvent = (ev) => document.dispatchEvent(ev);
  sandbox.innerWidth = 1600;
  sandbox.innerHeight = 1000;
  vm.createContext(sandbox);

  let scripts = pageScripts();
  if (only) scripts = scripts.filter(only);
  for (const src of scripts) {
    const code = fs.readFileSync(path.join(RENDERER, ...src.split('/')), 'utf8');
    setCurrentScript(sandbox.document, path.join(RENDERER, ...src.split('/')));
    try {
      vm.runInContext(code, sandbox, { filename: src });
    } catch (e) {
      errors.push(Object.assign(e, { script: src }));
    }
    // capture every registered view (the wrapper keeps the page's own registerView behaviour)
    if (src === 'view-registry.js' && typeof sandbox.registerView === 'function' && !sandbox.registerView.wrapped) {
      const original = sandbox.registerView;
      const wrapper = (def) => {
        defs.set(def.id, drawnDef(def));
        try { return original(def); } catch (e) { errors.push(Object.assign(e, { script: `mount of ${def.id}` })); return undefined; }
      };
      wrapper.wrapped = true;
      sandbox.registerView = wrapper;
    }
    if (src === 'app.js') {
      try { Object.assign(vm.runInContext('state', sandbox), stateFields); } catch { /* no state */ }
    }
  }

  current = { errors };
  const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

  return {
    sandbox,
    defs,
    errors,
    apiCalls,
    apiHandlers,
    created,
    elements,
    settle,
    /** Fires DOMContentLoaded (app.js's init: the top bar, the sidebar's listeners, the first data) and waits. */
    async boot() {
      document.readyState = 'complete';
      document.dispatchEvent(event('DOMContentLoaded', document));
      await settle(20);
    },
    /** The fake element for a selector (the one the views wired). */
    el: (sel) => document.querySelector(sel),
    /** The page's `state` (app.js). */
    state: () => vm.runInContext('state', sandbox),
    /** Runs code in the page's realm. */
    run: (code) => vm.runInContext(code, sandbox),
    /** The api calls made to `name`, as arrays of arguments. */
    callsTo: (name) => apiCalls.filter(([n]) => n === name).map(([, args]) => args),
    /**
     * Clicks the element `sel` (with optional dataset/attrs/checked): its onclick and click
     * listeners, then the given ancestors' (selectors), then the document's, until one stops it.
     */
    async click(sel, { dataset = {}, attrs = {}, checked, within = [] } = {}) {
      const target = document.querySelector(sel);
      Object.assign(target.dataset, dataset);
      Object.assign(target.attrs, attrs);
      if (checked !== undefined) target.checked = checked;
      const ev = event('click', target);
      const chain = [target, ...within.map((s) => document.querySelector(s))];
      for (const node of chain) {
        if (ev.stopped) break;
        ev.currentTarget = node;
        await node.onclick?.(ev);
        for (const fn of node.listeners.click || []) await fn(ev);
      }
      if (!ev.stopped) for (const fn of docListeners.click || []) await fn(ev);
      await settle();
      return target;
    },
    /** A keydown on the document (e.g. Escape). */
    async key(key) {
      const ev = event('keydown', document.body, { key });
      for (const fn of docListeners.keydown || []) await fn(ev);
      await settle();
    },
  };
}

/** Every nav entry the registered views declare, flattened: [{ id, label, order, group, tab, icon, … }]. */
function navEntries(defs) {
  const out = [];
  for (const [id, def] of defs) {
    if (!def.nav) continue;
    for (const entry of Array.isArray(def.nav) ? def.nav : [def.nav]) out.push({ id, ...entry });
  }
  return out;
}

/** The text of some markup: tags dropped, entities decoded, spaces collapsed. */
const text = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

module.exports = { loadApp, makeStorage, navEntries, pageScripts, text, RENDERER };
