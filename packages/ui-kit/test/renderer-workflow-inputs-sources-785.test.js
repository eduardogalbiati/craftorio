// #785: a form says where each value comes from. WorkflowInputs.formHtml takes `sources`, the map
// resolveRunInputs gives ({ key: 'typed' | 'roadmap' | 'project' | 'workflow' }), and draws each field's
// source in [data-testid="workflow-input-source-<key>"]: "neste item", "do projeto", "do workflow".
// Acceptance tests written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@multiagent/shared/i18n');
const WorkflowInputs = require('../workflow-inputs');

const DEFS = { mode: { label: 'Mode', enum: ['local', 'fork'], default: 'local' } };
const sourceText = (html) => {
  const m = /<[^>]*data-testid="workflow-input-source-mode"[^>]*>([^<]*)</.exec(html);
  return m ? m[1].trim() : null;
};
const inPortuguese = (t) => { I18n.setLanguage('pt-BR'); t.after(() => I18n.setLanguage('en')); };
const form = (source) => WorkflowInputs.formHtml(DEFS, { values: { mode: 'fork' }, sources: { mode: source } });

test('#785 a value from the project reads "do projeto"', (t) => {
  inPortuguese(t);
  assert.equal(sourceText(form('project')), 'do projeto');
});

test('#785 a value from the workflow reads "do workflow"', (t) => {
  inPortuguese(t);
  assert.equal(sourceText(form('workflow')), 'do workflow');
});

test('#785 a value saved on the item reads "neste item"', (t) => {
  inPortuguese(t);
  assert.equal(sourceText(form('roadmap')), 'neste item');
});

test('#785 a form without sources draws no source label', () => {
  assert.equal(WorkflowInputs.formHtml(DEFS, { values: { mode: 'fork' } }).includes('workflow-input-source-'), false);
});
