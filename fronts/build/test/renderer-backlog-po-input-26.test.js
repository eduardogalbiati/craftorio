// #26: the Product Owner drawer (fronts/build/views/backlog/backlog-po.js) kept another project's unsent
// text. Moving to another project reset the conversation, attachments, notes and edits but not the text
// box (#po-question): text typed in project A (or given back after A's turn failed) stayed there, and
// what the owner then typed in project B was glued to it and sent as B's question.
// Expected: when the drawer moves to another project, that project's text box starts empty, and the
// question sent from B is only what was typed in B. A failed turn still gives the question back to the
// box of the project it was asked in (#274, guarded here).
// Acceptance tests written before the code.
//
// Harness: the whole drawer in a vm sandbox with a small fake DOM, as renderer-backlog-po-busy.test.js
// (one fake element per selector, the real LiveTurn, AgentChat, PoCalibration, DefaultWorkflow,
// WorkflowInputs and backlog-po-settings.js). Seams: #btn-bl-po's onclick (opens the drawer on the
// Backlog's project, BacklogActions.projectId()), #btn-po-close's onclick, #po-question's value (what
// the owner typed), #btn-po-ask's onclick (Ask/Send) and the boundary: the stubbed
// api.askProductOwner(projectId, question, ...) the drawer calls.
// Not assumed: whether switching back to A restores A's draft (left to the developer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

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

const PROJECTS = [{ id: 'proj-a', name: 'Project A' }, { id: 'proj-b', name: 'Project B' }];

// The drawer loaded whole; the Backlog's project select holds `current.projectId`.
function loadDrawer({ projectId = 'proj-a' } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, fakeEl(sel)); return els.get(sel); };
  const docListeners = {};
  const asks = [];
  const pending = [];
  const store = new Map();
  const current = { projectId };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
    document: {
      querySelector: $,
      querySelectorAll: () => [],
      getElementById: (id) => $(`#${id}`),
      addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { for (const fn of docListeners[ev.type] || []) fn(ev); return true; },
      createElement: (tag) => fakeEl(tag),
      hidden: false,
      activeElement: null,
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    api: {
      askProductOwner: (...a) => { asks.push(a); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
      productOwnerHistory: async () => [],
      onChatProgress: () => {},
      cancelChatTurn: async () => {},
      clearProductOwner: async () => [],
      listAgents: async () => [],
      saveAgent: async (_id, d) => d,
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
      projectId: () => current.projectId,
      project: () => PROJECTS.find((p) => p.id === current.projectId) || null,
      data: () => ({ issues: [] }),
      assignGroup: async () => [],
      roadmapGroup: async () => [],
      showData: () => {},
      showRoadmap: () => {},
      openStage: () => {},
    },
    reportNotifyContext: () => {},
    showRun: () => {},
    addEventListener: () => {},
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
  const box = () => $('#po-question');
  return {
    asks,
    box: () => box().value,
    open: async () => { await $('#btn-bl-po').onclick(); await settle(); },
    close: () => $('#btn-po-close').onclick(),
    // the owner types: the keys add to what the box holds
    type: (text) => {
      box().value += text;
      for (const fn of box().listeners.input || []) fn({ target: box() });
    },
    send: async () => { $('#btn-po-ask').onclick({ preventDefault() {} }); await settle(); },
    fail: async () => { pending.shift().reject(new Error('The model call failed')); await settle(); },
    // the Backlog's project select moves to `id`, then the owner opens the drawer again
    switchTo: async (id) => {
      $('#btn-po-close').onclick();
      current.projectId = id;
      await $('#btn-bl-po').onclick();
      await settle();
    },
  };
}

test('#26 text typed in project A and not sent: once the drawer moves to project B, B\'s text box is empty', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Plan the login epic for project A');
  await d.switchTo('proj-b');
  assert.equal(d.box(), '');
});

test('#26 after A\'s turn failed (its question back in the box), project B\'s text box is empty', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Plan the login epic for project A');
  await d.send();
  await d.fail();
  await d.switchTo('proj-b');
  assert.equal(d.box(), '');
});

test('#26 the question sent from project B is only what was typed in B, not A\'s failed question glued to it', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Plan the login epic for project A');
  await d.send();
  await d.fail();
  await d.switchTo('proj-b');
  d.type('Which issues of project B can run in parallel?');
  await d.send();
  assert.equal(d.asks.length, 2, 'A\'s question, then B\'s');
  assert.equal(d.asks[1][0], 'proj-b', 'B\'s question goes to project B');
  assert.equal(d.asks[1][1], 'Which issues of project B can run in parallel?');
});

test('#26 the question sent from project B after unsent text in A carries only B\'s text', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('A draft for project A, never sent');
  await d.switchTo('proj-b');
  d.type('Analyze the backlog of project B');
  await d.send();
  assert.equal(d.asks.length, 1);
  assert.equal(d.asks[0][0], 'proj-b');
  assert.equal(d.asks[0][1], 'Analyze the backlog of project B');
});

test('#26 a turn of project A that fails after the drawer moved to project B does not put A\'s question in B\'s box', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Plan the login epic for project A');
  await d.send();
  await d.switchTo('proj-b');
  d.type('Typed in B');
  await d.fail();
  assert.equal(d.box(), 'Typed in B');
});

test('#26 reopening the drawer on the same project keeps the text left in its box', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Half-written question for A');
  await d.switchTo('proj-a');
  assert.equal(d.box(), 'Half-written question for A');
});

test('#26 back on project A after B, the box is empty (the chosen behaviour: a project switch clears the text)', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Draft for A');
  await d.switchTo('proj-b');
  await d.switchTo('proj-a');
  assert.equal(d.box(), '');
});

test('#26 guard: after a failed turn in project A the question is back in A\'s text box', async () => {
  const d = loadDrawer();
  await d.open();
  d.type('Plan the login epic for project A');
  await d.send();
  assert.equal(d.box(), '', 'the box empties as the question is sent');
  await d.fail();
  assert.equal(d.box(), 'Plan the login epic for project A');
});
