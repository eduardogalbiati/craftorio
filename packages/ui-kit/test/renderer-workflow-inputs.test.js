// packages/ui-kit/workflow-inputs.js (#116): one shared renderer for a workflow's inputs (the
// Backlog's Assign dialog, the Start drawer, the Roadmap item editor). The module exports a plain
// object in Node (module.exports), so it is required directly here, without a DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const WorkflowInputs = require('../workflow-inputs');

// ---- label / optionLabel: human text, never a raw snake_case slug -------------------------

test('label: derives a human label from the key when none is given; a given label wins', () => {
  assert.equal(WorkflowInputs.label('base_branch'), 'Base branch');
  assert.equal(WorkflowInputs.label('validate_every_round'), 'Validate every round');
  assert.equal(WorkflowInputs.label('base_branch', { label: 'Custom' }), 'Custom');
  assert.doesNotMatch(WorkflowInputs.label('base_branch'), /_/);
});

test('optionLabel: uses the workflow\'s options, falls back to a 2-3 letter slug upper-cased or a humanized word', () => {
  assert.equal(WorkflowInputs.optionLabel({ options: { auto: 'Automatic' } }, 'auto'), 'Automatic');
  assert.equal(WorkflowInputs.optionLabel({}, 'gh'), 'GH');
  assert.equal(WorkflowInputs.optionLabel({}, 'csharp'), 'Csharp');
});

// ---- kind: the control a given input renders as -------------------------------------------

test('kind: a short enum (<=5 short values) renders pills; a longer one a select', () => {
  assert.equal(WorkflowInputs.kind('language', { enum: ['js', 'python', 'go', 'java', 'csharp'] }), 'pills');
  assert.equal(WorkflowInputs.kind('many', { enum: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'select');
});

test('kind: type boolean, or an enum of exactly "false"/"true", renders a switch', () => {
  assert.equal(WorkflowInputs.kind('validate_every_round', { type: 'boolean' }), 'switch');
  assert.equal(WorkflowInputs.kind('flag', { enum: ['false', 'true'] }), 'switch');
});

test('kind: *branch renders branch, integer/number renders number, the rest text', () => {
  assert.equal(WorkflowInputs.kind('base_branch', { type: 'string' }), 'branch');
  assert.equal(WorkflowInputs.kind('max_revisions', { type: 'integer' }), 'number');
  assert.equal(WorkflowInputs.kind('request', { type: 'string' }), 'text');
});

// ---- evalCondition: the show_if expression language ----------------------------------------

test('evalCondition: ==, !=, the "inputs." prefix, and/or/not and parentheses', () => {
  const values = { mode: 'validated', ready: true };
  assert.equal(WorkflowInputs.evalCondition("mode == 'validated'", values), true);
  assert.equal(WorkflowInputs.evalCondition("mode == 'auto'", values), false);
  assert.equal(WorkflowInputs.evalCondition("inputs.mode != 'auto'", values), true);
  assert.equal(WorkflowInputs.evalCondition("mode == 'validated' and ready", values), true);
  assert.equal(WorkflowInputs.evalCondition("mode == 'auto' or not ready", values), false);
  assert.equal(WorkflowInputs.evalCondition("(mode == 'auto' or ready) and mode == 'validated'", values), true);
});

test('evalCondition: empty or unreadable is always true, so a typo never hides an input', () => {
  assert.equal(WorkflowInputs.evalCondition('', {}), true);
  assert.equal(WorkflowInputs.evalCondition(undefined, {}), true);
  assert.equal(WorkflowInputs.evalCondition("mode === 'validated'", { mode: 'validated' }), true);
});

// ---- formHtml: show_if hides a field; labels are never raw keys -----------------------------

test('formHtml: show_if hides validate_every_round under Automatic, shows it under Validated', () => {
  const defs = {
    mode: { enum: ['auto', 'validated'], default: 'auto' },
    validate_every_round: { type: 'boolean', default: false, show_if: "mode == 'validated'" },
  };
  const auto = WorkflowInputs.formHtml(defs, { values: { mode: 'auto' } });
  assert.match(auto, /data-wi-key="validate_every_round"[^>]* hidden/);

  const validated = WorkflowInputs.formHtml(defs, { values: { mode: 'validated' } });
  assert.doesNotMatch(validated, /data-wi-key="validate_every_round"[^>]* hidden/);
  assert.match(validated, /data-wi-key="validate_every_round"/);
});

test('formHtml: no field label is a raw snake_case key', () => {
  const defs = { base_branch: { type: 'string' }, validate_every_round: { type: 'boolean' } };
  const html = WorkflowInputs.formHtml(defs, { values: {} });
  assert.doesNotMatch(html, />base_branch</);
  assert.doesNotMatch(html, />validate_every_round</);
  assert.match(html, />Base branch</);
  assert.match(html, />Validate every round</);
});

// ---- read / set: values round-trip as the YAML takes them -----------------------------------

function fakeField(key, { type = 'text', value = '', checked = false, flag } = {}) {
  const dataset = { wiInput: key };
  if (flag) dataset.wiFlag = flag;
  return { dataset, type, value, checked };
}
function fakeRoot(fields) {
  return { querySelectorAll: (sel) => (sel === '[data-wi-input]' ? fields : []) };
}

test('read: a switch (type boolean) returns a boolean; a "false"/"true" enum switch returns its string; empty text is left out unless all', () => {
  const root = fakeRoot([
    fakeField('validate_every_round', { type: 'checkbox', checked: true, flag: 'bool' }),
    fakeField('mode', { type: 'checkbox', checked: true, flag: 'text' }),
    fakeField('request', { type: 'text', value: '' }),
    fakeField('base_branch', { type: 'text', value: 'main' }),
  ]);
  assert.deepEqual(WorkflowInputs.read(root), { validate_every_round: true, mode: 'true', base_branch: 'main' });
  assert.deepEqual(WorkflowInputs.read(root, { all: true }), { validate_every_round: true, mode: 'true', request: '', base_branch: 'main' });
});

test('read: the saved values are the workflow\'s own enum values, not their display labels', () => {
  const root = fakeRoot([fakeField('language', { type: 'hidden', value: 'js' }), fakeField('mode', { type: 'hidden', value: 'validated' })]);
  assert.deepEqual(WorkflowInputs.read(root), { language: 'js', mode: 'validated' });
});

test('set: a pill click updates the hidden input\'s value and marks the matching pill active', () => {
  const html = WorkflowInputs.fieldHtml('mode', { enum: ['auto', 'validated'] }, { value: 'auto', id: 'wi-mode' });
  assert.ok(html.includes('wi-pills')); // the markup set() acts on is itself pills-based
  // a minimal fake field element exposing the pills and the hidden input, built from the markup's shape
  const pills = [{ dataset: { wiPill: 'auto' }, classList: mkClassList(true), setAttribute() {} }, { dataset: { wiPill: 'validated' }, classList: mkClassList(false), setAttribute() {} }];
  const field = { dataset: {}, querySelectorAll: (sel) => (sel === '[data-wi-pill]' ? pills : []) };
  const hidden = { type: 'hidden', dataset: { wiInput: 'mode' }, value: 'auto', closest: () => field };
  const root = { querySelector: (sel) => (sel === '[data-wi-input="mode"]' ? hidden : null) };
  assert.equal(WorkflowInputs.set(root, 'mode', 'validated'), true);
  assert.equal(hidden.value, 'validated');
  assert.equal(pills[0].classList.contains('active'), false);
  assert.equal(pills[1].classList.contains('active'), true);
});

function mkClassList(initial) {
  const set = new Set(initial ? ['active'] : []);
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => (f ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

// ---- applyHints: prefills language (marked "detected") and branches, without overriding the owner --

// A minimal root whose querySelector tells apart the two selector shapes applyHints/set use:
// ".wi-field[data-wi-key=...]" (the field wrapper, with its own .wi-note/datalist) and
// "[data-wi-input=...]" (the control itself, read/written directly).
function makeFakeRoot(keys) {
  const controls = {};
  const fields = {};
  for (const k of keys) {
    const notes = [];
    const control = { dataset: { wiInput: k }, type: 'text', value: '', closest: () => null };
    const datalist = { innerHTML: '' };
    fields[k] = {
      dataset: {},
      querySelector: (sel) => (sel === '[data-wi-input]' ? control : sel === '.wi-note' ? { set innerHTML(v) { notes.push(v); } } : sel === 'datalist' ? datalist : null),
      _notes: notes,
      _datalist: datalist,
    };
    controls[k] = control;
  }
  const root = {
    querySelector(sel) {
      const field = /^\.wi-field\[data-wi-key="([^"]+)"\]$/.exec(sel);
      if (field) return fields[field[1]] || null;
      const input = /^\[data-wi-input="([^"]+)"\]$/.exec(sel);
      if (input) return controls[input[1]] || null;
      return null;
    },
  };
  return { root, controls, fields };
}

test('applyHints: fills language from the project\'s files, marked "detected", when it is one of the workflow\'s options; also fills base_branch\'s default branch and its datalist', async (t) => {
  t.after(() => { delete global.api; });
  const { root, controls, fields } = makeFakeRoot(['language', 'base_branch']);
  global.api = { projectInputHints: async () => ({ language: 'python', branches: ['main', 'dev'], defaultBranch: 'main' }) };
  const defs = { language: { enum: ['js', 'python', 'go'] }, base_branch: { type: 'string', default: '' } };

  await WorkflowInputs.applyHints(root, defs, 'proj-1');
  assert.equal(controls.language.value, 'python');
  assert.match(fields.language._notes.join(''), /detected/);
  assert.equal(controls.base_branch.value, 'main');
  assert.match(fields.base_branch._datalist.innerHTML, /<option value="main">.*<option value="dev">/s);
});

test('applyHints: a field the owner already touched (field.dataset.wiTouched) keeps its value', async (t) => {
  t.after(() => { delete global.api; });
  const { root, controls, fields } = makeFakeRoot(['language']);
  fields.language.dataset.wiTouched = '1';
  controls.language.value = 'go';
  global.api = { projectInputHints: async () => ({ language: 'python', branches: [], defaultBranch: null }) };

  await WorkflowInputs.applyHints(root, { language: { enum: ['js', 'python', 'go'] } }, 'proj-1');
  assert.equal(controls.language.value, 'go');
});

test('applyHints: without a projectId, or without api.projectInputHints, it does nothing (never throws)', async () => {
  delete global.api;
  const root = { querySelector: () => { throw new Error('must not be reached'); } };
  await assert.doesNotReject(WorkflowInputs.applyHints(root, { language: {} }, null));
  await assert.doesNotReject(WorkflowInputs.applyHints(root, { language: {} }, 'proj-1'));
});

// ---- inputPills (#216): a run's inputs as friendly pills, the same on every card --------------
// inputPills(workflow, inputs) → markup: one pill per input not at its workflow default, "<label>:
// <option label>"; the raw key and value only in the tooltip. Shared by the roadmap card, the
// Product Owner's proposal card, the Assign dialog summary and the run header.

const pillsText = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const heroWorkflow = {
  file: 'software-development-local-hero.yaml',
  inputs: {
    unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run', label: 'Unit tests', options: { write_and_run: 'Write and run', run_existing: 'Run existing', off: 'Off' }, description: 'How the change is tested.' },
    e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'off', label: 'E2E', options: { off: 'Off', write: 'Write only', write_and_run: 'Write and run' } },
    screenshots: { enum: ['all', 'changed', 'off'], default: 'all', label: 'Screenshots', options: { all: 'All', changed: 'Changed', off: 'Off' } },
  },
};

test('inputPills: each input not at its default is a pill "<label>: <option label>", with no snake_case and no "="', () => {
  const t = pillsText(WorkflowInputs.inputPills(heroWorkflow, { unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' }));
  assert.match(t, /Unit tests: Run existing/);
  assert.match(t, /E2E: Write only/);
  assert.match(t, /Screenshots: Off/);
  assert.doesNotMatch(t, /_|=/);
});

test('inputPills: an input at its workflow default is hidden or dimmed, never a plain pill', () => {
  const html = WorkflowInputs.inputPills(heroWorkflow, { unit_tests: 'write_and_run', screenshots: 'off' });
  assert.match(pillsText(html), /Screenshots: Off/);
  const at = html.indexOf('Unit tests');
  if (at >= 0) assert.match(html.slice(html.lastIndexOf('class="', at), at), /dim|default/);
});

test('inputPills: the tooltip keeps the input\'s description and the raw key and value', () => {
  const html = WorkflowInputs.inputPills(heroWorkflow, { unit_tests: 'run_existing' });
  assert.match(html, /title="[^"]*unit_tests[^"]*run_existing[^"]*"/);
  assert.match(html, /title="[^"]*How the change is tested\.[^"]*"/);
});

test('inputPills: an input the workflow does not declare falls back to a humanized key and value', () => {
  const t = pillsText(WorkflowInputs.inputPills(heroWorkflow, { max_rounds: 3, base_branch: 'release_2' }));
  assert.match(t, /Max rounds: 3/);
  assert.match(t, /Base branch: /);
  assert.doesNotMatch(t, /max_rounds|base_branch/);
});

test('inputPills: no inputs gives no pills; no workflow still labels each input from its key', () => {
  assert.equal(pillsText(WorkflowInputs.inputPills(heroWorkflow, null)).trim(), '');
  assert.equal(pillsText(WorkflowInputs.inputPills(heroWorkflow, {})).trim(), '');
  assert.match(pillsText(WorkflowInputs.inputPills(null, { unit_tests: 'off' })), /Unit tests: Off/);
});

// ---- #286: developer_effort of ai-development-local-hero, drawn by the shared renderer -------
// The Start drawer, the Assign dialog and the roadmap item's Edit all draw the workflow's inputs
// with formHtml, and the roadmap card's input pairs come from inputPills: the real YAML's inputs.
const heroInputs = () => {
  const yaml = require('js-yaml');
  const file = require('path').join(__dirname, '..', '..', '..', 'workflows', 'ai-development-local-hero.yaml');
  return yaml.load(require('fs').readFileSync(file, 'utf8')).inputs;
};

test('formHtml (#286): "Developer effort" comes right after "Developer model", Default to Extra high, Default selected', () => {
  const html = WorkflowInputs.formHtml(heroInputs(), { values: {} });
  const keys = [...html.matchAll(/data-wi-key="([^"]+)"/g)].map((m) => m[1]);
  const at = keys.indexOf('developer_effort');
  assert.ok(at > 0, 'the developer_effort field is drawn');
  assert.equal(keys[at - 1], 'developer_model');
  assert.match(html, />Developer effort</);
  const pills = [...html.matchAll(/data-wi-pill="([^"]+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}=${m[2]}`);
  for (const p of ['default=Default', 'low=Low', 'medium=Medium', 'high=High', 'xhigh=Extra high']) assert.ok(pills.includes(p), `pill ${p}`);
  assert.match(html, /data-wi-input="developer_effort"[^>]*value="default"/);
  assert.match(WorkflowInputs.formHtml(heroInputs(), { values: { developer_effort: 'high' } }), /data-wi-input="developer_effort"[^>]*value="high"/);
});

test('inputPills (#286): the roadmap card shows "Developer effort: High", never a plain pill at Default', () => {
  const wf = { file: 'ai-development-local-hero.yaml', inputs: heroInputs() };
  assert.match(pillsText(WorkflowInputs.inputPills(wf, { developer_effort: 'high' })), /Developer effort: High/);
  assert.match(pillsText(WorkflowInputs.inputPills(wf, { developer_effort: 'xhigh' })), /Developer effort: Extra high/);
  const html = WorkflowInputs.inputPills(wf, { developer_effort: 'default' });
  const at = html.indexOf('Developer effort');
  if (at >= 0) assert.match(html.slice(html.lastIndexOf('class="', at), at), /dim|default/);
});
