// src/renderer/start-drawer.js (#154, moved out of app.js): the Start workflow drawer (#127 the
// main field is never remembered, #128 "Start and create another" keeps the drawer open, #132 no
// green CLI checkmarks) and the pending-start guard (a run update's renderHeader() must not
// re-enable the buttons while a start is in flight). It runs only inside the Electron renderer
// (document, window.api), so the relevant functions are pulled out of the source and evaluated in
// a sandbox with a minimal fake DOM, the way test/renderer-run-gates.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const drawerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'start-drawer.js'), 'utf8');
const workflowInputsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workflow-inputs.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');

function makeEl() {
  const classes = new Set();
  const el = {
    _value: '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this._btn = null; },
    disabled: false,
    checked: false,
    focused: false,
    _fields: [], // test fixture: simulates the current values of a <form>'s fields, for FormData
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle(c, force) { force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c)); },
    },
    setAttribute() {},
    focus() { this.focused = true; },
    insertAdjacentHTML(pos, html) { this._html += html; },
    querySelector(sel) {
      if (sel !== 'button') return null;
      if (!this._btn) this._btn = { onclick: null };
      return this._btn;
    },
    // WorkflowInputs.read(root) reads the current values straight from this fixture (set as
    // [key, value] pairs), the way the real DOM would expose each control's own value.
    querySelectorAll(sel) {
      if (sel !== '[data-wi-input]') return [];
      return this._fields.map(([k, v]) => ({ dataset: { wiInput: k }, type: 'text', value: v }));
    },
  };
  return el;
}

// Builds a sandbox with the Start drawer's functions loaded from the real source (never
// reimplemented), a fake DOM (one element per id used by these functions) and stubs for api and
// the few app.js functions that are out of scope here (selectRun, renderHeader, applyProjectHints
// elsewhere; WorkflowInputs itself is the real module, #116, not reimplemented either).
function loadStartDrawer({ workflows = [], projects = [], settings = {}, runs = new Map(), api = {} } = {}) {
  const defs = {
    LS_KEY: /const LS_KEY = [^\n]+;/,
    esc: /const esc = \(s\) => [^\n]+;/,
    isPathInput: /const isPathInput = \(key\) => [^\n]+;/,
    mainField: /const mainField = \(\) => [^\n]+;/,
    setStartDisabled: /function setStartDisabled\(disabled\) \{[\s\S]*?\n\}/,
    closeDrawer: /function closeDrawer\(\) \{[\s\S]*?\n\}/,
    oneRunAtATime: /const oneRunAtATime = [^\n]+;/,
    readInputs: /function readInputs\(\) \{[\s\S]*?\n\}/,
    startRun: /async function startRun\(\{ keepOpen = false \} = \{\}\) \{[\s\S]*?\n\}/,
    selectWorkflow: /function selectWorkflow\(file\) \{[\s\S]*?\n\}/,
    // "When it finishes" (#134): selectWorkflow and startRun both call drawerChain(), the drawer's
    // ChainPicker; out of scope here (see sandbox.ChainPicker below), only its wiring is loaded.
    chainPickerDecl: /let chainPicker = null;/,
    drawerChain: /const drawerChain = \(\) => [^\n]+;/,
  };
  const code = {};
  for (const [name, re] of Object.entries(defs)) {
    const m = re.exec(name === 'esc' ? src : drawerSrc);
    assert.ok(m, `${name} not found in ${name === 'esc' ? 'app.js' : 'start-drawer.js'}: the source moved`);
    code[name] = m[0];
  }

  const ids = ['start-error', 'start-info', 'drawer', 'drawer-backdrop', 'project-select', 'project-req',
    'project-info', 'inputs-form', 'adv-form', 'wf-desc', 'wf-steps-mini', 'wf-agents', 'mock-toggle', 'env-status'];
  const registry = new Map(ids.map((id) => [id, makeEl()]));
  const getEl = (id) => {
    if (!registry.has(id)) registry.set(id, makeEl());
    return registry.get(id);
  };
  const storage = new Map();
  const calls = { selectRun: [], renderHeader: 0 };

  const sandbox = {
    state: { wf: null, mainKey: null, projects, settings, runs, starting: false, workflows },
    api: { startRun: async () => ({ runId: 'r-new' }), setSettings: async (s) => ({ ...settings, ...s }), ...api },
    document: { getElementById: (id) => getEl(id) },
    localStorage: {
      setItem: (k, v) => storage.set(k, v),
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    },
    wantsSimulation: (box) => !!box?.checked,
    runLabel: (r) => r?.workflow || 'workflow',
    selectRun: (...a) => calls.selectRun.push(a),
    renderHeader: () => { calls.renderHeader += 1; },
    errMsg: (e) => String(e?.message || e),
    liveRuns: () => [...runs.values()].filter((v) => v.run?.status === 'running'),
    applyProjectHints: () => {}, // the project's detected language/branches (#116): out of scope here
    // "When it finishes" (#134): the drawer's chain picker itself is out of scope here (chain-picker.js,
    // test/chain-model.test.js); this stub only gives drawerChain() something to call. Nothing chosen.
    ChainPicker: { mount: () => ({ refresh: () => {}, value: () => null, set: () => {} }) },
  };
  sandbox.$ = (sel) => getEl(sel.slice(1));
  sandbox.window = sandbox; // WorkflowInputs (browser build) attaches itself to window
  vm.createContext(sandbox);
  vm.runInContext(workflowInputsSrc, sandbox);
  vm.runInContext(Object.values(code).join('\n') + '\nthis.helpers = { startRun, selectWorkflow, setStartDisabled, closeDrawer, mainField, oneRunAtATime };', sandbox);
  return { sandbox, helpers: sandbox.helpers, getEl, storage, calls };
}

// ---------------------------------------------------------------------------
// #132: no green checkmarks, only a missing CLI warns
// ---------------------------------------------------------------------------
function envStatusHtml(env) {
  const m = /\$\('#env-status'\)\.innerHTML = ([\s\S]*?);\n\}/.exec(src);
  assert.ok(m, 'the #env-status assignment in init() not found in app.js: the source moved');
  const sandbox = { env };
  vm.createContext(sandbox);
  return vm.runInContext(m[1], sandbox);
}

test('#env-status: every CLI on PATH renders no line at all (no green checkmarks)', () => {
  assert.equal(envStatusHtml({ claude: true, codex: true }), '');
});

test('#env-status: a missing CLI renders only its warning, nothing for the ones that are found', () => {
  const html = envStatusHtml({ claude: false, codex: true });
  assert.match(html, /✗ claude not found in PATH \(use simulation mode\)/);
  assert.doesNotMatch(html, /codex/);
  assert.doesNotMatch(html, /✓/);
});

test('style.css: the now-unused .env .ok rule is gone, and an empty #env-status leaves no gap', () => {
  assert.doesNotMatch(style, /\.env \.ok/);
  assert.match(style, /\.env:empty\s*\{\s*display:\s*none;\s*\}/);
});

// ---------------------------------------------------------------------------
// #127: the main field is never remembered
// ---------------------------------------------------------------------------
test('selectWorkflow: the main field ignores a previous save (even one from before this change); other fields still use it', () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true }, mode: { enum: ['auto', 'validated'], default: 'auto' } }, agents: {} }];
  const { sandbox, helpers, getEl } = loadStartDrawer({ workflows });
  sandbox.localStorage.setItem('multiagent.inputs.wf.yaml', JSON.stringify({ task: 'OLD TASK TEXT', mode: 'validated' }));

  helpers.selectWorkflow('wf.yaml');

  assert.equal(sandbox.state.mainKey, 'task');
  const inputsHtml = getEl('inputs-form').innerHTML;
  assert.match(inputsHtml, /id="in-task"/);
  assert.doesNotMatch(inputsHtml, /OLD TASK TEXT/, 'the main field must not be prefilled from localStorage');
  assert.match(inputsHtml, /placeholder="Describe what needs to be done…"/);
  // mode (a short enum) renders as pills (#116); the saved value "validated" is the one marked active
  assert.match(inputsHtml, /data-wi-input="mode"[^>]*value="validated"/, 'a non-main field (mode) still uses the saved value');
  assert.match(inputsHtml, /data-wi-pill="validated" class="active"[^>]*>Validated<\/button>/);
});

test('openDrawer: an explicit inputs prefill is applied after the workflow is selected, so it can still set the main field', () => {
  const openDrawer = /async function openDrawer\(\{[\s\S]*?\n\}/.exec(drawerSrc)[0];
  const renderCallIndex = openDrawer.indexOf('renderWorkflowOptions(');
  const prefillIndex = openDrawer.indexOf('if (inputs &&');
  assert.ok(renderCallIndex >= 0 && prefillIndex >= 0, 'openDrawer no longer renders the workflow or prefills inputs: the source moved');
  assert.ok(renderCallIndex < prefillIndex, 'the explicit inputs prefill must run after selectWorkflow (which clears the main field), or it would be wiped out');
});

// ---------------------------------------------------------------------------
// setStartDisabled: a pending start (state.starting) overrides whatever the caller computed
// ---------------------------------------------------------------------------
test('setStartDisabled / startRun: a renderHeader-style call during a pending start cannot re-enable the buttons; they are enabled again once the start settles', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true } }, agents: {} }];
  let resolveStart;
  const api = { startRun: () => new Promise((resolve) => { resolveStart = resolve; }) };
  const { sandbox, helpers } = loadStartDrawer({ workflows, api });
  sandbox.state.wf = workflows[0];
  const btnStart = sandbox.document.getElementById('btn-start');
  const btnAnother = sandbox.document.getElementById('btn-start-another');

  const p = helpers.startRun({});
  assert.equal(sandbox.state.starting, true, 'a start in flight sets state.starting');

  // a run update arrives while the start is pending and (wrongly, if unguarded) tries to re-enable
  helpers.setStartDisabled(false);
  assert.equal(btnStart.disabled, true, '#btn-start must stay disabled while starting');
  assert.equal(btnAnother.disabled, true, '#btn-start-another must stay disabled while starting');

  resolveStart({ runId: 'r1' });
  await p;
  assert.equal(sandbox.state.starting, false);
  helpers.setStartDisabled(false);
  assert.equal(btnStart.disabled, false, 'once the start settles, a normal call can enable the buttons again');
  assert.equal(btnAnother.disabled, false);
});

test('startRun: state.starting is false again after api.startRun rejects, so the buttons are not stuck disabled', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true } }, agents: {} }];
  const api = { startRun: async () => { throw new Error('engine: too many runs'); } };
  const { sandbox, helpers } = loadStartDrawer({ workflows, api });
  sandbox.state.wf = workflows[0];
  const btnStart = sandbox.document.getElementById('btn-start');

  await helpers.startRun({});

  assert.equal(sandbox.state.starting, false);
  helpers.setStartDisabled(false);
  assert.equal(btnStart.disabled, false);
});

// ---------------------------------------------------------------------------
// startRun: validation keeps the typed text; a successful default start clears it and closes
// ---------------------------------------------------------------------------
test('startRun: no project selected (one is required) keeps the drawer open and does not touch the saved inputs', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true }, project_path: { required: true } }, agents: {} }];
  const { sandbox, helpers, getEl, storage, calls } = loadStartDrawer({ workflows, projects: [] });
  sandbox.state.wf = workflows[0];
  getEl('inputs-form')._fields = [['task', 'Add a /health endpoint']];
  getEl('drawer').classList.add('open');

  await helpers.startRun({});

  assert.match(getEl('start-error').textContent, /Select a project/);
  assert.equal(getEl('drawer').classList.contains('open'), true, 'a validation error must not close the drawer');
  assert.equal(calls.selectRun.length, 0);
  assert.equal(storage.size, 0, 'nothing is saved to localStorage before the project/validation checks pass');
});

test('startRun: a successful default start saves non-main inputs, resets the main field to its default, closes and selects the run', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true, default: '' }, mode: { enum: ['auto', 'validated'], default: 'auto' } }, agents: {} }];
  const projects = [{ id: 'p1', name: 'Demo', folder: '/repo', exists: true }];
  const settings = { openRunOnStart: true };
  const runs = new Map([['r-new', { run: {} }]]);
  const { sandbox, helpers, getEl, storage, calls } = loadStartDrawer({ workflows, projects, settings, runs });
  sandbox.state.wf = workflows[0];
  sandbox.state.mainKey = 'task';
  getEl('project-select').value = 'p1';
  getEl('inputs-form')._fields = [['task', 'Add a /health endpoint'], ['mode', 'validated']];
  getEl('drawer').classList.add('open');

  await helpers.startRun({});

  assert.deepEqual(JSON.parse(storage.get('multiagent.inputs.wf.yaml')), { mode: 'validated' }, 'the main field (task) is never saved');
  assert.equal(getEl('drawer').classList.contains('open'), false, 'the default Start workflow button closes the drawer');
  assert.equal(calls.selectRun.length, 1);
  assert.equal(calls.selectRun[0][0], 'r-new');
  assert.deepEqual({ ...calls.selectRun[0][1] }, { open: true });
});

test('startRun({ keepOpen: true }): stays open, clears and focuses the main field, shows which run started', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true, default: '' } }, agents: {} }];
  const projects = [{ id: 'p1', name: 'Demo', folder: '/repo', exists: true }];
  const settings = { concurrentRuns: { enabled: true } };
  const runs = new Map([['r-new', { run: { workflow: 'wf.yaml' } }]]);
  const { sandbox, helpers, getEl, storage, calls } = loadStartDrawer({ workflows, projects, settings, runs });
  sandbox.state.wf = workflows[0];
  sandbox.state.mainKey = 'task';
  getEl('project-select').value = 'p1';
  getEl('inputs-form')._fields = [['task', 'Second task']];
  getEl('drawer').classList.add('open');
  const mainEl = getEl('in-task');
  mainEl.value = 'Second task';

  await helpers.startRun({ keepOpen: true });

  assert.equal(getEl('drawer').classList.contains('open'), true, 'Start and create another keeps the drawer open');
  assert.equal(calls.selectRun.length, 0, 'the shown run does not change for this button');
  assert.equal(mainEl.value, '', 'the main field is cleared');
  assert.equal(mainEl.focused, true, 'the main field is refocused');
  assert.match(getEl('start-info').innerHTML, /Started wf\.yaml/);
  assert.deepEqual(JSON.parse(storage.get('multiagent.inputs.wf.yaml')), {});
});

test('startRun({ keepOpen: true }): with concurrent runs off, the confirmation adds the "turn it on" hint', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true, default: '' } }, agents: {} }];
  const projects = [{ id: 'p1', name: 'Demo', folder: '/repo', exists: true }];
  const settings = { concurrentRuns: { enabled: false } };
  const runs = new Map([['r1', { run: { status: 'running' } }], ['r-new', { run: { workflow: 'wf.yaml' } }]]);
  const { sandbox, helpers, getEl } = loadStartDrawer({ workflows, projects, settings, runs });
  sandbox.state.wf = workflows[0];
  sandbox.state.mainKey = 'task';
  sandbox.state.runId = 'other'; // the already-running one is not the one shown
  getEl('project-select').value = 'p1';
  getEl('inputs-form')._fields = [['task', 'Second task']];

  await helpers.startRun({ keepOpen: true });

  assert.match(getEl('start-info').innerHTML, /Turn on concurrent runs in Settings › Execution/);
});

test('startRun: api.startRun rejecting keeps the typed text and shows the error, without closing the drawer', async () => {
  const workflows = [{ file: 'wf.yaml', inputs: { task: { required: true } }, agents: {} }];
  const projects = [{ id: 'p1', name: 'Demo', folder: '/repo', exists: true }];
  const api = { startRun: async () => { throw new Error('engine: too many runs'); } };
  const { sandbox, helpers, getEl, calls } = loadStartDrawer({ workflows, projects, api });
  sandbox.state.wf = workflows[0];
  getEl('project-select').value = 'p1';
  getEl('inputs-form')._fields = [['task', 'Do not lose this']];
  const mainEl = getEl('in-task');
  mainEl.value = 'Do not lose this';
  getEl('drawer').classList.add('open');

  await helpers.startRun({});

  assert.equal(getEl('start-error').textContent, 'engine: too many runs');
  assert.equal(mainEl.value, 'Do not lose this', 'a failed start never clears the main field');
  assert.equal(getEl('drawer').classList.contains('open'), true);
  assert.equal(calls.selectRun.length, 0);
});
