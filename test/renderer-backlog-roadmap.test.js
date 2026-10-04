// src/renderer/views/backlog/backlog-roadmap.js: the Backlog "Roadmap" view (#106, #110). It runs
// only inside the Electron renderer (document, window.api), so it is loaded whole into a vm
// sandbox that stubs those globals (esc, state, errMsg, devMode, confirmDialog, api, document,
// window), the way test/renderer-run-view.test.js and test/renderer-run-gates.test.js check app.js
// as a seam. Each test gets a fresh sandbox: `editing` / `adding` / `noteEditing` / the loaded
// workflows are the module's own closure state, not reset between calls.
const test = require('node:test');
const assert = require('node:assert/strict');
// the full roadmap (#217: by default the Roadmap tab shows only the open work)
const SHOW_ALL = { showAll: true, since: 'total' }; // #268: All, whatever the items' dates
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const roadmaps = require('../src/roadmap');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog-roadmap.js'), 'utf8');
const workflowInputsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workflow-inputs.js'), 'utf8');
const runProgressSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'run-progress-model.js'), 'utf8');
const defaultWorkflowSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'default-workflow.js'), 'utf8');
const statusPillSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'status-pill.js'), 'utf8');
const estimatesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'estimates.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// `choiceDialog`: #195's push confirmation (checkPushes); `showRunCalls`/`scheduleRenderCalls`: #194's
// ring chip click (openRunAt). RunProgress and DefaultWorkflow are the real modules (#194, #195), not
// reimplemented; only the purely presentational run-list helpers (avatars, chips, duration text) and
// ChainModel are stubbed, since they draw nothing this file's own behaviour depends on.
function loadRoadmap({ listWorkflows, confirmDialog, keptWorkDialog, choiceDialog, roadmapItem, querySelector, querySelectorAll, devMode, setRoadmapLive } = {}) {
  const savedCalls = [];
  const startCalls = [];
  const roadmapItemCalls = [];
  const liveCalls = [];
  const showRunCalls = [];
  let scheduleRenderCalls = 0;
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: devMode || (() => false),
    confirmDialog: confirmDialog || (async () => true),
    keptWorkDialog: keptWorkDialog || (async () => null),
    choiceDialog: choiceDialog || (async () => null),
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => { scheduleRenderCalls += 1; },
    document: { querySelector: querySelector || (() => null), querySelectorAll: querySelectorAll || (() => []) },
    api: {
      listWorkflows: listWorkflows || (async () => []),
      saveRoadmap: async (projectId, stages) => {
        savedCalls.push({ projectId, stages });
        return { roadmap: { state: 'planned', stages } };
      },
      startRoadmap: async (projectId, simulated, stage) => {
        startCalls.push({ projectId, simulated, stage });
        return { roadmap: { state: 'running', stages: [] } };
      },
      roadmapItem: async (projectId, itemId, action, confirmed) => {
        roadmapItemCalls.push({ projectId, itemId, action, confirmed });
        return (roadmapItem || (() => ({ roadmap: { state: 'planned', stages: [] } })))(roadmapItemCalls.length, confirmed);
      },
      setRoadmapLive: async (projectId, on) => {
        liveCalls.push({ projectId, on });
        return (setRoadmapLive || (() => ({ roadmap: { state: 'running', stages: [], live: on } })))(projectId, on);
      },
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  // `opts` is built inside the vm realm: keep only primitives so assert.deepEqual (strict, cross-realm
  // objects never compare equal) can check it without reaching into the sandbox.
  sandbox.window.showRun = (runId, opts) => showRunCalls.push({ runId, workflow: opts?.workflow });
  vm.createContext(sandbox);
  vm.runInContext(statusPillSrc, sandbox); // the real StatusPill module (#266: the readable statuses)
  vm.runInContext(estimatesSrc, sandbox); // the real Estimates module (#215; #272: the run timer's tooltip)
  vm.runInContext(runProgressSrc, sandbox); // the real RunProgress module (#194), not reimplemented
  vm.runInContext(defaultWorkflowSrc, sandbox); // the real DefaultWorkflow module (#195)
  vm.runInContext(workflowInputsSrc, sandbox); // the real WorkflowInputs module (#116), not reimplemented
  vm.runInContext(src, sandbox);
  return {
    BacklogRoadmap: sandbox.window.BacklogRoadmap, savedCalls, startCalls, roadmapItemCalls, liveCalls, showRunCalls, sandbox,
    scheduleRenderCalls: () => scheduleRenderCalls,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function makeCtx(projectId = 'p1') {
  const calls = { setData: [], setError: [], render: 0 };
  return {
    projectId,
    setData: (d) => calls.setData.push(d),
    setError: (e) => calls.setError.push(e),
    render: () => { calls.render += 1; },
    _calls: calls,
  };
}

function modeButtonTarget(value, itemId, stage) {
  const box = { dataset: { item: itemId, stage: String(stage) } };
  const btn = { dataset: { rmMode: value } };
  btn.closest = (sel) => {
    if (sel === '[data-rm-mode]') return btn;
    if (sel === '[data-item]' || sel === '[data-stage]') return box;
    return null;
  };
  return btn;
}

function editButtonTarget(itemId, stage) {
  const box = { dataset: { item: itemId, stage: String(stage) } };
  const btn = {};
  btn.closest = (sel) => {
    if (sel === '[data-rm-edit]') return btn;
    if (sel === '[data-item]' || sel === '[data-stage]') return box;
    return null;
  };
  return btn;
}

function cancelButtonTarget(itemId, stage) {
  const box = { dataset: { item: itemId, stage: String(stage) } };
  const btn = {};
  btn.closest = (sel) => {
    if (sel === '[data-rm-cancel]') return btn;
    if (sel === '[data-item]' || sel === '[data-stage]') return box;
    return null;
  };
  return btn;
}

function saveButtonTarget(itemId, stage, form) {
  const box = { dataset: { item: itemId, stage: String(stage) } };
  const btn = {};
  btn.closest = (sel) => {
    if (sel === '[data-rm-save]') return btn;
    if (sel === '.rm-form') return form;
    if (sel === '[data-item]' || sel === '[data-stage]') return box;
    return null;
  };
  return btn;
}

function addNoteButtonTarget(stage) {
  const box = { dataset: { stage: String(stage) } };
  const btn = {};
  btn.closest = (sel) => {
    if (sel === '[data-rm-addnote]') return btn;
    if (sel === '[data-stage]') return box; // a stage-level control: no [data-item]
    return null;
  };
  return btn;
}

// Run this stage (#141): a stage-level control, like add-note's target.
function runStageButtonTarget(stage) {
  const box = { dataset: { stage: String(stage) } };
  const btn = {};
  btn.closest = (sel) => {
    if (sel === '[data-rm-run-stage]') return btn;
    if (sel === '[data-stage]') return box;
    return null;
  };
  return btn;
}

function startButtonTarget() {
  const btn = {};
  btn.closest = (sel) => (sel === '[data-rm]' ? btn : null);
  btn.dataset = { rm: 'start' };
  return btn;
}

// Retry/Skip on a failed item: a [data-rm-item] control inside its [data-item] box.
function itemActionButtonTarget(action, itemId) {
  const box = { dataset: { item: itemId } };
  const btn = { dataset: { rmItem: action } };
  btn.closest = (sel) => {
    if (sel === '[data-rm-item]') return btn;
    if (sel === '[data-item]') return box;
    return null;
  };
  return btn;
}

function fakeFormEl(fields, { newName, newValue, mock } = {}) {
  return {
    querySelectorAll: (sel) => (sel === '[data-rm-field]' ? fields : []),
    querySelector: (sel) => {
      if (sel === '[data-rm-newname]') return newName !== undefined ? { value: newName } : null;
      if (sel === '[data-rm-newvalue]') return newValue !== undefined ? { value: newValue } : null;
      if (sel === '[data-rm-field-mock]') return mock !== undefined ? { checked: mock } : null;
      return null;
    },
  };
}

test('html: an item with two issues renders both titles as a linked list; a title equal to "#n" shows no duplicate text', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const data = {
    roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [{
      id: 'it1', status: 'planned', workflow: 'software-development.yaml', inputs: {},
      issues: [
        { number: 101, title: 'Fix the login bug', url: 'https://github.com/x/y/issues/101' },
        { number: 102, title: '#102', url: 'https://github.com/x/y/issues/102' },
      ],
    }] }] },
    issues: [],
  };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /<ul class="rm-titles">/);
  assert.equal((html.match(/<li class="rm-issue"/g) || []).length, 2);
  assert.match(html, /<span class="rm-num mono">#101<\/span><a class="rm-title" href="https:\/\/github\.com\/x\/y\/issues\/101"[^>]*>Fix the login bug<\/a>/);
  // #102's own title is just "#102": no duplicate text, falls back to "Open the issue"
  assert.match(html, /<span class="rm-num mono">#102<\/span><a class="rm-title" href="https:\/\/github\.com\/x\/y\/issues\/102"[^>]*>Open the issue<\/a>/);
});

test('html + onClick: a planned item with an enum mode renders a toggle; clicking "validated" saves inputs.mode and keeps the other inputs', async () => {
  const workflow = { file: 'software-development.yaml', inputs: { mode: { enum: ['auto', 'validated'] }, language: { enum: ['js', 'python'] } } };
  const { BacklogRoadmap, savedCalls } = loadRoadmap({ listWorkflows: async () => [workflow] });
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', issues: [{ number: 1, title: 'A', url: 'u' }], inputs: { mode: 'auto', language: 'js' } };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL); // kicks off loadWorkflows
  await settle();
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="seg sm rm-mode-seg"/);
  assert.match(html, /data-rm-mode="auto"[^>]*aria-pressed="true"/);
  assert.match(html, /data-rm-mode="validated"/);

  const ctx = makeCtx();
  const handled = await BacklogRoadmap.onClick({ target: modeButtonTarget('validated', 'it1', 0) }, ctx, data);
  assert.equal(handled, true);
  assert.equal(savedCalls.length, 1);
  const saved = savedCalls[0].stages[0].items[0].inputs;
  assert.equal(saved.mode, 'validated');
  assert.equal(saved.language, 'js');
});

test('html: a running item shows the mode as a read-only badge, not draggable; onClick on a mode control there saves nothing', async () => {
  const workflow = { file: 'software-development.yaml', inputs: { mode: { enum: ['auto', 'validated'] } } };
  const { BacklogRoadmap, savedCalls } = loadRoadmap({ listWorkflows: async () => [workflow] });
  const item = { id: 'it1', status: 'running', workflow: 'software-development.yaml', issues: [{ number: 1, title: 'A', url: 'u' }], inputs: { mode: 'validated' } };
  const data = { roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /<span class="badge rm-mode rm-mode-validated"/);
  assert.doesNotMatch(html, /data-rm-mode=/);
  assert.doesNotMatch(html, /data-rm-edit/);
  assert.doesNotMatch(html, /draggable="true"/);

  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: modeButtonTarget('auto', 'it1', 0) }, ctx, data);
  assert.equal(savedCalls.length, 0);
});

test('onClick [data-rm-edit] then html: an enum input renders pills with human labels, a boolean renders a switch, others render text; task/issue/path/mode inputs stay out of the form', async () => {
  const workflow = { file: 'software-development.yaml', inputs: {
    mode: { enum: ['auto', 'validated'] },
    language: { enum: ['js', 'python'], description: 'Programming language' },
    validate_every_round: { type: 'boolean', description: 'Validate every round' },
    task: { type: 'string' },
    project_path: { type: 'string' },
  } };
  const { BacklogRoadmap } = loadRoadmap({ listWorkflows: async () => [workflow] });
  const item = {
    id: 'it1', status: 'planned', workflow: 'software-development.yaml',
    issues: [{ number: 1, title: 'A', url: 'u' }],
    inputs: { mode: 'auto', language: 'python', validate_every_round: 'true', task: 'ignored', project_path: '/x' },
  };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();

  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: editButtonTarget('it1', 0) }, ctx, data);
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  // language (a short enum) renders as pills (#116), with a human label, not the raw key
  assert.match(html, /<label id="rm-f-it1-language-label"[^>]*>Language</);
  assert.match(html, /data-wi-pill="python" class="active"[^>]*title="Python">Python<\/button>/);
  assert.match(html, /data-rm-field="language"[^>]*value="python"/);
  assert.match(html, /Programming language/);
  // validate_every_round (a boolean) renders as a switch
  assert.match(html, /<input type="checkbox" role="switch"[^>]*data-rm-field="validate_every_round" data-wi-flag="bool"[^/]*checked/);
  assert.doesNotMatch(html, /data-rm-field="task"/);
  assert.doesNotMatch(html, /data-rm-field="project_path"/);
  assert.doesNotMatch(html, /data-rm-field="mode"/);
});

test('the Edit form\'s inputs grid (#116) is a one-field-per-row block in backlog.css, not the auto-fill columns of .rm-form-grid, so pills and help text keep their own row width', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.css'), 'utf8');
  assert.match(css, /\.rm-form-grid\.wi-grid \{[^}]*display: block/);
});

test('onClick [data-rm-save]: writes the form values (empty removes the key, a flag checkbox stores a string or a boolean, plus the new input); keeps untouched inputs', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const item = {
    id: 'it1', status: 'planned', workflow: 'w.yaml',
    issues: [{ number: 1, title: 'A', url: 'u' }],
    inputs: { mode: 'auto', language: 'js', note_field: 'old', validate_every_round: 'false' },
  };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: editButtonTarget('it1', 0) }, ctx, data);

  const fields = [
    { dataset: { rmField: 'language' }, type: 'select-one', value: 'python' },
    { dataset: { rmField: 'note_field' }, type: 'text', value: '' },
    { dataset: { rmField: 'feature_flag', wiFlag: 'text' }, type: 'checkbox', checked: true },
    { dataset: { rmField: 'validate_every_round', wiFlag: 'bool' }, type: 'checkbox', checked: false },
  ];
  const form = fakeFormEl(fields, { newName: 'extra_key', newValue: 'ev' });
  const handled = await BacklogRoadmap.onClick({ target: saveButtonTarget('it1', 0, form) }, ctx, data);
  assert.equal(handled, true);
  assert.equal(savedCalls.length, 1);
  const saved = savedCalls[0].stages[0].items[0].inputs;
  assert.equal(saved.language, 'python');
  assert.equal(saved.note_field, undefined);
  assert.equal(saved.feature_flag, 'true'); // a "false"/"true" enum flag: stored as a string
  assert.equal(saved.validate_every_round, false); // type boolean: stored as a boolean
  assert.equal(saved.extra_key, 'ev');
  assert.equal(saved.mode, 'auto'); // untouched
});

test('onClick [data-rm-save]: an invalid new-input name reports an error and saves nothing; Cancel closes the form without saving', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const item = { id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }], inputs: {} };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const ctx = makeCtx();

  await BacklogRoadmap.onClick({ target: editButtonTarget('it1', 0) }, ctx, data);
  const badForm = fakeFormEl([], { newName: 'a b', newValue: 'x' });
  await BacklogRoadmap.onClick({ target: saveButtonTarget('it1', 0, badForm) }, ctx, data);
  assert.equal(savedCalls.length, 0);
  assert.equal(ctx._calls.setError.length, 1);
  assert.match(ctx._calls.setError[0], /letters, digits/);

  await BacklogRoadmap.onClick({ target: cancelButtonTarget('it1', 0) }, ctx, data);
  assert.equal(savedCalls.length, 0);
});

// ---- #204: busy()/closeEdit(), so a live reload never disturbs an open Edit form, a drag or a note edit ----

test('busy(): false with nothing open; true while an item\'s Edit form, a stage note edit or a drag is in progress; closeEdit() clears the first two', async () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }], inputs: {} };
  const stage = { id: 'st1', name: '', note: '', items: [item] };
  const data = { roadmap: { state: 'planned', stages: [stage] }, issues: [] };
  const ctx = makeCtx();
  assert.equal(BacklogRoadmap.busy(), false);

  // an open Edit form
  await BacklogRoadmap.onClick({ target: editButtonTarget('it1', 0) }, ctx, data);
  assert.equal(BacklogRoadmap.busy(), true);
  BacklogRoadmap.closeEdit();
  assert.equal(BacklogRoadmap.busy(), false);

  // an open stage note edit
  await BacklogRoadmap.onClick({ target: addNoteButtonTarget(0) }, ctx, data);
  assert.equal(BacklogRoadmap.busy(), true);
  BacklogRoadmap.closeEdit();
  assert.equal(BacklogRoadmap.busy(), false);

  // a drag in progress: not cleared by closeEdit (it ends on drop/dragend, not on a reload)
  BacklogRoadmap.onDragStart({ target: { closest: (sel) => (sel === '[data-drag-item]' ? { dataset: { item: 'it1' } } : null) }, stopPropagation: () => {}, dataTransfer: { setData: () => {} } });
  assert.equal(BacklogRoadmap.busy(), true);
  BacklogRoadmap.closeEdit();
  assert.equal(BacklogRoadmap.busy(), true, 'closeEdit never ends a drag');
  BacklogRoadmap.onDragEnd();
  assert.equal(BacklogRoadmap.busy(), false);
});

test('a stage note shows "add note" when empty, text + edit when set, and onChange saves the stage note', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const stage = { id: 'st1', name: '', note: '', items: [] };
  const data = { roadmap: { state: 'planned', stages: [stage] }, issues: [] };
  let html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /data-rm-addnote>add note<\/button>/);
  assert.doesNotMatch(html, /data-rm-note/);

  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: addNoteButtonTarget(0) }, ctx, data);
  html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /<input type="text" class="rm-note small" data-rm-note/);

  const noteInput = {
    value: 'Why this order',
    matches: (sel) => sel === '[data-rm-note]',
    closest: (sel) => (sel === '.rm-stage' ? {} : sel === '[data-stage]' ? { dataset: { stage: '0' } } : null),
  };
  const handled = await BacklogRoadmap.onChange({ target: noteInput }, ctx, data);
  assert.equal(handled, true);
  assert.equal(savedCalls.length, 1);
  assert.equal(savedCalls[0].stages[0].note, 'Why this order');

  const withNote = { roadmap: { state: 'planned', stages: [{ ...stage, note: 'Why this order' }] }, issues: [] };
  html = BacklogRoadmap.html(withNote, () => {}, SHOW_ALL);
  assert.match(html, /Why this order <button class="link-btn small" type="button" data-rm-addnote>edit<\/button>/);
});

test('html: the complexity badge is the sum of the issues\' complexity:n labels; absent when none has one', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }, { number: 2, title: 'B', url: 'u2' }] };
  const data = {
    roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] },
    issues: [{ number: 1, labels: [{ name: 'complexity:3' }] }, { number: 2, labels: [{ name: 'complexity:5' }] }],
  };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /<span class="badge rm-size"[^>]*>complexity 8<\/span>/);

  const noLabels = { ...data, issues: [] };
  const html2 = BacklogRoadmap.html(noLabels, () => {}, SHOW_ALL);
  assert.doesNotMatch(html2, /rm-size/);
});

test('html: status pill classes for a planned, a waiting-at-a-gate and a skipped item', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const makeItem = (id, status, waiting) => ({ id, status, waiting, workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }] });
  const data = {
    roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [
      makeItem('planned-item', 'planned'),
      makeItem('waiting-item', 'running', true),
      makeItem('skipped-item', 'skipped'),
    ] }] },
    issues: [],
  };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  // #266: readable labels, the id in data-status
  assert.match(html, /<span class="pill pill-idle rm-state" data-status="planned"[^>]*>Planned<\/span>/);
  assert.match(html, /<span class="pill pill-cancelled rm-state" data-status="waiting"[^>]*>Waiting for you<\/span>/);
  assert.match(html, /<span class="pill pill-interrupted rm-state" data-status="skipped"[^>]*>Skipped<\/span>/);
});

test('html: reason and modeReason render inside details.rm-reason', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    reason: 'Groups the UI fixes together', modeReason: 'Validated: the owner can try it in the app',
  };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /<details class="rm-reason small">/);
  assert.match(html, /Groups the UI fixes together/);
  assert.match(html, /Validated: the owner can try it in the app/);
});

// ---- Run this stage (#141) ----------------------------------------------------------------

// A three-stage roadmap: `over` patches the roadmap (state, scope); each stage's item status is set by `statuses`.
function threeStageData(statuses, over = {}) {
  const ids = ['st1', 'st2', 'st3'];
  return {
    roadmap: {
      state: 'planned', scope: null,
      stages: ids.map((id, n) => ({ id, name: `Stage ${n + 1}`, note: '', items: [{ id: `it${n + 1}`, status: statuses[n], workflow: 'w.yaml', mock: false, issues: [{ number: n + 1, title: `#${n + 1}`, url: 'u' }] }] })),
      ...over,
    },
    issues: [],
  };
}

test('html: Run this stage is enabled only when the roadmap is not running and the stage has a planned item', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const planned = BacklogRoadmap.html(threeStageData(['planned', 'planned', 'planned']), () => {}, SHOW_ALL);
  assert.equal((planned.match(/data-rm-run-stage title="Run only this stage/g) || []).length, 3);
  assert.doesNotMatch(planned, /data-rm-run-stage[^>]*disabled/);

  const done = BacklogRoadmap.html(threeStageData(['done', 'planned', 'planned']), () => {}, SHOW_ALL);
  assert.match(done, /data-rm-run-stage title="No planned item in this stage" disabled/);

  const running = BacklogRoadmap.html(threeStageData(['planned', 'planned', 'planned'], { state: 'running' }), () => {}, SHOW_ALL);
  assert.match(running, /data-rm-run-stage title="The roadmap is running: pause or stop it first" disabled/g);
  assert.equal((running.match(/data-rm-run-stage[^>]*disabled/g) || []).length, 3);
});

test('html: the stage run on its own is highlighted (running or paused), the bar names it, and the other stages keep their plain badge', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const running = BacklogRoadmap.html(threeStageData(['done', 'running', 'planned'], { state: 'running', scope: { stage: 'st2' } }), () => {}, SHOW_ALL);
  assert.match(running, /<section class="rm-stage current scoped" data-stage="1"[^>]*>[\s\S]*?<span class="badge live">Running this stage only<\/span>/);
  assert.match(running, /<b>Roadmap<\/b> <span class="badge live" data-status="running">Running · stage 2 only<\/span>/);
  // stage 1 (done) and stage 3 (planned, not scoped, not current) keep their own plain badges
  assert.match(running, /<section class="rm-stage finished" data-stage="0"[^>]*>[\s\S]*?<span class="badge" data-status="done">Done<\/span>/);
  assert.doesNotMatch(running, /data-stage="2"[^>]*>[\s\S]{0,400}badge live/);

  const paused = BacklogRoadmap.html(threeStageData(['done', 'failed', 'planned'], { state: 'paused', scope: { stage: 'st2' } }), () => {}, SHOW_ALL);
  assert.match(paused, /<span class="badge warn">This stage only · paused<\/span>/);
});

test('onClick [data-rm-run-stage]: running a stage while an earlier one is still planned asks to confirm first, naming it; declining starts nothing', async () => {
  const confirms = [];
  const { BacklogRoadmap, startCalls } = loadRoadmap({ confirmDialog: async (title, body) => { confirms.push({ title, body }); return false; } });
  const data = threeStageData(['planned', 'planned', 'planned']);
  const ctx = makeCtx();
  const handled = await BacklogRoadmap.onClick({ target: runStageButtonTarget(1) }, ctx, data);
  assert.equal(handled, true);
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].title, 'Run stage 2 out of order');
  assert.match(confirms[0].body, /Stage 1 is not done/);
  assert.equal(startCalls.length, 0);
});

test('onClick [data-rm-run-stage]: confirmed (and no earlier stage pending) starts only that stage, with the simulated checkbox and real-run confirmation', async () => {
  const confirms = [];
  const { BacklogRoadmap, startCalls } = loadRoadmap({ confirmDialog: async (title, body) => { confirms.push({ title, body }); return true; } });
  const data = threeStageData(['done', 'planned', 'planned']); // stage 1 already done: running stage 2 is in order
  const ctx = makeCtx('proj-x');
  await BacklogRoadmap.onClick({ target: runStageButtonTarget(1) }, ctx, data);
  assert.equal(confirms.length, 1); // only the real-run confirmation; no out-of-order one
  assert.equal(confirms[0].title, 'Run stage 2');
  assert.deepEqual(startCalls, [{ projectId: 'proj-x', simulated: false, stage: 'st2' }]);
});

test('onClick [data-rm-run-stage]: every item of the stage simulated (mock) skips the real-run confirmation', async () => {
  const confirms = [];
  const { BacklogRoadmap, startCalls } = loadRoadmap({ confirmDialog: async (title) => { confirms.push(title); return true; } });
  const data = threeStageData(['done', 'planned', 'planned']);
  data.roadmap.stages[1].items[0].mock = true;
  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: runStageButtonTarget(1) }, ctx, data);
  assert.equal(confirms.length, 0);
  assert.equal(startCalls[0].simulated, false); // the item's own mock, not the Simulated checkbox, made it unreal
  assert.equal(startCalls[0].stage, 'st2');
});

test('onClick [data-rm=start]: resuming a paused, scoped roadmap passes that stage\'s id; a plain Start/Resume passes none', async () => {
  const { BacklogRoadmap, startCalls } = loadRoadmap();
  const ctx = makeCtx('proj-y');

  const scoped = threeStageData(['done', 'failed', 'planned'], { state: 'paused', scope: { stage: 'st2' } });
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, scoped);
  assert.equal(startCalls[0].stage, 'st2');

  const plain = threeStageData(['planned', 'planned', 'planned'], { state: 'planned' });
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, plain);
  assert.equal(startCalls[1].stage, null);
});

// ---- #243: the confirm of Resume says Resume, not Start ------------------------------------

function captureStartConfirm() {
  const confirms = [];
  const loaded = loadRoadmap({ confirmDialog: async (...args) => { confirms.push(args); return false; } });
  return { ...loaded, confirms };
}

test('#243 onClick [data-rm=start] on a paused roadmap (no scope) confirms "Resume the roadmap": runs in progress keep going, cost money, button Resume; cancel starts nothing', async () => {
  const { BacklogRoadmap, startCalls, confirms } = captureStartConfirm();
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, makeCtx(), threeStageData(['done', 'planned', 'planned'], { state: 'paused' }));
  assert.equal(confirms.length, 1);
  const [title, body, label] = confirms[0];
  assert.equal(title, 'Resume the roadmap');
  assert.equal(label, 'Resume');
  assert.match(body, /keep going/i);
  assert.match(body, /cost money/i);
  assert.equal(startCalls.length, 0);
});

test('#243 onClick [data-rm=start] on a paused roadmap scoped to stage 40 confirms "Resume stage 40": the roadmap pauses again when that stage is done', async () => {
  const { BacklogRoadmap, startCalls, confirms } = captureStartConfirm();
  const statuses = Array.from({ length: 41 }, (_, n) => (n < 39 ? 'done' : 'planned'));
  const ids = statuses.map((_, n) => `st${n + 1}`);
  const data = {
    roadmap: {
      state: 'paused', scope: { stage: 'st40' },
      stages: ids.map((id, n) => ({ id, name: `Stage ${n + 1}`, note: '', items: [{ id: `it${n + 1}`, status: statuses[n], workflow: 'w.yaml', mock: false, issues: [{ number: n + 1, title: `#${n + 1}`, url: 'u' }] }] })),
    },
    issues: [],
  };
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, makeCtx(), data);
  assert.equal(confirms.length, 1);
  const [title, body, label] = confirms[0];
  assert.equal(title, 'Resume stage 40');
  assert.equal(label, 'Resume');
  assert.match(body, /pauses again/i);
  assert.equal(startCalls.length, 0);
});

test('#243 guard: onClick [data-rm=start] on a planned or done roadmap still confirms "Start the roadmap" with Start', async () => {
  const { BacklogRoadmap, startCalls, confirms } = captureStartConfirm();
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, makeCtx(), threeStageData(['planned', 'planned', 'planned'], { state: 'planned' }));
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, makeCtx(), threeStageData(['done', 'done', 'planned'], { state: 'done' }));
  assert.equal(confirms.length, 2);
  for (const [title, , label] of confirms) {
    assert.equal(title, 'Start the roadmap');
    assert.equal(label, 'Start');
  }
  assert.equal(startCalls.length, 0);
});

test('#237 onClick [data-rm=start] on a paused roadmap whose scoped stage is finished resumes the whole roadmap: "Resume the roadmap", no stage sent', async () => {
  const confirms = [];
  const { BacklogRoadmap, startCalls } = loadRoadmap({ confirmDialog: async (...args) => { confirms.push(args); return true; } });
  const ctx = makeCtx('proj-f');
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, threeStageData(['done', 'done', 'planned'], { state: 'paused', scope: { stage: 'st2' } }));
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, threeStageData(['done', 'done', 'planned'], { state: 'paused', scope: { stage: 'gone' } }));
  assert.deepEqual(confirms.map(([title, , label]) => [title, label]), [['Resume the roadmap', 'Resume'], ['Resume the roadmap', 'Resume']]);
  assert.deepEqual(startCalls.map((c) => c.stage), [null, null]);
});

test('#237 html: a paused roadmap whose scoped stage is finished or gone no longer shows "stage N only"', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const finished = BacklogRoadmap.html(threeStageData(['done', 'done', 'planned'], { state: 'paused', scope: { stage: 'st2' } }), () => {}, SHOW_ALL);
  assert.doesNotMatch(finished, /stage \d+ only/);
  assert.match(finished, /<span class="badge warn" data-status="paused">Paused<\/span>/);
  const gone = BacklogRoadmap.html(threeStageData(['done', 'done', 'planned'], { state: 'paused', scope: { stage: 'gone' } }), () => {}, SHOW_ALL);
  assert.doesNotMatch(gone, /stage \d+ only/);
});

// ---- Retry on a failed item: the kept-work question (#170) --------------------------------

test('onClick [data-rm-item=retry]: a plain retry (no kept work) calls roadmapItem once, unconfirmed, and never opens the kept-work dialog', async () => {
  const keptCalls = [];
  const { BacklogRoadmap, roadmapItemCalls } = loadRoadmap({ keptWorkDialog: async (kept) => { keptCalls.push(kept); return 'scratch'; } });
  const data = threeStageData(['failed', 'planned', 'planned']);
  const ctx = makeCtx('proj-k');
  const handled = await BacklogRoadmap.onClick({ target: itemActionButtonTarget('retry', 'it1') }, ctx, data);
  assert.equal(handled, true);
  assert.deepEqual(roadmapItemCalls, [{ projectId: 'proj-k', itemId: 'it1', action: 'retry', confirmed: undefined }]);
  assert.equal(keptCalls.length, 0);
});

test('onClick [data-rm-item=retry]: a retry whose previous run kept work opens the kept-work dialog; "scratch" retries once more, confirmed', async () => {
  const kept = { title: '#1 already has work from a cancelled run', message: 'made 1 commit of its own for #1, still in its worktree.', choices: [], runId: 'r1' };
  const keptCalls = [];
  const { BacklogRoadmap, roadmapItemCalls } = loadRoadmap({
    keptWorkDialog: async (k) => { keptCalls.push(k); return 'scratch'; },
    roadmapItem: (callNumber) => (callNumber === 1 ? { kept, roadmap: { state: 'planned', stages: [] } } : { roadmap: { state: 'planned', stages: [] } }),
  });
  const data = threeStageData(['failed', 'planned', 'planned']);
  const ctx = makeCtx('proj-k');
  const handled = await BacklogRoadmap.onClick({ target: itemActionButtonTarget('retry', 'it1') }, ctx, data);
  assert.equal(handled, true);
  assert.deepEqual(keptCalls, [kept]);
  assert.equal(roadmapItemCalls.length, 2);
  assert.deepEqual(roadmapItemCalls[0], { projectId: 'proj-k', itemId: 'it1', action: 'retry', confirmed: undefined });
  assert.deepEqual(roadmapItemCalls[1], { projectId: 'proj-k', itemId: 'it1', action: 'retry', confirmed: true });
});

test('onClick [data-rm-item=retry]: kept work, but "resume" (or Cancel) never retries again', async () => {
  const kept = { title: '#1 already has work from a cancelled run', message: 'm', choices: [], runId: 'r1' };
  for (const answer of ['resume', null]) {
    const { BacklogRoadmap, roadmapItemCalls } = loadRoadmap({
      keptWorkDialog: async () => answer,
      roadmapItem: () => ({ kept, roadmap: { state: 'planned', stages: [] } }),
    });
    const data = threeStageData(['failed', 'planned', 'planned']);
    const ctx = makeCtx('proj-k');
    const handled = await BacklogRoadmap.onClick({ target: itemActionButtonTarget('retry', 'it1') }, ctx, data);
    assert.equal(handled, true, `answer: ${answer}`);
    assert.equal(roadmapItemCalls.length, 1, `answer: ${answer}: only the first, unconfirmed call`);
  }
});

// ---- #196: Retry / Skip on a refused start (the item that paused the roadmap, or an error without
// a run), never while its run is alive -------------------------------------------------------------

test('html: Retry and Skip show on the item that paused the roadmap, even while it is still "planned" (a refused start)', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'planned', workflow: 'w.yaml', runId: null,
    error: 'Could not start #1: #1 already has work from a cancelled run, run-9 (1 commit on its branch).',
    issues: [{ number: 1, title: 'A', url: 'u' }],
  };
  const data = { roadmap: { state: 'paused', pausedBy: 'it1', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /data-rm-item="retry"/);
  assert.match(html, /data-rm-item="skip"/);
  assert.match(html, /<div class="small rm-error error">Could not start #1: #1 already has work from a cancelled run, run-9 \(1 commit on its branch\)\.<div class="rm-error-hint muted">Retry starts it again[^<]*<\/div><\/div>/);
});

test('html: Retry and Skip show on a "planned" item with an error and no run (a refused start that did not pause the roadmap itself)', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it2', status: 'planned', workflow: 'w.yaml', runId: null, error: 'Every issue is closed.', issues: [{ number: 2, title: 'B', url: 'u' }] };
  const data = { roadmap: { state: 'paused', pausedBy: 'it-other', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /data-rm-item="retry"/);
  assert.match(html, /data-rm-item="skip"/);
});

test('html: a plain "planned" item (no error, not the one that paused the roadmap) shows no Retry or Skip', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it3', status: 'planned', workflow: 'w.yaml', runId: null, error: null, issues: [{ number: 3, title: 'C', url: 'u' }] };
  const data = { roadmap: { state: 'planned', pausedBy: null, stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.doesNotMatch(html, /data-rm-item=/);
});

test('html: never Retry/Skip while the item\'s own run is still alive, even if it happens to be the one named by pausedBy', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it1', status: 'running', workflow: 'w.yaml', runId: 'run-1', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'running', pausedBy: 'it1', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.doesNotMatch(html, /data-rm-item=/);
});

test('html: a skipped item with a leftover error never shows the retry hint (it is already finished)', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it1', status: 'skipped', workflow: 'w.yaml', runId: null, error: 'Every issue is closed.', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', pausedBy: null, stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.doesNotMatch(html, /data-rm-item=/);
  assert.match(html, /<div class="small rm-error muted">Every issue is closed\.<\/div>/);
});

test('onClick [data-rm-goto]: the bar\'s "Show the item" scrolls to and flashes the item that paused the roadmap', async () => {
  const scrolls = [];
  const classes = [];
  // `opts` is built inside the vm realm: keep only primitives for assert.deepEqual (see showRun above)
  const el = { dataset: { item: 'it1' }, scrollIntoView: (opts) => scrolls.push({ block: opts?.block, behavior: opts?.behavior }), classList: { add: (c) => classes.push(c), remove: (c) => classes.push(`-${c}`) } };
  const { BacklogRoadmap } = loadRoadmap({ querySelectorAll: (sel) => (sel === '#bl-list [data-item]' ? [el] : []) });
  const ctx = makeCtx();
  const target = { dataset: { rmGoto: 'it1' } };
  target.closest = (sel) => (sel === '[data-rm-goto]' ? target : null);
  const data = { roadmap: { state: 'paused', pausedBy: 'it1', stages: [] }, issues: [] };
  const handled = await BacklogRoadmap.onClick({ target }, ctx, data);
  assert.equal(handled, true);
  assert.deepEqual(scrolls, [{ block: 'center', behavior: 'smooth' }]);
  assert.deepEqual(classes, ['flash']);
});

// ---- #194: the run's progress ring (estimated %, current step, hover/click shows the steps) -------

function progressBoxTarget(runId, workflow) {
  return { dataset: { rmProgress: runId, workflow } };
}
function chipClickTarget(runId, workflow, chipName, grouped) {
  const box = progressBoxTarget(runId, workflow);
  const chip = { dataset: { rmChip: chipName, grouped: grouped ? '1' : '' } };
  chip.closest = (sel) => (sel === '[data-rm-progress]' ? box : sel === '[data-rm-chip]' ? chip : null);
  return chip;
}
function ringClickTarget(runId, workflow) {
  const box = progressBoxTarget(runId, workflow);
  const ring = {};
  ring.closest = (sel) => (sel === '[data-rm-progress]' ? box : sel === '[data-rm-ring]' ? ring : null);
  return ring;
}

test('html: a running item shows a progress ring with its estimated percent and current step/group', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'running', runId: 'run-1', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    run: {
      status: 'running', mock: false, startedAt: '2026-01-01T00:00:00.000Z',
      progress: [
        { step: 'develop', status: 'done', ts: '2026-01-01T00:00:00.000Z', agents: [{ agent: 'developer', provider: 'claude', model: 'm' }] },
        { step: 'code_review', status: 'running', ts: '2026-01-01T00:01:00.000Z', agents: [{ agent: 'reviewer', provider: 'claude', model: 'm' }] },
      ],
      groups: [{ name: 'Develop', steps: ['develop'] }, { name: 'Review', steps: ['code_review'] }],
      stepTimes: {}, history: 0,
    },
  };
  const data = { roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="rm-progress st-running[^"]*" data-rm-progress="run-1"/);
  assert.match(html, /<span class="rm-ring-pct">\d+%<\/span>/);
  assert.match(html, />Review</); // the current step's group name
  assert.doesNotMatch(html, /badge p-mock/); // not simulated
});

test('html: a run waiting at a gate shows the ring in the waiting state, "Waiting for you"', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'running', waiting: true, runId: 'run-2', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    run: { status: 'running', mock: false, startedAt: '2026-01-01T00:00:00.000Z', progress: [{ step: 'human_review', status: 'waiting', ts: '2026-01-01T00:00:00.000Z', type: 'human_approval', agents: [] }], groups: [], stepTimes: {}, history: 0 },
  };
  const data = { roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="rm-progress st-waiting/);
  assert.match(html, /Waiting for you/);
});

test('html: a failed run shows the ring in the failed state, naming the step it failed at, in red', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'failed', runId: 'run-3', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    run: { status: 'failed', mock: false, startedAt: '2026-01-01T00:00:00.000Z', progress: [{ step: 'test', status: 'failed', ts: '2026-01-01T00:00:00.000Z', agents: [] }], groups: [], stepTimes: {}, history: 0 },
  };
  const data = { roadmap: { state: 'paused', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="rm-progress st-failed/);
  assert.match(html, /Failed at test/);
});

test('html: a successful run shows the ring at 100%, "Done"', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'done', runId: 'run-4', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    run: { status: 'success', mock: false, startedAt: '2026-01-01T00:00:00.000Z', progress: [{ step: 'merge', status: 'done', ts: '2026-01-01T00:00:00.000Z', agents: [] }], groups: [], stepTimes: {}, history: 1 },
  };
  const data = { roadmap: { state: 'done', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="rm-progress st-done/);
  assert.match(html, /<span class="rm-ring-pct">100%<\/span>/);
  assert.match(html, />Done</);
});

test('html: a simulated run\'s ring carries the "simulated" badge; a planned item with no run shows no ring at all', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const simItem = {
    id: 'it1', status: 'running', runId: 'run-5', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    run: { status: 'running', mock: true, startedAt: '2026-01-01T00:00:00.000Z', progress: [{ step: 'develop', status: 'running', ts: '2026-01-01T00:00:00.000Z', agents: [] }], groups: [], stepTimes: {}, history: 0 },
  };
  const plannedItem = { id: 'it2', status: 'planned', runId: null, workflow: 'w.yaml', issues: [{ number: 2, title: 'B', url: 'u' }] };
  const data = { roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [simItem, plannedItem] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  assert.match(html, /class="rm-progress st-running sim"/);
  assert.match(html, /<span class="badge p-mock">Simulated<\/span>/);
  const perItem = html.split('data-item="it2"')[1];
  assert.doesNotMatch(perItem.split('data-item="it1"')[0] || perItem, /class="rm-progress/);
});

test('onClick [data-rm-chip]: opens the run and, for a grouped chip, marks that group open; schedules a render either way', async () => {
  const runsMap = new Map([['run-1', { openGroups: new Map() }]]);
  const { BacklogRoadmap, showRunCalls, scheduleRenderCalls, sandbox } = loadRoadmap();
  sandbox.state.runs = runsMap;
  const ctx = makeCtx();
  const data = { roadmap: { state: 'running', stages: [] }, issues: [] };
  const handled = await BacklogRoadmap.onClick({ target: chipClickTarget('run-1', 'w.yaml', 'Review', true) }, ctx, data);
  assert.equal(handled, true);
  assert.deepEqual(showRunCalls, [{ runId: 'run-1', workflow: 'w.yaml' }]);
  assert.equal(runsMap.get('run-1').openGroups.get('Review'), true);
  assert.equal(scheduleRenderCalls(), 1);
});

test('onClick [data-rm-chip]: an ungrouped chip opens the run but marks no group open', async () => {
  const runsMap = new Map([['run-1', { openGroups: new Map() }]]);
  const { BacklogRoadmap, showRunCalls, sandbox } = loadRoadmap();
  sandbox.state.runs = runsMap;
  const ctx = makeCtx();
  const data = { roadmap: { state: 'running', stages: [] }, issues: [] };
  await BacklogRoadmap.onClick({ target: chipClickTarget('run-1', 'w.yaml', 'merge', false) }, ctx, data);
  assert.equal(showRunCalls.length, 1);
  assert.equal(runsMap.get('run-1').openGroups.size, 0);
});

test('onClick [data-rm-ring]: toggles that run\'s steps open and re-renders, without opening the run', async () => {
  const { BacklogRoadmap, showRunCalls } = loadRoadmap();
  const ctx = makeCtx();
  const data = { roadmap: { state: 'running', stages: [] }, issues: [] };
  const handled = await BacklogRoadmap.onClick({ target: ringClickTarget('run-1', 'w.yaml') }, ctx, data);
  assert.equal(handled, true);
  assert.equal(ctx._calls.render, 1);
  assert.equal(showRunCalls.length, 0);
});

// ---- #193: no horizontal scroll (the roadmap's grids never widen past the window) ------------------

test('backlog.css (#193): the roadmap\'s grids use a minmax(0, 1fr) track (not the default auto track sized by the longest line), so a long reason cannot widen the page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.css'), 'utf8');
  assert.match(css, /\.rm \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  assert.match(css, /\.rm-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  assert.match(css, /\.rm-items \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.rm-item \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
});

test('backlog.css (#193): a long reason, note, error and input badge wrap or are abbreviated instead of stretching the card', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.css'), 'utf8');
  assert.match(css, /\.rm-error \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /\.rm-note-text \{ margin: 0; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.rm-reason\[open\] > summary \{ white-space: normal; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.rm-meta > \.badge, \.rm-meta > \.bl-run \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
});

// ---- #195: a workflow that pushes while the default development workflow merges locally -----------

test('html: an item whose workflow pushes (remote) while the default is local gets the push badge, naming the default in its tooltip', () => {
  const { BacklogRoadmap, sandbox } = loadRoadmap({ listWorkflows: async () => [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }] });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', workflowName: 'Software development', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL); // kicks off loadWorkflows (the module's own cache)
  return settle().then(() => {
    const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
    assert.match(html, /class="badge rm-wf rm-wf-push"/);
    assert.match(html, /merges locally/);
  });
});

test('html: an item already on the default (local) workflow gets no push badge', () => {
  const list = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const { BacklogRoadmap, sandbox } = loadRoadmap({ listWorkflows: async () => list });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = list;
  const item = { id: 'it1', status: 'planned', workflow: 'software-development-local-hero.yaml', workflowName: 'Software development (local)', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  return settle().then(() => {
    const html = BacklogRoadmap.html(data, () => {}, SHOW_ALL);
    assert.doesNotMatch(html, /rm-wf-push/);
  });
});

test('onClick [data-rm=start]: a roadmap with items that would push while the default is local asks first; "Switch them to …" saves the default workflow on them, then starts', async () => {
  const list = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const choiceCalls = [];
  const { BacklogRoadmap, savedCalls, startCalls, sandbox } = loadRoadmap({
    listWorkflows: async () => list,
    // `options` is a vm-realm array: Array.from (the outer realm's) copies it so deepEqual can compare it
    choiceDialog: async (title, message, options) => { choiceCalls.push({ title, options: Array.from(options, (o) => o.id) }); return 'switch'; },
  });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = list;
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', workflowName: 'Software development', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();
  const ctx = makeCtx();
  const handled = await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, data);
  assert.equal(handled, true);
  assert.equal(choiceCalls.length, 1);
  assert.deepEqual(choiceCalls[0].options, ['switch', 'anyway']);
  assert.equal(savedCalls.length, 1);
  assert.equal(savedCalls[0].stages[0].items[0].workflow, 'software-development-local-hero.yaml');
  assert.equal(startCalls.length, 1); // the start goes on after switching
});

test('onClick [data-rm=start]: "Start anyway" keeps the pushing workflow and starts without saving', async () => {
  const list = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const { BacklogRoadmap, savedCalls, startCalls, sandbox } = loadRoadmap({ listWorkflows: async () => list, choiceDialog: async () => 'anyway' });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = list;
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', workflowName: 'Software development', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();
  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, data);
  assert.equal(savedCalls.length, 0);
  assert.equal(startCalls.length, 1);
});

test('onClick [data-rm=start]: cancelling the push confirmation starts nothing', async () => {
  const list = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const { BacklogRoadmap, startCalls, sandbox } = loadRoadmap({ listWorkflows: async () => list, choiceDialog: async () => null });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = list;
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', workflowName: 'Software development', issues: [{ number: 1, title: 'A', url: 'u' }] };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();
  const ctx = makeCtx();
  const handled = await BacklogRoadmap.onClick({ target: startButtonTarget() }, ctx, data);
  assert.equal(handled, true);
  assert.equal(startCalls.length, 0);
});

test('addStage (Product Owner, #140): a new stage\'s item carries the origin it was added with', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const ctx = makeCtx('proj-z');
  await BacklogRoadmap.addStage(ctx, { roadmap: { stages: [] } }, { issues: [1, 2], workflow: 'w.yaml', inputs: {}, mock: true, group: true, origin: 'ts-1' });
  assert.equal(savedCalls[0].stages[0].items[0].origin, 'ts-1');
});

// ---- moveIssue / drag and drop (#163) ------------------------------------------------------

test('moveIssue groups a single-issue item\'s issue into another single-issue item, removing the emptied source', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const from = { id: 'i1', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const to = { id: 'i2', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const stages = [{ id: 's1', items: [from, to] }];
  assert.equal(BacklogRoadmap.moveIssue(stages, 1, 'i1', 'i2'), true);
  assert.equal(stages[0].items.length, 1); // the emptied source is gone
  assert.deepEqual(Array.from(stages[0].items[0].issues, (i) => i.number), [2, 1]);
  assert.equal(stages[0].items[0].number, 2); // the group's first issue stays on top, for older readers
});

test('moveIssue groups an issues-list item\'s issue into another issues-list item', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const from = { id: 'i1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u1' }] };
  const to = { id: 'i2', status: 'planned', workflow: 'w.yaml', issues: [{ number: 2, title: 'B', url: 'u2' }, { number: 3, title: 'C', url: 'u3' }] };
  const stages = [{ id: 's1', items: [from, to] }];
  assert.equal(BacklogRoadmap.moveIssue(stages, 1, 'i1', 'i2'), true);
  assert.equal(stages[0].items.length, 1);
  assert.deepEqual(Array.from(stages[0].items[0].issues, (i) => i.number), [2, 3, 1]);
});

test('moveIssue on a mix of shapes moves one issue out of a multi-issue source without emptying it, and into a single-issue target; throws nothing', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const from = { id: 'i1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u1' }, { number: 4, title: 'D', url: 'u4' }] };
  const to = { id: 'i2', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const stages = [{ id: 's1', items: [from, to] }];
  assert.doesNotThrow(() => assert.equal(BacklogRoadmap.moveIssue(stages, 1, 'i1', 'i2'), true));
  assert.equal(stages[0].items.length, 2); // #4 keeps the source alive
  const src = stages[0].items.find((x) => x.id === 'i1');
  const tgt = stages[0].items.find((x) => x.id === 'i2');
  assert.deepEqual(Array.from(src.issues, (i) => i.number), [4]);
  assert.deepEqual(Array.from(tgt.issues, (i) => i.number), [2, 1]);
});

test('moveIssue refuses, without throwing, to drop on the source item itself or on a running (non-editable) item', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const planned = { id: 'i1', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const running = { id: 'i2', status: 'running', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const stages = [{ id: 's1', items: [planned, running] }];
  assert.equal(BacklogRoadmap.moveIssue(stages, 1, 'i1', 'i1'), false);
  assert.equal(BacklogRoadmap.moveIssue(stages, 1, 'i1', 'i2'), false);
  assert.equal(stages[0].items.length, 2); // nothing changed
});

// A drop target/source element: dataset.item plus a classList (add/remove/contains) the handlers
// mark; `closest` resolves the same selectors the real markup would, through the given stage.
function dragItemEl(itemId, stageEl) {
  const classes = new Set();
  const el = {
    dataset: { item: itemId },
    classList: { add: (c) => classes.add(c), remove: (...cs) => cs.forEach((c) => classes.delete(c)), contains: (c) => classes.has(c) },
  };
  el.closest = (sel) => (sel === '[data-item]' ? el : sel === '[data-drop-stage]' ? stageEl : null);
  return el;
}
function dragStageEl(idx) {
  const el = { dataset: { dropStage: String(idx) } };
  el.closest = (sel) => (sel === '[data-drop-stage]' ? el : null);
  return el;
}
function chipTarget(issueNumber, fromId) {
  const chip = { dataset: { dragIssue: String(issueNumber), from: fromId } };
  chip.closest = (sel) => (sel === '[data-drag-issue]' ? chip : null);
  return chip;
}
function startDrag(BacklogRoadmap, issueNumber, fromId) {
  BacklogRoadmap.onDragStart({ target: chipTarget(issueNumber, fromId), stopPropagation: () => {}, dataTransfer: { setData: () => {} } });
}

test('dragstart on an issue chip, then dragover on its own item: no mark (no rm-drop-denied class)', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const itemA = { id: 'itA', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const itemB = { id: 'itB', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const data = { roadmap: { stages: [{ id: 'st1', items: [itemA, itemB] }] }, issues: [] };
  const stageEl = dragStageEl(0);
  const itemAEl = dragItemEl('itA', stageEl);

  startDrag(BacklogRoadmap, 1, 'itA');
  let prevented = false;
  BacklogRoadmap.onDragOver({ target: itemAEl, preventDefault: () => { prevented = true; }, dataTransfer: {} }, data);
  assert.equal(itemAEl.classList.contains('rm-drop-denied'), false);
  assert.equal(itemAEl.classList.contains('rm-drop-target'), false);
  assert.equal(prevented, false);
});

test('dragover on another item, then back on the source item: the source item gets rm-drop-denied and data-drop-why, and preventDefault is not called', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const itemA = { id: 'itA', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const itemB = { id: 'itB', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const data = { roadmap: { stages: [{ id: 'st1', items: [itemA, itemB] }] }, issues: [] };
  const stageEl = dragStageEl(0);
  const itemAEl = dragItemEl('itA', stageEl);
  const itemBEl = dragItemEl('itB', stageEl);

  startDrag(BacklogRoadmap, 1, 'itA');
  let preventedOnB = false;
  BacklogRoadmap.onDragOver({ target: itemBEl, preventDefault: () => { preventedOnB = true; }, dataTransfer: {} }, data);
  assert.equal(itemBEl.classList.contains('rm-drop-target'), true);
  assert.equal(preventedOnB, true);

  let preventedOnA = false;
  BacklogRoadmap.onDragOver({ target: itemAEl, preventDefault: () => { preventedOnA = true; }, dataTransfer: {} }, data);
  assert.equal(itemAEl.classList.contains('rm-drop-denied'), true);
  assert.equal(itemAEl.dataset.dropWhy, '#1 is already in this item.');
  assert.equal(preventedOnA, false);
  assert.equal(itemBEl.classList.contains('rm-drop-target'), false); // the previous mark is cleared
});

test('onDrop with the target equal to d.from calls ctx.setError with the "already in this item" reason and does not save', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const itemA = { id: 'itA', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const itemB = { id: 'itB', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const data = { roadmap: { stages: [{ id: 'st1', items: [itemA, itemB] }] }, issues: [] };
  const stageEl = dragStageEl(0);
  const itemAEl = dragItemEl('itA', stageEl);
  const ctx = makeCtx();

  startDrag(BacklogRoadmap, 1, 'itA');
  await BacklogRoadmap.onDrop({ target: itemAEl, preventDefault: () => {} }, ctx, data);
  assert.equal(savedCalls.length, 0);
  assert.deepEqual(ctx._calls.setError, ['#1 is already in this item.']);
  assert.equal(ctx._calls.render, 1);
});

test('dragend clears the marks and the dragging state, so a new drag starts with the source unmarked again', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const itemA = { id: 'itA', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const itemB = { id: 'itB', status: 'planned', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const data = { roadmap: { stages: [{ id: 'st1', items: [itemA, itemB] }] }, issues: [] };
  const stageEl = dragStageEl(0);
  const itemAEl = dragItemEl('itA', stageEl);
  const itemBEl = dragItemEl('itB', stageEl);

  startDrag(BacklogRoadmap, 1, 'itA');
  BacklogRoadmap.onDragOver({ target: itemBEl, preventDefault: () => {}, dataTransfer: {} }, data);
  BacklogRoadmap.onDragOver({ target: itemAEl, preventDefault: () => {}, dataTransfer: {} }, data);
  assert.equal(itemAEl.classList.contains('rm-drop-denied'), true);

  BacklogRoadmap.onDragEnd();
  assert.equal(itemAEl.classList.contains('rm-drop-denied'), false);
  assert.equal(itemAEl.dataset.dropWhy, undefined);

  startDrag(BacklogRoadmap, 1, 'itA');
  let prevented = false;
  BacklogRoadmap.onDragOver({ target: itemAEl, preventDefault: () => { prevented = true; }, dataTransfer: {} }, data);
  assert.equal(itemAEl.classList.contains('rm-drop-denied'), false); // unmarked again: dragging.left reset
  assert.equal(prevented, false);
});

test('dragover on a running (non-editable) item marks it rm-drop-denied, naming the status in data-drop-why', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const itemA = { id: 'itA', status: 'planned', workflow: 'w.yaml', number: 1, url: 'u1', title: 'A' };
  const itemB = { id: 'itB', status: 'running', workflow: 'w.yaml', number: 2, url: 'u2', title: 'B' };
  const data = { roadmap: { stages: [{ id: 'st1', items: [itemA, itemB] }] }, issues: [] };
  const stageEl = dragStageEl(0);
  const itemBEl = dragItemEl('itB', stageEl);

  startDrag(BacklogRoadmap, 1, 'itA');
  let prevented = false;
  BacklogRoadmap.onDragOver({ target: itemBEl, preventDefault: () => { prevented = true; }, dataTransfer: {} }, data);
  assert.equal(itemBEl.classList.contains('rm-drop-denied'), true);
  assert.match(itemBEl.dataset.dropWhy, /only planned or failed items take issues/);
  assert.equal(prevented, false);
});

test('a Product Owner proposal, then two of its items grouped by dropping one chip on the other, saves one item with both issues', async (t) => {
  const dir = tmp(t);
  const { roadmap } = roadmaps.propose(dir, 'proj', { stages: [
    { name: 'Stage A', items: [{ workflow: 'software-development.yaml', number: 155 }, { workflow: 'software-development.yaml', number: 156 }] },
  ] });
  const [item155, item156] = roadmap.stages[0].items;

  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const data = { roadmap, issues: [] };
  const ctx = makeCtx();
  const stageEl = dragStageEl(0);
  const targetEl = dragItemEl(item155.id, stageEl);

  startDrag(BacklogRoadmap, 156, item156.id);
  await BacklogRoadmap.onDrop({ target: targetEl, preventDefault: () => {} }, ctx, data);

  assert.equal(savedCalls.length, 1);
  assert.equal(savedCalls[0].stages[0].items.length, 1);
  assert.deepEqual(Array.from(savedCalls[0].stages[0].items[0].issues, (i) => i.number).sort(), [155, 156]);
});

// ---- Live roadmap (#164): the box under the last stage, and the top banner -----------------

// A one-stage roadmap (so `r.stages.length` is truthy and the live box is drawn): `over` patches the roadmap.
function liveData(over = {}) {
  return { roadmap: { state: 'running', scope: null, stages: [{ id: 'st1', name: 'Stage 1', note: '', items: [{ id: 'it1', status: 'running', workflow: 'w.yaml', mock: false, issues: [{ number: 1, title: '#1', url: 'u' }] }] }], ...over }, issues: [] };
}

test('liveBox: off shows a plain switch, no LIVE badge, and says the roadmap ends with its last stage while it runs', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.html(liveData({ live: false }), () => {}, SHOW_ALL);
  assert.match(html, /<div class="rm-live" role="group" aria-label="Live roadmap">/); // no " on" class
  assert.doesNotMatch(html, /rm-live-badge/);
  assert.doesNotMatch(html, /data-rm-live[^>]*checked/);
  assert.match(html, /rm-live-state"[^>]*>Off: the roadmap ends with its last stage\.</);
});

test('liveBox: off on a roadmap that is not running says turning it on starts the roadmap first', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.html(liveData({ live: false, state: 'planned' }), () => {}, SHOW_ALL);
  assert.match(html, /rm-live-state"[^>]*>Off\. Turning it on starts the roadmap first\.</);
});

test('liveBox: on with no refill yet shows the LIVE badge, a checked switch, and "on since" with who turned it on', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.html(liveData({ live: true, liveSince: '2026-10-02T03:12:00.000Z', liveBy: 'owner' }), () => {}, SHOW_ALL);
  assert.match(html, /<div class="rm-live on" role="group" aria-label="Live roadmap">/);
  assert.match(html, /<b>Live roadmap<\/b> <span class="badge rm-live-badge">LIVE<\/span>/);
  assert.match(html, /data-rm-live[^>]*checked/);
  assert.match(html, /no refill yet: it comes when the last stage ends · on since \d\d:12 by owner</);
});

test('liveBox: "refilling" and "added" outcomes, in muted tone', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const refilling = BacklogRoadmap.html(liveData({ live: true, liveRefill: { status: 'refilling' } }), () => {}, SHOW_ALL);
  assert.match(refilling, /rm-live-state"[^>]*>refilling now: the Product Owner is picking the next issues…/);

  const added = BacklogRoadmap.html(liveData({ live: true, liveRefill: { status: 'added', at: '2026-10-02T03:12:00.000Z', added: 2 } }), () => {}, SHOW_ALL);
  assert.match(added, /rm-live-state"[^>]*>last refill \d\d:12 \(\+2 stages\)/);
});

test('liveBox: "budget" (warn-text) and "failed" (error) outcomes get their tone class', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const budget = BacklogRoadmap.html(liveData({ live: true, liveRefill: { status: 'budget', message: 'Live roadmap: no more refills today.' } }), () => {}, SHOW_ALL);
  assert.match(budget, /class="small warn-text rm-live-state" title="Live roadmap: no more refills today\."[^>]*>daily budget reached: no more refills</);

  const failed = BacklogRoadmap.html(liveData({ live: true, liveRefill: { status: 'failed', at: '2026-10-02T03:12:00.000Z', message: 'boom' } }), () => {}, SHOW_ALL);
  assert.match(failed, /class="small error rm-live-state" title="boom"[^>]*>the last refill failed \(\d\d:12\)</);
});

test('liveBox: "empty" (nothing left) shows its message with the "Live roadmap: " prefix stripped', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.html(liveData({ live: true, liveRefill: { status: 'empty', message: 'Live roadmap: nothing left under complexity 2. Start tries again.' } }), () => {}, SHOW_ALL);
  assert.match(html, /rm-live-state"[^>]*>nothing left under complexity 2\. Start tries again\.</);
});

test('liveBanner: not live renders nothing', () => {
  const { BacklogRoadmap } = loadRoadmap();
  assert.equal(BacklogRoadmap.liveBanner({ live: false, state: 'running' }), '');
  assert.equal(BacklogRoadmap.liveBanner(null), '');
});

test('liveBanner: live and running shows the last refill, a non-idle dot, and a Turn off button; no "roadmap …" suffix', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.liveBanner({ live: true, state: 'running', liveRefill: { status: 'added', at: '2026-10-02T03:12:00.000Z', added: 3 } });
  assert.match(html, /<span class="bl-live-dot" aria-hidden="true"><\/span>/); // no "idle" class
  assert.match(html, /<b>Live roadmap<\/b>: refills itself from the backlog · <span class="" title="">last refill \d\d:12 \(\+3 stages\)<\/span>/);
  assert.doesNotMatch(html, /roadmap running/);
  assert.match(html, /<button class="btn sm ghost" type="button" data-live-off title="The current stages finish; nothing more is added">Turn off<\/button>/);
});

test('liveBanner: live but paused (or done) marks the dot idle and names the roadmap\'s state', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const html = BacklogRoadmap.liveBanner({ live: true, state: 'paused' });
  assert.match(html, /<span class="bl-live-dot idle" aria-hidden="true"><\/span>/);
  assert.match(html, /· <span class="muted">roadmap paused<\/span>/);
});

test('onChange [data-rm-live]: turning on a running, simulated roadmap goes live at once, with no confirmation', async () => {
  const confirmCalls = [];
  const { BacklogRoadmap, liveCalls } = loadRoadmap({ confirmDialog: async (...a) => { confirmCalls.push(a); return true; } });
  const data = liveData({ live: false, simulated: true });
  const ctx = makeCtx();
  const target = { matches: (sel) => sel === '[data-rm-live]', checked: true };
  const handled = await BacklogRoadmap.onChange({ target }, ctx, data);
  assert.equal(handled, true);
  assert.equal(confirmCalls.length, 0);
  assert.deepEqual(liveCalls, [{ projectId: ctx.projectId, on: true }]);
  assert.equal(ctx._calls.setData.length, 1);
});

test('onChange [data-rm-live]: turning on a running, real roadmap asks to confirm first; declining goes live nowhere', async () => {
  const { BacklogRoadmap, liveCalls } = loadRoadmap({ confirmDialog: async () => false });
  const data = liveData({ live: false, simulated: false });
  const ctx = makeCtx();
  const target = { matches: (sel) => sel === '[data-rm-live]', checked: true };
  await BacklogRoadmap.onChange({ target }, ctx, data);
  assert.deepEqual(liveCalls, []);
});

test('onChange [data-rm-live]: turning on a roadmap that is not running asks to start it first; accepting starts it, then goes live', async () => {
  const confirmCalls = [];
  const { BacklogRoadmap, startCalls, liveCalls } = loadRoadmap({ confirmDialog: async (title, ...rest) => { confirmCalls.push(title); return true; } });
  const data = liveData({ live: false, state: 'planned' });
  const ctx = makeCtx();
  const target = { matches: (sel) => sel === '[data-rm-live]', checked: true };
  await BacklogRoadmap.onChange({ target }, ctx, data);
  assert.deepEqual(confirmCalls, ['Start the roadmap and go live']);
  assert.equal(startCalls.length, 1);
  assert.deepEqual(liveCalls, [{ projectId: ctx.projectId, on: true }]);
});

test('onChange [data-rm-live]: turning off never asks for confirmation', async () => {
  const { BacklogRoadmap, liveCalls } = loadRoadmap({ confirmDialog: async () => { throw new Error('must not be asked'); } });
  const data = liveData({ live: true });
  const ctx = makeCtx();
  const target = { matches: (sel) => sel === '[data-rm-live]', checked: false };
  await BacklogRoadmap.onChange({ target }, ctx, data);
  assert.deepEqual(liveCalls, [{ projectId: ctx.projectId, on: false }]);
});
