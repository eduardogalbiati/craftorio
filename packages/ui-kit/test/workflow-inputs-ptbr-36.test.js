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

// ---- #41: every input of every bundled workflow (and the repository's hero workflows) ------------------------------
// Each input a form draws (Start leaves the path/dir inputs to the project picker) shows its label, its help and each
// option in Portuguese: differing from the file's English, or the same word on purpose, which its own pt-BR key in
// pt-BR.json says (the key the UI reads: the input's label_key / help_key / options_key, else a bundled copy's
// workflow_texts.<workflow>_<input>_label|_desc|_opt_<value>). Proper names stay as they are (languages, platforms,
// providers and models). Includes Mockup, Test order (E2E first / Code first), Review (Single reviewer / Multi-model),
// Retrospective after, Parent branch, E2E command, Check command, the effort levels and Git platform.
const PT = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'pt-BR.json'), 'utf8'));
const snake = (s) => String(s ?? '').replace(/\.ya?ml$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const PROPER = /^(JavaScript|TypeScript|Python|Go|Java|C#|Rust|GitHub|GitLab|Claude|Codex|Grok|(Opus|Sonnet|Haiku|Fable|GPT)\b.*)$/;
const EVERY = [
  ...fs.readdirSync(path.join(ROOT, 'workflows')).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => ['workflows', f, 'default']),
  FILES[2], FILES[3],
];
function untranslatedInputs(dir, file, origin) {
  const en = englishOf(dir, file);
  const bundled = origin === 'default';
  const name = snake(file);
  const keyed = (own, suffix) => { const key = own || (bundled ? `workflow_texts.${name}_${snake(suffix)}` : null); return !!key && key in PT; };
  I18n.setLanguage('pt-BR');
  const html = formOf(load(dir, file, origin));
  const out = [];
  for (const [k, d] of Object.entries(en.inputs || {})) {
    if (/path|dir/i.test(k)) continue;
    const f = fieldTexts(html, k);
    if (!f) { out.push(`${k}: not drawn`); continue; }
    if (f.label === esc(WorkflowInputs.label(k, d)) && !keyed(d.label_key, `${k}_label`)) out.push(`${k} label "${f.label}"`);
    if (d.description && f.help === esc(d.description) && !keyed(d.help_key, `${k}_desc`)) out.push(`${k} help`);
    if (!Array.isArray(d.enum) || WorkflowInputs.isBoolean(d)) continue;
    for (const v of d.enum.map(String)) {
      const english = WorkflowInputs.optionLabel(d, v);
      if (PROPER.test(english)) continue;
      if (f.options[v] === esc(english) && !keyed(d.options_key && `${d.options_key}_${snake(v)}`, `${k}_opt_${v}`)) out.push(`${k}=${v} "${english}"`);
    }
  }
  I18n.setLanguage('en');
  return out;
}

for (const [dir, file, origin] of EVERY) {
  test(`#41 pt-BR ${file}: every input label, help and option a form shows is in Portuguese`, () => {
    assert.deepEqual(untranslatedInputs(dir, file, origin), []);
  });
}

test('#41 English unchanged: feature\'s form keeps "Test order" (E2E first / Code first), "Review" (Single reviewer / Multi-model), "Developer effort" (Extra high) and "Git platform"', () => {
  const html = formOf(load('workflows', 'feature.yaml', 'default'));
  assert.equal(fieldTexts(html, 'test_order').label, 'Test order');
  assert.deepEqual([fieldTexts(html, 'test_order').options.e2e_first, fieldTexts(html, 'test_order').options.code_first], ['E2E first', 'Code first']);
  assert.equal(fieldTexts(html, 'review').label, 'Review');
  assert.deepEqual([fieldTexts(html, 'review').options.single, fieldTexts(html, 'review').options.multi_model], ['Single reviewer', 'Multi-model']);
  assert.equal(fieldTexts(html, 'developer_effort').options.xhigh, 'Extra high');
  assert.equal(fieldTexts(html, 'git_platform').label, 'Git platform');
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

for (const [dir, file, origin] of [FILES[0], FILES[2], FILES[3]]) {
  test(`#36 pt-BR ${file}: the check_environment gate's choice help is not in English`, () => {
    I18n.setLanguage('pt-BR');
    const html = gateHelpText('pt-BR', gateRecord(load(dir, file, origin), 'check_environment'));
    assert.ok(html.includes('<li>'), 'the gate shows a help line per choice');
    assert.deepEqual(GATE_HELP.filter((h) => html.includes(esc(h))), []);
  });
}

// #41: the gate's notification reads its brief (gate-summary.js gateBrief, stored on the approval record): the headline
// "The project's rule checks cannot run: <cause>" comes in the gate's pt-BR text, the cause as the check gave it
for (const [dir, file, origin] of [FILES[0], FILES[1], FILES[2], FILES[3]]) {
  test(`#41 pt-BR ${file}: the check_environment notification does not read "The project's rule checks cannot run"`, () => {
    I18n.setLanguage('pt-BR');
    const record = gateRecord(load(dir, file, origin), 'check_environment');
    const headline = String(record.brief?.headline || '');
    assert.match(headline, /npm ci was not run/, 'the cause is kept');
    assert.doesNotMatch(headline, /The project's rule checks cannot run/);
    assert.doesNotMatch(String(record.message || ''), /No developer round was counted|Fix the environment, then try again/);
  });
}

test('#41 English unchanged: the check_environment notification reads "The project\'s rule checks cannot run: <cause>"', () => {
  const record = gateRecord(load('workflows', 'feature.yaml', 'default'), 'check_environment');
  assert.equal(record.brief.headline, 'The project\'s rule checks cannot run: npm ci was not run');
});

test('#36 English unchanged: the check_environment gate\'s choice help reads as the file says', () => {
  const html = gateHelpText('en', gateRecord(load('workflows', 'feature.yaml', 'default'), 'check_environment'));
  assert.deepEqual(GATE_HELP.filter((h) => html.includes(esc(h))), GATE_HELP);
});
