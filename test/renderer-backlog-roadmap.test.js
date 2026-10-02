// src/renderer/views/backlog/backlog-roadmap.js: the Backlog "Roadmap" view (#106, #110). It runs
// only inside the Electron renderer (document, window.api), so it is loaded whole into a vm
// sandbox that stubs those globals (esc, state, errMsg, devMode, confirmDialog, api, document,
// window), the way test/renderer-run-view.test.js and test/renderer-run-gates.test.js check app.js
// as a seam. Each test gets a fresh sandbox: `editing` / `adding` / `noteEditing` / the loaded
// workflows are the module's own closure state, not reset between calls.
const test = require('node:test');
const assert = require('node:assert/strict');
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadRoadmap({ listWorkflows, confirmDialog, keptWorkDialog, roadmapItem, querySelector, devMode } = {}) {
  const savedCalls = [];
  const startCalls = [];
  const roadmapItemCalls = [];
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: devMode || (() => false),
    confirmDialog: confirmDialog || (async () => true),
    keptWorkDialog: keptWorkDialog || (async () => null),
    document: { querySelector: querySelector || (() => null) },
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
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(workflowInputsSrc, sandbox); // the real WorkflowInputs module (#116), not reimplemented
  vm.runInContext(src, sandbox);
  return { BacklogRoadmap: sandbox.window.BacklogRoadmap, savedCalls, startCalls, roadmapItemCalls };
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
  const html = BacklogRoadmap.html(data, () => {});
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
  BacklogRoadmap.html(data, () => {}); // kicks off loadWorkflows
  await settle();
  const html = BacklogRoadmap.html(data, () => {});
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
  BacklogRoadmap.html(data, () => {});
  await settle();
  const html = BacklogRoadmap.html(data, () => {});
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
  BacklogRoadmap.html(data, () => {});
  await settle();

  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: editButtonTarget('it1', 0) }, ctx, data);
  const html = BacklogRoadmap.html(data, () => {});
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

test('a stage note shows "add note" when empty, text + edit when set, and onChange saves the stage note', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const stage = { id: 'st1', name: '', note: '', items: [] };
  const data = { roadmap: { state: 'planned', stages: [stage] }, issues: [] };
  let html = BacklogRoadmap.html(data, () => {});
  assert.match(html, /data-rm-addnote>add note<\/button>/);
  assert.doesNotMatch(html, /data-rm-note/);

  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: addNoteButtonTarget(0) }, ctx, data);
  html = BacklogRoadmap.html(data, () => {});
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
  html = BacklogRoadmap.html(withNote, () => {});
  assert.match(html, /Why this order <button class="link-btn small" type="button" data-rm-addnote>edit<\/button>/);
});

test('html: the complexity badge is the sum of the issues\' complexity:n labels; absent when none has one', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = { id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }, { number: 2, title: 'B', url: 'u2' }] };
  const data = {
    roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] },
    issues: [{ number: 1, labels: [{ name: 'complexity:3' }] }, { number: 2, labels: [{ name: 'complexity:5' }] }],
  };
  const html = BacklogRoadmap.html(data, () => {});
  assert.match(html, /<span class="badge rm-size"[^>]*>complexity 8<\/span>/);

  const noLabels = { ...data, issues: [] };
  const html2 = BacklogRoadmap.html(noLabels, () => {});
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
  const html = BacklogRoadmap.html(data, () => {});
  assert.match(html, /<span class="pill pill-idle rm-state">planned<\/span>/);
  assert.match(html, /<span class="pill pill-cancelled rm-state">waiting at a gate<\/span>/);
  assert.match(html, /<span class="pill pill-interrupted rm-state">skipped<\/span>/);
});

test('html: reason and modeReason render inside details.rm-reason', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const item = {
    id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [{ number: 1, title: 'A', url: 'u' }],
    reason: 'Groups the UI fixes together', modeReason: 'Validated: the owner can try it in the app',
  };
  const data = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const html = BacklogRoadmap.html(data, () => {});
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
  const planned = BacklogRoadmap.html(threeStageData(['planned', 'planned', 'planned']), () => {});
  assert.equal((planned.match(/data-rm-run-stage title="Run only this stage/g) || []).length, 3);
  assert.doesNotMatch(planned, /data-rm-run-stage[^>]*disabled/);

  const done = BacklogRoadmap.html(threeStageData(['done', 'planned', 'planned']), () => {});
  assert.match(done, /data-rm-run-stage title="No planned item in this stage" disabled/);

  const running = BacklogRoadmap.html(threeStageData(['planned', 'planned', 'planned'], { state: 'running' }), () => {});
  assert.match(running, /data-rm-run-stage title="The roadmap is running: pause or stop it first" disabled/g);
  assert.equal((running.match(/data-rm-run-stage[^>]*disabled/g) || []).length, 3);
});

test('html: the stage run on its own is highlighted (running or paused), the bar names it, and the other stages keep their plain badge', () => {
  const { BacklogRoadmap } = loadRoadmap();
  const running = BacklogRoadmap.html(threeStageData(['done', 'running', 'planned'], { state: 'running', scope: { stage: 'st2' } }), () => {});
  assert.match(running, /<section class="rm-stage current scoped" data-stage="1"[^>]*>[\s\S]*?<span class="badge live">Running this stage only<\/span>/);
  assert.match(running, /<b>Roadmap<\/b> <span class="badge live">running · stage 2 only<\/span>/);
  // stage 1 (done) and stage 3 (planned, not scoped, not current) keep their own plain badges
  assert.match(running, /<section class="rm-stage finished" data-stage="0"[^>]*>[\s\S]*?<span class="badge">done<\/span>/);
  assert.doesNotMatch(running, /data-stage="2"[^>]*>[\s\S]{0,400}badge live/);

  const paused = BacklogRoadmap.html(threeStageData(['done', 'failed', 'planned'], { state: 'paused', scope: { stage: 'st2' } }), () => {});
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
