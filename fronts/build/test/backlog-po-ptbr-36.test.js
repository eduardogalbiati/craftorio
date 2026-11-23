// #36 acceptance, written before the code: the Product Owner drawer's simulation-only scenario picker ("Cenário
// simulado", fronts/build/views/backlog/backlog-po.js SCENARIOS, shown in Developer mode) listed its options in English
// in the pt-BR interface ("Default (built from the backlog)", "A pending question", "A draft ready to file", …).
// Expected: in pt-BR none of the options reads its English label; in English they stay as they are.
//
// Harness of renderer-backlog-po-refusal-28.test.js (the whole drawer in a vm sandbox with a small fake DOM, the real
// LiveTurn, AgentChat, WorkflowInputs and backlog-po-settings.js), Developer mode on; seam: #btn-bl-po's onclick
// (opens the drawer) and the markup the drawer draws in #po-scenario (the picker's buttons).
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

const ENGLISH = [
  'Default (built from the backlog)', 'A pending question', 'A draft ready to file', 'A duplicate found', 'A large draft',
  'A long attachments list', 'Several groups (applied, partly applied)', 'A large answer', 'An error answer',
];

test.afterEach(() => I18n.setLanguage('en'));

function fakeEl(selector) {
  const classes = new Set();
  const listeners = {};
  const attrs = {};
  const el = {
    selector, innerHTML: '', textContent: '', value: '', placeholder: '', title: '', disabled: false, hidden: false,
    dataset: {}, style: {}, scrollHeight: 0, clientHeight: 0, scrollTop: 0, listeners,
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
  return el;
}

const PROJECTS = [{ id: 'proj-a', name: 'Project A' }];

// the drawer opened in `lang` with Developer mode on → the picker's option texts (strings)
async function scenarioOptions(lang) {
  I18n.setLanguage(lang);
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, fakeEl(sel)); return els.get(sel); };
  const docListeners = {};
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
      askProductOwner: () => new Promise(() => {}),
      productOwnerHistory: async () => [], onChatProgress: () => {}, cancelChatTurn: async () => {},
      clearProductOwner: async () => [], listAgents: async () => [], saveAgent: async (_id, d) => d,
    },
    state: { view: 'backlog', workflows: [], settings: {}, projects: PROJECTS },
    esc,
    errMsg: (e) => String(e?.message || e),
    devMode: () => true,
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
  await $('#btn-bl-po').onclick(); await settle();
  const html = String($('#po-scenario').innerHTML);
  return [...html.matchAll(/data-po-scenario="[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
}

test('#36 pt-BR: the simulated scenario picker\'s options are not the English labels', async () => {
  const shown = await scenarioOptions('pt-BR');
  assert.equal(shown.length, ENGLISH.length, 'the picker lists every scenario');
  assert.deepEqual(shown.filter((s) => ENGLISH.map(esc).includes(s)), []);
});

test('#36 English unchanged: the simulated scenario picker lists "Default (built from the backlog)", "A pending question", "A draft ready to file"', async () => {
  const shown = await scenarioOptions('en');
  assert.deepEqual(shown.slice(0, 3), ['Default (built from the backlog)', 'A pending question', 'A draft ready to file']);
});
