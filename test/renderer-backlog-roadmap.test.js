// src/renderer/backlog-roadmap.js: the Backlog "Roadmap" view (#106, #110). It runs only inside the
// Electron renderer (document, window.api), so it is loaded whole into a vm sandbox that stubs those
// globals (esc, state, errMsg, devMode, confirmDialog, api, document, window), the way
// test/renderer-run-view.test.js and test/renderer-run-gates.test.js check app.js as a seam. Each test
// gets a fresh sandbox: `editing` / `adding` / `noteEditing` / the loaded workflows are the module's own
// closure state, not reset between calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'backlog-roadmap.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadRoadmap({ listWorkflows, confirmDialog, querySelector, devMode } = {}) {
  const savedCalls = [];
  const startCalls = [];
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: devMode || (() => false),
    confirmDialog: confirmDialog || (async () => true),
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
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { BacklogRoadmap: sandbox.window.BacklogRoadmap, savedCalls, startCalls };
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

test('onClick [data-rm-edit] then html: an enum input renders a select, a boolean/flag renders a checkbox, others render text; task/issue/path/mode inputs stay out of the form', async () => {
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
  assert.match(html, /<select id="rm-f-it1-language" data-rm-field="language"[^>]*><option value="js">js<\/option><option value="python" selected>python<\/option><\/select>/);
  assert.match(html, /Programming language/);
  assert.match(html, /<input type="checkbox" data-rm-field="validate_every_round" data-flag="bool"[^/]*checked/);
  assert.doesNotMatch(html, /data-rm-field="task"/);
  assert.doesNotMatch(html, /data-rm-field="project_path"/);
  assert.doesNotMatch(html, /data-rm-field="mode"/);
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
    { dataset: { rmField: 'feature_flag', flag: 'text' }, type: 'checkbox', checked: true },
    { dataset: { rmField: 'validate_every_round', flag: 'bool' }, type: 'checkbox', checked: false },
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

test('addStage (Product Owner, #140): a new stage\'s item carries the origin it was added with', async () => {
  const { BacklogRoadmap, savedCalls } = loadRoadmap();
  const ctx = makeCtx('proj-z');
  await BacklogRoadmap.addStage(ctx, { roadmap: { stages: [] } }, { issues: [1, 2], workflow: 'w.yaml', inputs: {}, mock: true, group: true, origin: 'ts-1' });
  assert.equal(savedCalls[0].stages[0].items[0].origin, 'ts-1');
});
