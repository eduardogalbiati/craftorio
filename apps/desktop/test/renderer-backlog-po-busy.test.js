// #234: the Product Owner drawer while a question is in flight (apps/desktop/renderer/views/backlog/backlog-po.js).
// The whole drawer script is evaluated in a vm sandbox with a small fake DOM (document.querySelector
// returns one fake element per selector, created on demand), the real LiveTurn, PoCalibration,
// DefaultWorkflow, WorkflowInputs and Estimates modules, and a stubbed api whose askProductOwner
// stays pending until the test settles it, so the busy state can be inspected.
// Seams: the drawer's own handlers (#btn-bl-po's onclick opens it, #po-chips' onclick is a pill
// click, #btn-po-ask's onclick, #po-question's keydown listener) and what it renders (#po-chips'
// innerHTML, #btn-po-ask.disabled, #po-question, #po-log's scrollTop, the text of the drawer).
// - pills, "Register an issue…" and Ask are disabled while busy; the text box is not, and keeps what
//   the owner typed; Enter while busy sends nothing;
// - a click scrolls the log to its end; a working line ("Product Owner is working" + 0:00) shows
//   while busy, gone after the answer;
// - a click with no project selected says "Choose a project in the Backlog first" and sends nothing;
// - everything is enabled again after the answer or an error;
// - style.css: `.chip:disabled` looks disabled (opacity, cursor: not-allowed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const tick = () => new Promise((r) => setTimeout(r, 0));

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
  // a browser clamps scrollTop to [0, scrollHeight - clientHeight]
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => { scrollTop = Math.max(0, Math.min(Number(v) || 0, Math.max(0, el.scrollHeight - el.clientHeight))); },
    enumerable: true,
  });
  return el;
}

// The drawer loaded whole; `projectId` is what the Backlog's project select holds (null: none).
function loadDrawer({ projectId = 'demo' } = {}) {
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
    state: { view: 'backlog', workflows: [], settings: {}, projects: [{ id: 'demo', name: 'Demo project' }] },
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
      project: () => (current.projectId ? { id: current.projectId, name: 'Demo project' } : null),
      data: () => ({ issues: [] }),
      assignGroup: async () => [],
      roadmapGroup: async () => [],
      showData: () => {},
      showRoadmap: () => {},
      openStage: () => {},
    },
    reportNotifyContext: () => {},
    showRun: () => {},
    // backlog-po.js redraws on agent-request:changed (#241)
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('live-turn.js'), sandbox);
  // #274: the drawer's chat goes through the agents' shared component
  vm.runInContext(read('agent-chat.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'po-calibration.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  vm.runInContext(read('agent-request.js'), sandbox);
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po-settings.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po.js'), sandbox);
  // the log: 1000 px of content in a 200 px box
  Object.assign($('#po-log'), { scrollHeight: 1000, clientHeight: 200 });
  const allText = () => text([...els.values()].map((e) => `${e.innerHTML} ${e.textContent}`).join(' '));
  return {
    $, asks, current, allText,
    open: () => $('#btn-bl-po').onclick(),
    // a suggested-question pill's click, the way #po-chips' delegated handler receives it
    clickPill: (q = 'Analyze the backlog and propose runs') => {
      const pill = { dataset: { q }, tagName: 'BUTTON' };
      pill.closest = (sel) => (/data-q/.test(sel) ? pill : null);
      pill.matches = (sel) => /data-q/.test(sel);
      return $('#po-chips').onclick({ target: pill, preventDefault() {}, stopPropagation() {} });
    },
    pressEnter: () => {
      const box = $('#po-question');
      for (const fn of box.listeners.keydown || []) fn({ key: 'Enter', shiftKey: false, isComposing: false, target: box, preventDefault() {} });
    },
    answer: (q = 'Analyze the backlog and propose runs') => pending.shift().resolve({ messages: [
      { role: 'user', text: q, ts: '2026-10-03T10:00:00.000Z' },
      { role: 'po', text: 'Here is the plan.', ts: '2026-10-03T10:00:30.000Z', costUsd: 0 },
    ] }),
    fail: () => pending.shift().reject(new Error('The model call failed')),
  };
}

// every <button> of the pills row (the suggested questions and "Register an issue…")
const pillTags = (d) => d.$('#po-chips').innerHTML.match(/<button\b[^>]*>/g) || [];
const isDisabledTag = (tag) => /\sdisabled(?=[\s>=/])/.test(tag);

test('#234 while a pill\'s question is in flight, every suggested-question pill, "Register an issue…" and Ask are disabled, the text box is not', async () => {
  const d = loadDrawer();
  await d.open();
  d.clickPill();
  const tags = pillTags(d);
  assert.ok(tags.length >= 7, `the six suggested questions and "Register an issue…" are rendered (got ${tags.length})`);
  for (const tag of tags) assert.ok(isDisabledTag(tag), `pill not disabled while busy: ${tag}`);
  assert.equal(d.$('#btn-po-ask').disabled, true, 'Ask is disabled while busy');
  assert.notEqual(d.$('#po-question').disabled, true, 'the text box stays enabled while busy');
});

test('#234 a pill click keeps what the owner typed in the text box, and text typed while busy is still there after the answer', async () => {
  const d = loadDrawer();
  await d.open();
  d.$('#po-question').value = 'A draft question I was writing';
  d.clickPill();
  assert.equal(d.$('#po-question').value, 'A draft question I was writing', 'the pill sent its own question; the typed text is kept');
  d.$('#po-question').value = 'Typed while the Product Owner works';
  d.answer();
  await tick();
  assert.equal(d.$('#po-question').value, 'Typed while the Product Owner works');
});

test('#234 Enter in the text box while a question is in flight sends nothing more (only the pill\'s question was sent)', async () => {
  const d = loadDrawer();
  await d.open();
  d.clickPill();
  d.$('#po-question').value = 'Another question';
  d.pressEnter();
  assert.equal(d.asks.length, 1);
  assert.equal(d.asks[0][1], 'Analyze the backlog and propose runs');
});

test('#234 a pill click scrolls the conversation to its end, even when the owner had scrolled up', async () => {
  const d = loadDrawer();
  await d.open();
  const log = d.$('#po-log');
  log.scrollTop = 100; // scrolled up, far from the end (1000 - 200 = 800)
  d.clickPill();
  await tick();
  await tick();
  assert.equal(log.scrollTop, log.scrollHeight - log.clientHeight);
});

test('#234 while busy a working line says "Product Owner is working" with the elapsed time (0:00); it is gone once the answer lands', async () => {
  const d = loadDrawer();
  await d.open();
  d.clickPill();
  const busy = d.allText();
  assert.match(busy, /Product Owner is working/);
  assert.match(busy, /\b0:0\d\b/, 'an elapsed time as m:ss');
  d.answer();
  await tick();
  assert.doesNotMatch(d.allText(), /Product Owner is working/);
});

test('#234 a pill click with no project selected shows "Choose a project in the Backlog first" and sends no question', async () => {
  const d = loadDrawer({ projectId: null });
  await d.open();
  d.clickPill();
  await tick();
  assert.equal(d.asks.length, 0, 'nothing was sent to the Product Owner');
  assert.match(d.allText(), /Choose a project in the Backlog first/);
});

test('#234 pills and Ask are enabled again after the answer, and after an error', async () => {
  const d = loadDrawer();
  await d.open();
  d.clickPill();
  d.answer();
  await tick();
  for (const tag of pillTags(d)) assert.ok(!isDisabledTag(tag), `pill still disabled after the answer: ${tag}`);
  assert.equal(d.$('#btn-po-ask').disabled, false);

  d.clickPill('Build a roadmap');
  assert.equal(d.$('#btn-po-ask').disabled, true);
  d.fail();
  await tick();
  for (const tag of pillTags(d)) assert.ok(!isDisabledTag(tag), `pill still disabled after an error: ${tag}`);
  assert.equal(d.$('#btn-po-ask').disabled, false);
});

test('#234 style.css gives a disabled pill (.chip:disabled) its own look: lower opacity and cursor: not-allowed', () => {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => sel.split(',').some((s) => /\.chip(\[disabled\]|:disabled)/.test(s.trim())));
  assert.ok(rules.length, 'a .chip:disabled rule exists');
  const body = rules.map(([, , b]) => b).join(';');
  assert.match(body, /opacity\s*:/);
  assert.match(body, /cursor\s*:\s*not-allowed/);
});

test('#234 with no project selected the drawer still opens, and a pill click shows the notice under the footer', async () => {
  const d = loadDrawer({ projectId: null });
  await d.open();
  assert.ok(d.$('#po-drawer').classList.contains('open'), 'the drawer opened');
  d.clickPill();
  await tick();
  const notice = d.$('#po-notice');
  assert.match(notice.textContent, /Choose a project in the Backlog first/);
  assert.equal(notice.classList.contains('hidden'), false, 'the notice is visible');
  assert.equal(d.asks.length, 0);
});

test('#234 a drawer closed while busy and reopened after the answer has its pills and Ask enabled again', async () => {
  const d = loadDrawer();
  await d.open();
  d.clickPill();
  d.$('#btn-po-close').onclick();
  assert.equal(d.$('#po-drawer').classList.contains('open'), false, 'the drawer closed');
  d.answer();
  await tick();
  await d.open();
  await tick();
  for (const tag of pillTags(d)) assert.ok(!isDisabledTag(tag), `pill still disabled: ${tag}`);
  assert.equal(d.$('#btn-po-ask').disabled, false);
  assert.doesNotMatch(d.allText(), /Product Owner is working/);
});
