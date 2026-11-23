// #28: the Product Owner drawer (fronts/build/views/backlog/backlog-po.js) showed the engine's "no synced backlog"
// refusal ("Sync the backlog first: the Product Owner reads the synced issues.", packages/engine/service/channels/
// product-owner.js) in English in the pt-BR interface. Expected: the drawer's error line says it in the interface
// language; any other error is shown as it came.
//
// Harness: the whole drawer in a vm sandbox with a small fake DOM, as renderer-backlog-po-input-26.test.js (the real
// LiveTurn, AgentChat, WorkflowInputs and backlog-po-settings.js). Seams: #btn-bl-po's onclick (opens the drawer),
// #po-question + #btn-po-ask's onclick (asks), the stubbed api.askProductOwner (the boundary) rejecting, and the
// markup the drawer draws (the shared chat's [data-testid="agent-chat-error"] line).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

const REFUSAL = 'Sync the backlog first: the Product Owner reads the synced issues.';

test.afterEach(() => I18n.setLanguage('en'));

function fakeEl(selector) {
  const classes = new Set();
  const listeners = {};
  const attrs = {};
  let scrollTop = 0;
  const el = {
    selector, innerHTML: '', textContent: '', value: '', placeholder: '', title: '', disabled: false, hidden: false,
    dataset: {}, style: {}, scrollHeight: 0, clientHeight: 0, listeners,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute: (k) => k in attrs,
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    focus() {}, blur() {}, click() {}, select() {}, setSelectionRange() {}, scrollIntoView() {}, scrollTo() {},
    matches: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    appendChild() {}, remove() {},
    insertAdjacentHTML(_pos, html) { el.innerHTML += html; },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => { scrollTop = Math.max(0, Math.min(Number(v) || 0, Math.max(0, el.scrollHeight - el.clientHeight))); },
    enumerable: true,
  });
  return el;
}

const PROJECTS = [{ id: 'proj-a', name: 'Project A' }];

function loadDrawer(lang) {
  I18n.setLanguage(lang);
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, fakeEl(sel)); return els.get(sel); };
  const docListeners = {};
  const pending = [];
  const store = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {},
    document: {
      querySelector: $, querySelectorAll: () => [], getElementById: (id) => $(`#${id}`),
      addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); }, removeEventListener() {},
      dispatchEvent(ev) { for (const fn of docListeners[ev.type] || []) fn(ev); return true; },
      createElement: (tag) => fakeEl(tag), hidden: false, activeElement: null,
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    api: {
      askProductOwner: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      productOwnerHistory: async () => [], onChatProgress: () => {}, cancelChatTurn: async () => {},
      clearProductOwner: async () => [], listAgents: async () => [], saveAgent: async (_id, d) => d,
    },
    state: { view: 'backlog', workflows: [], settings: {}, projects: PROJECTS },
    esc,
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    fmtCost: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    fmtSize: (n) => `${n} B`,
    markdownHtml: (s) => esc(s),
    confirmDialog: async () => true,
    Robots: { svg: () => '<svg class="robot"></svg>' },
    productOwnerAgent: { model: 'claude-opus-5-5', effort: 'high', calibration: 2, cost: 3 },
    BacklogPoProposals: { splitsHtml: () => '', epicsHtml: () => '', onClick: () => false, onInput: () => {} },
    BacklogActions: {
      projectId: () => 'proj-a', project: () => PROJECTS[0], data: () => ({ issues: [] }),
      assignGroup: async () => [], roadmapGroup: async () => [], showData: () => {}, showRoadmap: () => {}, openStage: () => {},
    },
    reportNotifyContext: () => {}, showRun: () => {}, addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('live-turn.js'), sandbox);
  if (pageFileOf('activity-line.js')) vm.runInContext(read('activity-line.js'), sandbox);
  vm.runInContext(read('agent-chat.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'po-calibration.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  vm.runInContext(read('agent-request.js'), sandbox);
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po-settings.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po.js'), sandbox);
  Object.assign($('#po-log'), { scrollHeight: 1000, clientHeight: 200 });
  // the text of the chat's error line, wherever the drawer drew it ('' when none): a string, never a node
  const errorLine = () => {
    for (const el of els.values()) {
      const m = /data-testid="agent-chat-error"[^>]*>([^<]*)</.exec(String(el.innerHTML));
      if (m) return m[1];
    }
    return '';
  };
  return {
    errorLine,
    ask: async (question, error) => {
      await $('#btn-bl-po').onclick(); await settle();
      $('#po-question').value = question;
      for (const fn of $('#po-question').listeners.input || []) fn({ target: $('#po-question') });
      $('#btn-po-ask').onclick({ preventDefault() {} }); await settle();
      pending.shift().reject(new Error(error)); await settle();
    },
  };
}

test('#28 pt-BR: the "Sync the backlog first" refusal shows in Portuguese in the drawer\'s error line', async () => {
  const d = loadDrawer('pt-BR');
  await d.ask('Quais issues rodar juntas?', REFUSAL);
  const line = d.errorLine();
  assert.equal(line, esc('Sincronize o backlog antes: o Product Owner lê as issues sincronizadas.'));
  assert.doesNotMatch(line, /Sync the backlog first/);
});

test('#28 English: the same refusal reads as the engine wrote it', async () => {
  const d = loadDrawer('en');
  await d.ask('Which issues run together?', REFUSAL);
  assert.equal(d.errorLine(), esc(REFUSAL));
});

test('#28 pt-BR: another error is shown as it came (only the refusal is translated)', async () => {
  const d = loadDrawer('pt-BR');
  await d.ask('Quais issues rodar juntas?', 'The model call failed');
  assert.equal(d.errorLine(), 'The model call failed');
});
