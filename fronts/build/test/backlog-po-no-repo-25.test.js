// #25 acceptance, written before the code: the Product Owner drawer (fronts/build/views/backlog/backlog-po.js) on a
// project created without a repository. Today the owner types a request and only then reads the engine's
// "Sync the backlog first: the Product Owner reads the synced issues." Expected (decision of #25: "add a
// repository"): as soon as the drawer opens, before the owner types, it says the project has no repository, in
// the interface language, and sending is off.
//
// The contract assumed here:
// - the drawer reads the project record it already reads (BacklogActions.project() / state.projects); a record
//   without `repo` is a project with no repository;
// - the notice is an element data-testid="po-no-repo-notice" whose text holds the catalog's
//   backlog_po.no_repo_notice in the interface language;
// - the send button #btn-po-ask (or the input #po-question) is disabled, even after the owner types;
// - a project with a repository: no notice, and typing enables sending as today.
//
// Harness: the whole drawer in a vm sandbox with a small fake DOM, as renderer-backlog-po-refusal-28.test.js (the
// real LiveTurn, AgentChat, WorkflowInputs and backlog-po-settings.js); api.* is the boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('@craftorio/ui-kit/test/page-pieces');
const I18n = require('@craftorio/shared/i18n');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const textOfKey = (lang, key) => String(catalog(lang)[key] ?? `(missing ${key})`);

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

const NO_REPO = { id: 'proj-a', name: 'Field Notes', repo: null, folder: '/ws/projects/field-notes' };
const WITH_REPO = { id: 'proj-a', name: 'Field Notes', repo: 'https://github.com/o/field-notes.git', folder: '/ws/repos/field-notes' };

async function openDrawer(lang, project) {
  I18n.setLanguage(lang);
  const projects = [project];
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, fakeEl(sel)); return els.get(sel); };
  const docListeners = {};
  const asked = [];
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
      askProductOwner: (...args) => new Promise((resolve, reject) => asked.push({ resolve, reject, n: args.length })),
      productOwnerHistory: async () => [], onChatProgress: () => {}, cancelChatTurn: async () => {},
      clearProductOwner: async () => [], listAgents: async () => [], saveAgent: async (_id, d) => d,
    },
    state: { view: 'backlog', workflows: [], settings: {}, projects },
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
      projectId: () => project.id, project: () => projects[0], data: () => (project.repo ? { issues: [] } : null),
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
  await $('#btn-bl-po').onclick(); await settle();
  // the notice's visible text wherever the drawer drew it (null when none): a string, never a node
  const notice = () => {
    for (const el of els.values()) {
      const found = H.findEl(String(el.innerHTML || ''), (e) => e.attrs['data-testid'] === 'po-no-repo-notice');
      if (found) return H.visibleText(found.inner);
      if (el.dataset?.testid === 'po-no-repo-notice' && !el.hidden) return String(el.textContent || '');
    }
    return null;
  };
  const type = async (text) => {
    $('#po-question').value = text;
    for (const fn of $('#po-question').listeners.input || []) fn({ target: $('#po-question') });
    await settle();
  };
  const sendOff = () => $('#btn-po-ask').disabled === true || $('#po-question').disabled === true;
  // Enter in the text box (the AgentChat's keydown), as the owner presses it
  const pressEnter = async () => {
    const ev = { key: 'Enter', shiftKey: false, isComposing: false, target: $('#po-question'), preventDefault() {} };
    for (const fn of $('#po-question').listeners.keydown || []) fn(ev);
    await settle();
  };
  // a click on Send, then the engine (the boundary) rejecting the pending question with `error`
  const sendAndReject = async (error) => {
    $('#btn-po-ask').onclick({ preventDefault() {} }); await settle();
    asked.shift().reject(new Error(error)); await settle();
  };
  // the text of the chat's error line ('' when none): a string, never a node
  const errorLine = () => {
    for (const el of els.values()) {
      const m = /data-testid="agent-chat-error"[^>]*>([^<]*)</.exec(String(el.innerHTML));
      if (m) return m[1];
    }
    return '';
  };
  return { notice, type, sendOff, pressEnter, sendAndReject, errorLine, askedCount: () => asked.length };
}

// ---- a project without a repository -----------------------------------------------------------------

test('#25 no repository, en: the drawer shows data-testid="po-no-repo-notice" before the owner types', async () => {
  const d = await openDrawer('en', NO_REPO);
  assert.equal(d.notice() === null, false, 'the notice is shown');
});

test('#25 no repository, en: the notice reads backlog_po.no_repo_notice in English', async () => {
  const d = await openDrawer('en', NO_REPO);
  const text = d.notice() || '';
  assert.equal(text.includes(textOfKey('en', 'backlog_po.no_repo_notice')), true, `the notice: ${text}`);
});

test('#25 no repository, pt-BR: the notice reads backlog_po.no_repo_notice in Portuguese', async () => {
  const d = await openDrawer('pt-BR', NO_REPO);
  const text = d.notice() || '';
  assert.equal(text.includes(textOfKey('pt-BR', 'backlog_po.no_repo_notice')), true, `the notice: ${text}`);
  assert.equal(/repositório/i.test(text), true, `it says "repositório": ${text}`);
});

test('#25 no repository: sending is off even after the owner types', async () => {
  const d = await openDrawer('en', NO_REPO);
  await d.type('Create an issue for the login page');
  assert.equal(d.sendOff(), true, '#btn-po-ask or #po-question disabled');
});

test('#25 no repository, pt-BR: sending is off even after the owner types', async () => {
  const d = await openDrawer('pt-BR', NO_REPO);
  await d.type('Criar uma issue para a página de login');
  assert.equal(d.sendOff(), true, '#btn-po-ask or #po-question disabled');
});

test('#25 no repository: Enter in the text box sends nothing and the notice stays', async () => {
  const d = await openDrawer('en', NO_REPO);
  await d.type('Create an issue for the login page');
  await d.pressEnter();
  assert.equal(d.askedCount(), 0, 'nothing was asked to the Product Owner');
  assert.equal(d.notice() === null, false, 'the notice is still shown');
});

// ---- the engine's no-repository refusal reaching the drawer (e.g. the record changed under it) ---------

const ENGINE_NO_REPO = 'This project has no repository: add its URL in Projects › Edit to file issues.';

test('#25 pt-BR: the engine\'s "has no repository" refusal shows in Portuguese in the error line', async () => {
  const d = await openDrawer('pt-BR', WITH_REPO);
  await d.type('Criar uma issue para a página de login');
  await d.sendAndReject(ENGINE_NO_REPO);
  const line = d.errorLine();
  assert.equal(line, esc(textOfKey('pt-BR', 'backlog_po.no_repo_notice')));
  assert.equal(/has no repository/.test(line), false, `no English left: ${line}`);
});

test('#25 pt-BR: another engine error is still shown as it came', async () => {
  const d = await openDrawer('pt-BR', WITH_REPO);
  await d.type('Criar uma issue para a página de login');
  await d.sendAndReject('The model call failed');
  assert.equal(d.errorLine(), 'The model call failed');
});

// ---- a project with a repository: unchanged ---------------------------------------------------------

test('#25 with a repository: no po-no-repo-notice', async () => {
  const d = await openDrawer('en', WITH_REPO);
  assert.equal(d.notice(), null);
});

test('#25 with a repository: typing a request enables sending as today', async () => {
  const d = await openDrawer('en', WITH_REPO);
  await d.type('Create an issue for the login page');
  assert.equal(d.sendOff(), false);
});
