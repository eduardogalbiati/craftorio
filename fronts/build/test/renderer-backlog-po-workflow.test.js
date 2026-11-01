// #235: the Product Owner drawer plans for a workflow the owner picks (fronts/build/views/backlog/
// backlog-po.js, with backlog-po-settings.js for the Cost chip). Loaded whole in a vm sandbox with a
// small fake DOM (one fake element per selector, created on demand), the real DefaultWorkflow,
// WorkflowInputs, PoCalibration, LiveTurn and Estimates modules, and the real inputs of the bundled
// workflows (read from workflows/*.yaml), the same harness as test/renderer-backlog-po-busy.test.js.
// Contracts assumed (the markup the drawer renders, in any of its elements):
// - the workflow select carries data-testid="po-workflow" (options: value = the workflow file, text
//   = its display name); its options form carries data-testid="po-workflow-options";
// - a change of the select is handled by a `change` listener (on the select or delegated);
// - the header reads "Planning for <project name> · <workflow display name>"; the project's name
//   comes from window.BacklogActions.project() ({ id, name }) or state.projects;
// - the Cost chip (#po-cost-chip) gets the `hidden` class for ai-development-local-hero.yaml;
// - the choice is remembered per project; a plan question sends it as api.askProductOwner's 10th
//   argument (`workflow`, after `cost`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const yaml = require('js-yaml');

const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const tick = () => new Promise((r) => setTimeout(r, 0));

const AI_DEV = 'feature.yaml';
// #630: the code-first workflow with the Cost axis, now a workspace's own (no bundled one is left)
const SW_DEV = 'custom-dev.yaml';
const wf = (file) => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', file), 'utf8'));
  return { file, name: doc.metadata.name, description: doc.metadata.description, inputs: doc.inputs || {} };
};
const CUSTOM_DEV = {
  file: SW_DEV, name: 'Custom development', description: 'Code, then tests',
  inputs: { task: { type: 'string' }, unit_tests: { label: 'Unit tests', type: 'string', enum: ['write_and_run', 'off'], default: 'write_and_run' } },
};
// two workflows that take a task, one that does not (never offered)
const WORKFLOWS = [wf(AI_DEV), CUSTOM_DEV, { file: 'no-task.yaml', name: 'no-task', inputs: { repo_path: { type: 'string' } } }];
const PROJECTS = [{ id: 'proj-a1b2', name: 'Demo project' }, { id: 'proj-c3d4', name: 'Second project' }];

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

function loadDrawer({ projectId = 'proj-a1b2' } = {}) {
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
      listWorkflows: async () => WORKFLOWS,
    },
    state: { view: 'backlog', workflows: WORKFLOWS, settings: {}, projects: PROJECTS },
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
      data: () => ({ projectId: current.projectId, issues: [] }),
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
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po-settings.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-po.js'), sandbox);
  Object.assign($('#po-log'), { scrollHeight: 1000, clientHeight: 200 });

  const allText = () => text([...els.values()].map((e) => `${e.innerHTML} ${e.textContent}`).join(' '));
  // the markup of the element carrying data-testid=`id`: an element looked up by a selector naming it
  // (static markup), else its slice of whichever element's innerHTML renders it
  const region = (id) => {
    const own = (sel) => sel.includes(id) && !sel.includes(`${id}-`);
    for (const [sel, el] of els) if (own(sel) && el.innerHTML) return el.innerHTML;
    for (const el of els.values()) {
      const html = el.innerHTML;
      const at = html.indexOf(`data-testid="${id}"`);
      if (at < 0) continue;
      const start = html.lastIndexOf('<', at);
      const tag = /^<(\w+)/.exec(html.slice(start))?.[1];
      const next = html.indexOf('data-testid="', at + 12);
      let end = next < 0 ? html.length : html.lastIndexOf('<', next);
      if (tag === 'select') { const close = html.indexOf('</select>', at); if (close >= 0 && close < end) end = close; }
      return html.slice(start, end);
    }
    return null;
  };
  const selected = () => {
    const html = region('po-workflow') || '';
    const tag = /<option\b[^>]*\sselected\b[^>]*>/.exec(html)?.[0];
    if (tag) return /value="([^"]*)"/.exec(tag)?.[1] ?? null;
    for (const [sel, el] of els) if (sel.includes('po-workflow') && !sel.includes('po-workflow-') && el.value) return el.value;
    return null;
  };
  // the owner picks `file` in the workflow select: a change event whose target is the select,
  // delivered to every change handler but the drawer's other controls
  const OTHER = new Set(['#po-calib-chip', '#po-cost-chip', '#po-set-model', '#po-question', '#po-file-input', '#po-set-calibration-box', '#po-set-cost-box']);
  const choose = (file) => {
    const isSelect = (sel) => /po-workflow(?!-)/.test(String(sel)) || /^select$/i.test(String(sel));
    const target = { id: 'po-workflow', tagName: 'SELECT', value: file, dataset: { testid: 'po-workflow', poWorkflow: '' }, getAttribute: (k) => (k === 'data-testid' ? 'po-workflow' : null) };
    target.matches = isSelect;
    target.closest = (sel) => (isSelect(sel) ? target : null);
    for (const [sel, el] of els) if (/po-workflow(?!-)/.test(sel)) el.value = file;
    const ev = { type: 'change', target, currentTarget: target, preventDefault() {}, stopPropagation() {} };
    for (const [sel, el] of els) {
      if (OTHER.has(sel)) continue;
      if (typeof el.onchange === 'function') el.onchange(ev);
      for (const fn of el.listeners.change || []) fn(ev);
    }
    for (const fn of docListeners.change || []) fn(ev);
  };
  const isHidden = (el) => el.classList.contains('hidden') || el.hidden === true || el.style.display === 'none';
  return {
    $, asks, current, allText, region, selected, choose, isHidden,
    open: () => $('#btn-bl-po').onclick(),
    close: () => $('#btn-po-close').onclick(),
  };
}

const optionTags = (html) => [...String(html || '').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, label]) => ({ value: /value="([^"]*)"/.exec(attrs)?.[1], label: text(label).trim() }));

test('#235 Plan mode shows a workflow select (data-testid="po-workflow") listing the workflows that take a task, by display name', async () => {
  const d = loadDrawer();
  await d.open();
  const html = d.region('po-workflow');
  assert.ok(html, 'a data-testid="po-workflow" select is rendered');
  const options = optionTags(html);
  assert.deepEqual(options.map((o) => o.value).sort(), [AI_DEV, SW_DEV]);
  for (const o of options) {
    assert.doesNotMatch(o.label, /\.ya?ml$/, `"${o.label}" is a display name, not a file`);
    assert.notEqual(o.label, o.value.replace(/\.yaml$/, ''), `"${o.label}" is a display name, not the slug`);
  }
  assert.match(options.find((o) => o.value === AI_DEV).label, /feature/i);
});

test('#235 switching the workflow re-renders its options (data-testid="po-workflow-options") from that workflow\'s inputs, never task, issue, issues, repo_path or base_branch', async () => {
  const d = loadDrawer();
  await d.open();
  d.choose(AI_DEV);
  await tick();
  const ai = d.region('po-workflow-options');
  assert.ok(ai, 'a data-testid="po-workflow-options" container is rendered');
  assert.match(text(ai), /E2E command/, 'an input only ai-development-local-hero.yaml has');
  assert.match(text(ai), /Unit tests/);
  for (const key of ['task', 'issue', 'issues', 'repo_path', 'base_branch']) {
    assert.doesNotMatch(ai, new RegExp(`(data-wi-key|name|data-wi-input)="${key}"`), `no ${key} field`);
  }
  assert.doesNotMatch(text(ai), /Repository|Base branch/);

  d.choose(SW_DEV);
  await tick();
  const sw = d.region('po-workflow-options');
  assert.match(text(sw), /Unit tests/);
  assert.doesNotMatch(text(sw), /E2E command/, 'the options follow the newly chosen workflow');
});

test('#235 the Cost chip (#po-cost-chip) is hidden for AI Development (tests first) and shown for software-development-local-hero', async () => {
  const d = loadDrawer();
  await d.open();
  d.choose(SW_DEV);
  await tick();
  assert.equal(d.isHidden(d.$('#po-cost-chip')), false, 'shown for software-development-local-hero.yaml');
  d.choose(AI_DEV);
  await tick();
  assert.equal(d.isHidden(d.$('#po-cost-chip')), true, 'hidden for ai-development-local-hero.yaml');
});

test('#235 the header reads "Planning for <project name> · <workflow display name>", the project by its name, not its id', async () => {
  const d = loadDrawer();
  await d.open();
  d.choose(AI_DEV);
  await tick();
  const t = d.allText();
  assert.match(t, /Planning for Demo project\s*·\s*feature/i);
  assert.doesNotMatch(t, /Planning for proj-a1b2/);
});

test('#235 the chosen workflow is remembered per project: another project starts on the default, and back on the first one it is the last chosen', async () => {
  const d = loadDrawer();
  await d.open();
  // #630: the default development workflow is feature (AI_DEV)
  d.choose(SW_DEV);
  await tick();
  d.close();

  d.current.projectId = 'proj-c3d4';
  await d.open();
  assert.equal(d.selected(), AI_DEV, 'a project with no choice yet starts on the default development workflow');
  d.close();

  d.current.projectId = 'proj-a1b2';
  await d.open();
  assert.equal(d.selected(), SW_DEV);
});

test('#235 a plan question sends the chosen workflow to the Product Owner (api.askProductOwner\'s 10th argument, after cost)', async () => {
  const d = loadDrawer();
  await d.open();
  d.choose(AI_DEV);
  await tick();
  d.$('#po-question').value = 'Plan the login issues';
  d.$('#btn-po-ask').onclick();
  assert.equal(d.asks.length, 1);
  assert.equal(d.asks[0][9], AI_DEV);
});
