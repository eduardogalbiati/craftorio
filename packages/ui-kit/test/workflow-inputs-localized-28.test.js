// #28: the Start drawer showed the offered workflows' own texts (description, stations, input labels and help, the
// Mode options) in English in the pt-BR interface. WorkflowInputs.localized(wf) (packages/ui-kit/workflow-inputs.js)
// gives the drawer a copy of a bundled workflow in the interface language; the workflow files stay as they are
// (ids, YAML keys, input keys and enum values unchanged), and a workflow the owner wrote or changed is left alone.
//
// The workflows are the real bundled files (workflows/*.yaml), parsed as the engine lists them (the YAML's own
// fields plus file and origin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const I18n = require('@craftorio/shared/i18n');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const OFFERED = ['issue', 'feature', 'fix', 'analyze-project', 'release'];
const load = (name, origin = 'bundled') => {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', `${name}.yaml`), 'utf8'));
  return { ...doc, name: doc.metadata.name, description: doc.metadata.description, file: `${name}.yaml`, origin };
};
// stations whose pt-BR label is the same word on purpose ("CI"; release_step_ship is "Ship", as "Ship falhou")
const SAME_WORD = new Set(['release:ship', 'feature:ci', 'fix:ci']);

test.afterEach(() => I18n.setLanguage('en'));

test('#28 pt-BR: the issue workflow\'s stations read Analisar › Redigir › Revisar › Registrar', () => {
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(load('issue'));
  assert.deepEqual(shown.steps.map((s) => s.display), ['Analisar', 'Redigir', 'Revisar', 'Registrar']);
});

test('#28 pt-BR: the issue workflow\'s request field, Mode and its options are in Portuguese', () => {
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(load('issue'));
  assert.equal(shown.inputs.request.label, 'Pedido');
  assert.match(shown.inputs.request.description, /^O problema ou a ideia, em poucas palavras/);
  assert.equal(shown.inputs.mode.label, 'Modo');
  assert.equal(WorkflowInputs.optionLabel(shown.inputs.mode, 'auto'), 'Automático');
  assert.equal(WorkflowInputs.optionLabel(shown.inputs.mode, 'validated'), 'Validado');
});

for (const name of OFFERED) {
  test(`#28 pt-BR: ${name}'s description and every station differ from the file's English`, () => {
    const wf = load(name);
    const english = WorkflowInputs.localized(wf);
    I18n.setLanguage('pt-BR');
    const shown = WorkflowInputs.localized(wf);
    assert.ok(wf.description, 'the file has a description');
    assert.ok(shown.description, 'a description');
    assert.notEqual(shown.description, wf.description);
    for (const [i, s] of (wf.steps || []).entries()) {
      const display = shown.steps[i].display;
      assert.ok(display, `station ${s.id} has a label`);
      if (!SAME_WORD.has(`${name}:${s.id}`)) assert.notEqual(display, english.steps[i].display || s.id, `station ${s.id} translated`);
    }
  });

  test(`#28 ${name}: ids, input keys and enum values stay as the file has them`, () => {
    const wf = load(name);
    I18n.setLanguage('pt-BR');
    const shown = WorkflowInputs.localized(wf);
    assert.equal(shown.name, wf.name);
    assert.equal(shown.file, wf.file);
    assert.deepEqual(shown.steps.map((s) => s.id), (wf.steps || []).map((s) => s.id));
    assert.deepEqual(Object.keys(shown.inputs), Object.keys(wf.inputs || {}));
    for (const [key, def] of Object.entries(wf.inputs || {})) {
      if (def.enum) assert.deepEqual(Array.from(shown.inputs[key].enum), Array.from(def.enum), `${key}'s values`);
    }
  });
}

test('#28 English: the issue workflow keeps its file\'s description and its stations read Analyze › Write › Review › File', () => {
  const wf = load('issue');
  const shown = WorkflowInputs.localized(wf);
  assert.equal(shown.description, wf.description);
  assert.deepEqual(shown.steps.map((s) => s.display), ['Analyze', 'Write', 'Review', 'File']);
});

test('#28 pt-BR: a workflow the owner wrote or changed (not bundled) keeps its own texts', () => {
  const wf = load('issue', 'project');
  I18n.setLanguage('pt-BR');
  const shown = WorkflowInputs.localized(wf);
  assert.equal(shown.description, wf.description);
  assert.deepEqual(shown.steps.map((s) => s.display || ''), wf.steps.map((s) => s.display || ''));
});

test('#28 the bundled issue workflow file keeps its labels bug and impact:3 (the YAML is not translated)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'workflows', 'issue.yaml'), 'utf8');
  assert.match(src, /\bbug\b/);
  assert.match(src, /impact:/);
});
