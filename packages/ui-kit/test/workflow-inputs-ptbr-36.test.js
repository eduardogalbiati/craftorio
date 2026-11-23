// #36 acceptance, written before the code: the Assign dialog (fronts/build/views/backlog/backlog.js renderAssignInputs)
// draws a workflow's inputs with WorkflowInputs.formHtml; in the pt-BR interface their labels, options and help still
// came in the YAML's English ("Target", "Language", "Base branch", "Mode", "Developer model", "Unit tests", "E2E
// tests", "Screenshots", "UI folders", "Test command"; "Write and run", "Changed screens", "Off"). #28's
// WorkflowInputs.localized covered part of it for a bundled copy only. Also the check_environment gate's choice help
// ("Runs the rule checks again, once the dependencies are installed.", "Ends the run as failed; its branch keeps the
// work to resume it."), shown under the gate's buttons.
//
// The workflows are the real files, loaded by the engine's loader (loadWorkflow) while the interface is pt-BR, with
// the origin the service lists them with (`default`: a bundled copy of workflows/*.yaml; `repository`: the
// repository's own .craftorio/workflows/*.yaml). The form is drawn as a screen shows a workflow's inputs:
// WorkflowInputs.formHtml(WorkflowInputs.localized(wf).inputs) (either seam may carry the translation: a
// `label_key` / `help_key` in the YAML read by formHtml, a pt-BR fallback in the loader, or localized()). The gate is
// the engine's own approval record (gates.js requestApproval, with a minimal run around it) drawn by the real
// gate-panel.js's gateButtonsHelpHtml in a vm sandbox, as gate-environment-30.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const FILES = [
  ['workflows', 'feature.yaml', 'default'],
  ['workflows', 'refactor.yaml', 'default'],
  [path.join('.craftorio', 'workflows'), 'ai-development-local-hero.yaml', 'repository'],
  [path.join('.craftorio', 'workflows'), 'ai-development-remote-hero.yaml', 'repository'],
];
const LABELS = ['Target', 'Language', 'Base branch', 'Mode', 'Developer model', 'Unit tests', 'E2E tests', 'Screenshots', 'UI folders', 'Test command'];
const OPTIONS = ['Write and run', 'Changed screens', 'Off'];

test.afterEach(() => I18n.setLanguage('en'));

function load(dir, file, origin) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, dir, file));
  return { ...wf, name: wf.metadata?.name || file, description: wf.metadata?.description, file, origin };
}
const englishOf = (dir, file) => load(dir, file, 'custom'); // the file's own texts, as loaded in English

// the drawn form's texts of input `key`: { label, help, options: { value: text } }
function fieldTexts(html, key) {
  const start = html.indexOf(`data-wi-key="${key}"`);
  if (start < 0) return null;
  const next = html.indexOf('data-wi-key="', start + 1);
  const block = html.slice(start, next < 0 ? html.length : next);
  const label = (/<label id="[^"]*-label"[^>]*>([^<]*)/.exec(block) || [])[1] || '';
  const help = (/<div class="hint">([^<]*)<\/div>/.exec(block) || [])[1] || '';
  const options = {};
  for (const m of block.matchAll(/data-wi-pill="([^"]*)"[^>]*>([^<]*)</g)) options[m[1]] = m[2];
  for (const m of block.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)) options[m[1]] = m[2];
  return { label: label.trim(), help, options };
}
const formOf = (wf) => WorkflowInputs.formHtml(WorkflowInputs.localized(wf).inputs || {});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

for (const [dir, file, origin] of FILES) {
  test(`#36 pt-BR ${file}: the listed input labels and their help are not the file's English`, () => {
    const en = englishOf(dir, file);
    const keys = Object.entries(en.inputs || {}).filter(([, d]) => LABELS.includes(String(d.label || ''))).map(([k]) => k);
    assert.ok(keys.length >= 2, `${file} has some of the listed inputs`);
    I18n.setLanguage('pt-BR');
    const html = formOf(load(dir, file, origin));
    const english = [];
    for (const k of keys) {
      const f = fieldTexts(html, k);
      assert.ok(f, `${file}: the form draws ${k}`);
      if (f.label === en.inputs[k].label) english.push(`${k} label "${f.label}"`);
      if (en.inputs[k].description && f.help === esc(en.inputs[k].description)) english.push(`${k} help`);
    }
    assert.deepEqual(english, []);
  });
}

// (the bundled feature.yaml's options are #28's already; refactor.yaml has none of them)
for (const [dir, file, origin] of FILES.filter(([, , o]) => o === 'repository')) {
  test(`#36 pt-BR ${file}: the options "Write and run", "Changed screens" and "Off" are not in English`, () => {
    const en = englishOf(dir, file);
    const pairs = Object.entries(en.inputs || {}).flatMap(([k, d]) => (d.enum || []).map((v) => [k, String(v)])
      .filter(([, v]) => OPTIONS.includes(WorkflowInputs.optionLabel(d, v))));
    assert.ok(pairs.length >= 3, `${file} offers the listed options`);
    I18n.setLanguage('pt-BR');
    const html = formOf(load(dir, file, origin));
    const english = pairs.filter(([k, v]) => OPTIONS.includes(fieldTexts(html, k)?.options[v])).map(([k, v]) => `${k}=${v}`);
    assert.deepEqual(english, []);
  });
}

test('#36 English unchanged: the hero workflow\'s form keeps "Base branch", "Unit tests" and "Write and run"', () => {
  const html = formOf(load(path.join('.craftorio', 'workflows'), 'ai-development-local-hero.yaml', 'repository'));
  assert.equal(fieldTexts(html, 'base_branch').label, 'Base branch');
  assert.equal(fieldTexts(html, 'unit_tests').label, 'Unit tests');
  assert.equal(fieldTexts(html, 'unit_tests').options.write_and_run, 'Write and run');
});

// ---- 6. the check_environment gate's choice help ------------------------------------------------------

const { methods: gates } = require('@craftorio/engine/engine/run/gates');
// the approval record the engine emits for step `id` of a workflow (approval.requested's payload)
function gateRecord(wf, id) {
  const step = wf.steps.find((s) => s.id === id);
  assert.ok(step, `${wf.file} has a ${id} gate`);
  const events = [];
  const run = {
    ...gates, pausing: false, nApproval: 0, ctx: { steps: { rule_check: { output: { cause: 'npm ci was not run' } } } }, inputs: {},
    approvals: new Map(), orchestrator: {}, issues: [], localPreview: null,
    emitEvent: (type, payload) => events.push({ type, payload }), syncGateClock() {}, setStatus() {}, resolveApproval() {},
  };
  run.requestApproval(step).catch(() => {});
  const ev = events.find((e) => e.type === 'approval.requested');
  assert.ok(ev, 'the gate emits approval.requested');
  return { run_id: 'r1', ...ev.payload };
}
function gateHelpText(lang, record) {
  const sandbox = { state: { runs: new Map() }, document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null }, api: {} };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  withI18n(sandbox);
  I18n.setLanguage(lang);
  vm.createContext(sandbox);
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(/const esc = \(s\) => [^\n]+/.exec(appSrc)[0], sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gate-panel.js'), 'utf8'), sandbox);
  return String(sandbox.gateButtonsHelpHtml(JSON.parse(JSON.stringify(record))));
}
const GATE_HELP = ['Runs the rule checks again, once the dependencies are installed.', 'Ends the run as failed; its branch keeps the work to resume it.'];

for (const [dir, file, origin] of [FILES[0], FILES[2]]) {
  test(`#36 pt-BR ${file}: the check_environment gate's choice help is not in English`, () => {
    I18n.setLanguage('pt-BR');
    const html = gateHelpText('pt-BR', gateRecord(load(dir, file, origin), 'check_environment'));
    assert.ok(html.includes('<li>'), 'the gate shows a help line per choice');
    assert.deepEqual(GATE_HELP.filter((h) => html.includes(esc(h))), []);
  });
}

test('#36 English unchanged: the check_environment gate\'s choice help reads as the file says', () => {
  const html = gateHelpText('en', gateRecord(load('workflows', 'feature.yaml', 'default'), 'check_environment'));
  assert.deepEqual(GATE_HELP.filter((h) => html.includes(esc(h))), GATE_HELP);
});
