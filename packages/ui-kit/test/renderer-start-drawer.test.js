// packages/ui-kit/start-drawer.js (#154, moved out of app.js): the Start workflow drawer (#127 the
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
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const drawerSrc = fs.readFileSync(path.join(__dirname, '..', 'start-drawer.js'), 'utf8');
const workflowInputsSrc = fs.readFileSync(path.join(__dirname, '..', 'workflow-inputs.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

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
function loadStartDrawer({ workflows = [], projects = [], settings = {}, runs = new Map(), api = {}, pipelines = [] } = {}) {
  const defs = {
    LS_KEY: /const LS_KEY = [^\n]+;/,
    esc: /const esc = \(s\) => [^\n]+;/,
    isPathInput: /const isPathInput = \(key\) => [^\n]+;/,
    mainField: /const mainField = \(\) => [^\n]+;/,
    setStartDisabled: /function setStartDisabled\(disabled\) \{[\s\S]*?\n\}/,
    closeDrawer: /function closeDrawer\(\) \{[\s\S]*?\n\}/,
    oneRunAtATime: /const oneRunAtATime = [^\n]+;/,
    readInputs: /function readInputs\(\) \{[\s\S]*?\n\}/,
    // Pasted images (#130): startRun collects them before starting; out of scope here, the real
    // PasteImage module is stubbed below (sandbox.PasteImage), only the wiring is loaded.
    pasteFields: /const pasteFields = [^\n]+;/,
    pastedImages: /async function pastedImages\(\) \{[\s\S]*?\n\}/,
    sendStart: /async function sendStart\(\{[^)]*\}\) \{[\s\S]*?\n\}/,
    startRun: /async function startRun\(\{ keepOpen = false, baseChoice = null \} = \{\}\) \{[\s\S]*?\n\}/,
    selectWorkflow: /function selectWorkflow\(file\) \{[\s\S]*?\n\}/,
    // "When it finishes" (#134): selectWorkflow and startRun both call drawerChain(), the drawer's
    // ChainPicker; out of scope here (see sandbox.ChainPicker below), only its wiring is loaded.
    chainPickerDecl: /let chainPicker = null;/,
    drawerChain: /const drawerChain = \(\) => [^\n]+;/,
    // Saved pipelines (#135): selectWorkflow picks state.pipeline off a `pipe:<file>` value, then
    // renderDrawerPipeline draws its stages instead of the ChainPicker.
    PIPE: /const PIPE = 'pipe:';/,
    renderDrawerPipeline: /function renderDrawerPipeline\(\) \{[\s\S]*?\n\}/,
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
    state: { wf: null, pipeline: null, mainKey: null, projects, settings, runs, starting: false, workflows, pipelines },
    api: {
      startRun: async () => ({ runId: 'r-new' }), runPipeline: async () => ({ runId: 'r-new' }),
      pipelineEstimate: async () => ({ text: '', productOwner: false }), setSettings: async (s) => ({ ...settings, ...s }), ...api,
    },
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
    // A pipeline's stages strip (#135, chain-model.js): out of scope here, only the wiring that calls it.
    ChainModel: { pipelineStagesHtml: () => '' },
    // Pasted images (#130, paste-image.js): out of scope here; no textarea in this fixture ever has
    // attachments, so pastedImages() resolves to null (nothing pasted) unless a test sets one up.
    PasteImage: { settle: async () => {}, attachments: () => [], clear: () => {} },
  };
  sandbox.$ = (sel) => getEl(sel.slice(1));
  sandbox.window = sandbox; // WorkflowInputs (browser build) attaches itself to window
  vm.createContext(withI18n(sandbox));
  vm.runInContext(workflowInputsSrc, sandbox);
  vm.runInContext(Object.values(code).join('\n') + '\nthis.helpers = { startRun, selectWorkflow, setStartDisabled, closeDrawer, mainField, oneRunAtATime, renderDrawerPipeline };', sandbox);
  return { sandbox, helpers: sandbox.helpers, getEl, storage, calls };
}

// ---------------------------------------------------------------------------
// #132: no green checkmarks, only a missing CLI warns
// ---------------------------------------------------------------------------
// #319: renderEnvStatus (start-drawer.js) draws it from the chosen workflow's requirements and the
// CLI states, with the real SetupModel; commandHint and the mode checks are stubs.
function envStatusHtml(cliStates, requirements = { clis: ['claude', 'codex', 'git'], forge: false }, { canRun = false, dev = false } = {}) {
  const m = /function renderEnvStatus\(\) \{[\s\S]*?\n\}/.exec(drawerSrc);
  assert.ok(m, 'renderEnvStatus not found in start-drawer.js: the source moved');
  const box = makeEl();
  const tools = Object.keys(cliStates).map((id) => ({
    id, path: cliStates[id] !== 'missing' ? `/bin/${id}` : '', installCommand: `install-${id}`, signInCommand: `${id} login`,
  }));
  const sandbox = {
    state: { wf: requirements ? { requirements } : {}, cliStates, cliTools: tools },
    $: () => box,
    esc: (s) => String(s),
    SetupModel: require('@craftorio/shared/setup-model.js'),
    canRunCommands: () => canRun,
    commandHint: (cmd, opts) => `[${opts?.signIn ? 'sign-in' : 'run'}: ${cmd}]`,
    devMode: () => dev,
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${m[0]}\nrenderEnvStatus();`, sandbox);
  return box.innerHTML;
}

test('#env-status: every CLI the workflow needs is ready renders no warning at all (no green checkmarks)', () => {
  const html = envStatusHtml({ claude: 'ready', codex: 'ready', git: 'ready' });
  assert.doesNotMatch(html, /✗|✓/);
});

test('#env-status: a missing CLI renders only its warning, nothing for the ones that are found', () => {
  const html = envStatusHtml({ claude: 'ready', codex: 'missing', git: 'ready' });
  assert.match(html, /✗ Codex CLI: not installed/);
  assert.doesNotMatch(html, /Claude Code:|Git:/);
  assert.doesNotMatch(html, /✓/);
  assert.doesNotMatch(html, /use simulation mode/, 'never points to a mode the user may not see');
});

test('#env-status (#319): with a terminal, a missing CLI offers its install command and a signed-out one its sign-in', () => {
  const html = envStatusHtml({ claude: 'signed-out', codex: 'missing', git: 'ready' }, undefined, { canRun: true });
  assert.match(html, /✗ Codex CLI: not installed(<\/span>)?\[run: install-codex\]/);
  assert.match(html, /✗ Claude Code: not signed in(<\/span>)?\[sign-in: claude login\]/);
  assert.doesNotMatch(html, /git login|install-git/);
});

test('#env-status (#319): without a terminal (browser UI) no command is offered', () => {
  const html = envStatusHtml({ claude: 'signed-out', codex: 'missing', git: 'ready' });
  assert.doesNotMatch(html, /\[run:|\[sign-in:/);
});

test('#env-status (#319): a workflow that needs gh or glab warns only when neither is ready', () => {
  const reqs = { clis: ['claude', 'git'], forge: true };
  assert.match(envStatusHtml({ claude: 'ready', git: 'ready', gh: 'missing', glab: 'signed-out' }, reqs), /✗ Needs the GitHub CLI or the GitLab CLI/);
  assert.doesNotMatch(envStatusHtml({ claude: 'ready', git: 'ready', gh: 'missing', glab: 'ready' }, reqs), /✗/);
});

test('#env-status (#319): the requirement badges show, and the closing line follows whether simulation is visible', () => {
  const missing = { claude: 'ready', codex: 'missing', git: 'ready' };
  assert.match(envStatusHtml(missing), /Needs Codex/);
  assert.match(envStatusHtml(missing), /A real run of this workflow fails at Start without them/);
  assert.match(envStatusHtml(missing, undefined, { dev: true }), /Simulation runs it without them/);
  assert.doesNotMatch(envStatusHtml({ claude: 'ready', codex: 'ready', git: 'ready' }), /fails at Start|Simulation runs/);
});

test('#env-status (#319): a workflow without requirements leaves it empty', () => {
  assert.equal(envStatusHtml({ claude: 'missing' }, null), '');
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
  sandbox.localStorage.setItem('craftorio.inputs.wf.yaml', JSON.stringify({ task: 'OLD TASK TEXT', mode: 'validated' }));

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

// ---------------------------------------------------------------------------
// #203: unit_tests / e2e_tests show next to Mode (upfront), not under Advanced
// ---------------------------------------------------------------------------
test('selectWorkflow: unit_tests and e2e_tests render next to the task/mode fields, not folded into Advanced', () => {
  const workflows = [{
    file: 'software-development.yaml',
    inputs: {
      task: { required: true },
      mode: { enum: ['auto', 'validated'], default: 'auto' },
      unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run', label: 'Unit tests', options: { write_and_run: 'Write and run', run_existing: 'Run existing', off: 'Off' } },
      e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'write', label: 'E2E tests', options: { off: 'Off', write: 'Write', write_and_run: 'Write and run' } },
      base_branch: { type: 'string', default: 'main' },
    },
    agents: {},
  }];
  const { helpers, getEl } = loadStartDrawer({ workflows });
  helpers.selectWorkflow('software-development.yaml');
  const inputsHtml = getEl('inputs-form').innerHTML;
  const advHtml = getEl('adv-form').innerHTML;
  assert.match(inputsHtml, /data-wi-input="unit_tests"/);
  assert.match(inputsHtml, /data-wi-input="e2e_tests"/);
  assert.doesNotMatch(advHtml, /data-wi-input="unit_tests"/);
  assert.doesNotMatch(advHtml, /data-wi-input="e2e_tests"/);
  // a plain input with no such role stays in Advanced
  assert.match(advHtml, /data-wi-input="base_branch"/);
});

// #759: since #630 the auto/validated choice is the "validation" input (feature.yaml); it shows next
// to the task like the old Mode did, never folded into the closed Advanced section
test('selectWorkflow: the validation input (Automatic / Validated) renders next to the task, not folded into Advanced', () => {
  const workflows = [{
    file: 'feature.yaml',
    inputs: {
      task: { required: true },
      validation: { enum: ['auto', 'validated'], default: 'auto', label: 'Validation', options: { auto: 'Automatic', validated: 'Validated' } },
      base_branch: { type: 'string', default: 'main' },
    },
    agents: {},
  }];
  const { helpers, getEl } = loadStartDrawer({ workflows });
  helpers.selectWorkflow('feature.yaml');
  const inputsHtml = getEl('inputs-form').innerHTML;
  const advHtml = getEl('adv-form').innerHTML;
  assert.match(inputsHtml, /data-wi-input="validation"/);
  assert.doesNotMatch(advHtml, /data-wi-input="validation"/);
  // the default stays Automatic
  assert.match(inputsHtml, /data-wi-pill="auto" class="active"[^>]*>Automatic<\/button>/);
  assert.match(advHtml, /data-wi-input="base_branch"/);
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

  // startRun awaits pastedImages() (#130) before calling api.startRun: let that microtask settle
  // so resolveStart is assigned before this test calls it.
  await Promise.resolve();

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

  assert.deepEqual(JSON.parse(storage.get('craftorio.inputs.wf.yaml')), { mode: 'validated' }, 'the main field (task) is never saved');
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
  assert.deepEqual(JSON.parse(storage.get('craftorio.inputs.wf.yaml')), {});
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

// ---------------------------------------------------------------------------
// Saved pipelines (#135): a `pipe:<file>` value picks the pipeline's first stage; Start runs the
// whole pipeline (api.runPipeline) instead of the single workflow.
// ---------------------------------------------------------------------------
test('selectWorkflow: a pipeline value (pipe:<file>) shows its first stage\'s workflow and the pipeline box, hiding "When it finishes"', () => {
  const workflows = [{ file: 'a.yaml', inputs: { task: { required: true } }, agents: {} }];
  const pipelines = [{ file: 'p1.yaml', name: 'Pipe', description: 'a chain', stages: [{ workflow: 'a.yaml', inputs: {} }, { workflow: 'b.yaml', map: {} }] }];
  const { sandbox, helpers, getEl } = loadStartDrawer({ workflows, pipelines });

  helpers.selectWorkflow('pipe:p1.yaml');

  assert.equal(sandbox.state.pipeline.file, 'p1.yaml');
  assert.equal(sandbox.state.wf.file, 'a.yaml');
  assert.equal(getEl('drawer-pipeline').classList.contains('hidden'), false);
  assert.equal(getEl('drawer-chain').classList.contains('hidden'), true);
  assert.equal(getEl('btn-start').textContent, 'Start pipeline');
});

test('selectWorkflow: a plain workflow value clears state.pipeline and hides the pipeline box again', () => {
  const workflows = [{ file: 'a.yaml', inputs: { task: { required: true } }, agents: {} }];
  const pipelines = [{ file: 'p1.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }];
  const { sandbox, helpers, getEl } = loadStartDrawer({ workflows, pipelines });
  helpers.selectWorkflow('pipe:p1.yaml');

  helpers.selectWorkflow('a.yaml');

  assert.equal(sandbox.state.pipeline, null);
  assert.equal(getEl('drawer-pipeline').classList.contains('hidden'), true);
  assert.equal(getEl('btn-start').textContent, 'Start workflow');
});

test('startRun: with a pipeline selected, Start calls api.runPipeline with the pipeline\'s file and the owner\'s inputs, never api.startRun', async () => {
  const workflows = [{ file: 'a.yaml', inputs: { task: { required: true } }, agents: {} }];
  const pipelines = [{ file: 'p1.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }];
  const runPipeline = [];
  const startRun = [];
  const api = { runPipeline: async (...a) => { runPipeline.push(a); return { runId: 'rp-1' }; }, startRun: async (...a) => { startRun.push(a); return { runId: 'x' }; } };
  const { getEl, helpers } = loadStartDrawer({ workflows, pipelines, api });
  helpers.selectWorkflow('pipe:p1.yaml');
  getEl('inputs-form')._fields = [['task', 'Do the thing']];

  await helpers.startRun({});

  assert.equal(startRun.length, 0, 'a pipeline never starts through api.startRun');
  assert.equal(runPipeline.length, 1);
  assert.equal(runPipeline[0][0], 'p1.yaml');
  assert.equal(runPipeline[0][1].task, 'Do the thing');
  assert.equal(runPipeline[0][3], null, 'no project was selected');
});

// ---------------------------------------------------------------------------
// #286: an effort the CLI never gets is a warning in the workflow's description, never silent
// ---------------------------------------------------------------------------
test('selectWorkflow (#286): a workflow\'s load warnings follow its description as "Warning: ..."; none, no warning', () => {
  const message = 'the effort of reviewer is not passed: its provider has no effort_args';
  const workflows = [
    { file: 'warned.yaml', description: 'Builds things.', warnings: [message], inputs: { task: { required: true } }, agents: {} },
    { file: 'clean.yaml', description: 'Builds things.', warnings: [], inputs: { task: { required: true } }, agents: {} },
  ];
  const { helpers, getEl } = loadStartDrawer({ workflows });
  helpers.selectWorkflow('warned.yaml');
  const warned = String(getEl('wf-desc').textContent);
  assert.match(warned, /^Builds things\./);
  assert.match(warned, /Warning: the effort of reviewer is not passed: its provider has no effort_args/);
  helpers.selectWorkflow('clean.yaml');
  assert.equal(String(getEl('wf-desc').textContent), 'Builds things.');
});
