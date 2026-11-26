// #41 acceptance, written before the code: the Run screen of a run started in English, read once the interface is
// Português (Brasil), named its steps ("Red check (TDD)"), its agents ("Issue writer", "Code analyzer", "Test writer"),
// its input chips ("Mode: Local", "Validation: Validated") and the waiting status ("Waiting for you") in English.
//
// Seams (the public functions the run screen draws with):
// - agents: @craftorio/shared/display-name's displayName(slug, names), which every agent label of the run screen goes
//   through (app.js agentLabel, run-list.js), `names` being the workflow.started `display.agents` the engine recorded
//   when the run started (engine/run/setup.js displayNames(), in English: the run started in English);
// - steps: WorkflowInputs.localized(wf), the resolver of a workflow's station names in the interface language (the
//   catalog's workflow_texts.<workflow>_step_<id>, or a step's display_key), over every bundled workflow and the
//   repository's hero workflows as the engine's loader lists them (fragments included): each step has a pt-BR name;
// - input chips: WorkflowInputs.inputPills(workflow, inputs) with the listed workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { displayName } = require('@craftorio/shared/display-name');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const PT = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'pt-BR.json'), 'utf8'));
const snake = (s) => String(s ?? '').replace(/\.ya?ml$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const EVERY = [
  ...fs.readdirSync(path.join(ROOT, 'workflows')).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => ['workflows', f, 'default']),
  [path.join('.craftorio', 'workflows'), 'ai-development-local-hero.yaml', 'repository'],
  [path.join('.craftorio', 'workflows'), 'ai-development-remote-hero.yaml', 'repository'],
];

test.afterEach(() => I18n.setLanguage('en'));

function load(dir, file, origin) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, dir, file));
  return { ...wf, name: wf.metadata?.name || file, description: wf.metadata?.description, file, origin };
}
// what the engine records on workflow.started (display: { agents, steps }), in the language set now
const recorded = (wf) => require('@craftorio/engine/engine/run/setup').methods.displayNames.call({ wf });

for (const [dir, file, origin] of EVERY) {
  test(`#41 pt-BR ${file}: every agent's name on the Run screen is in Portuguese (the run started in English)`, () => {
    const wf = load(dir, file, origin);
    const names = recorded(wf).agents;
    const english = Object.fromEntries(Object.keys(wf.agents || {}).map((a) => [a, displayName(a, names)]));
    I18n.setLanguage('pt-BR');
    const same = Object.keys(english).filter((a) => displayName(a, names) === english[a]).map((a) => `${a} "${english[a]}"`);
    assert.deepEqual(same, []);
  });

  test(`#41 pt-BR ${file}: every step has a Portuguese name`, () => {
    const wf = load(dir, file, origin);
    const english = WorkflowInputs.localized({ ...wf, origin: 'custom' });
    const keyOf = (s) => s.display_key || (origin === 'default' ? `workflow_texts.${snake(file)}_step_${snake(s.id)}` : null);
    I18n.setLanguage('pt-BR');
    const shown = WorkflowInputs.localized(wf);
    const untranslated = wf.steps.filter((s, i) => {
      const en = english.steps[i].display || displayName(s.id);
      const pt = shown.steps[i].display || displayName(s.id);
      return pt === en && !(keyOf(s) && keyOf(s) in PT);
    }).map((s) => s.id);
    assert.deepEqual(untranslated, []);
  });
}

test('#41 English unchanged: feature\'s Run screen names "Red check (TDD)" and "Test writer"', () => {
  const wf = load('workflows', 'feature.yaml', 'default');
  const names = recorded(wf);
  assert.equal(displayName('test_writer', names.agents), 'Test writer');
  assert.equal(displayName('red_check', names.steps), 'Red check (TDD)');
});

test('#41 pt-BR: the hero workflow\'s step "Red check (TDD)" and the agent "Test writer" are not in English on the Run screen', () => {
  const wf = load(path.join('.craftorio', 'workflows'), 'ai-development-local-hero.yaml', 'repository');
  const names = recorded(wf);
  I18n.setLanguage('pt-BR');
  const step = WorkflowInputs.localized(wf).steps.find((s) => s.id === 'red_check');
  assert.ok(step, 'the hero workflow has a red_check step');
  assert.notEqual(step.display, 'Red check (TDD)');
  assert.notEqual(displayName('test_writer', names.agents), 'Test writer');
});

for (const lang of ['en', 'pt-BR']) {
  test(`#41 ${lang}: a run's input chips ${lang === 'en' ? 'read' : 'do not read'} "Mode: Local" and "Validation: Validated"`, () => {
    const wf = load('workflows', 'feature.yaml', 'default');
    I18n.setLanguage(lang);
    const html = WorkflowInputs.inputPills(wf, { mode: 'local', validation: 'validated' }, { defaults: true });
    const text = html.replace(/<[^>]*>/g, ' ');
    if (lang === 'en') { assert.match(text, /Mode: Local/); assert.match(text, /Validation: Validated/); }
    else { assert.doesNotMatch(text, /Mode: Local/); assert.doesNotMatch(text, /Validation: Validated/); }
  });
}
