// #111 (review round 1): SetupModel.codexModelsWarning(tool) (packages/shared/setup-model.js), the Codex card's
// warning in the Setup and Settings › Agents & CLIs: { text, usable } in the interface language, or null.
// - a partial fallback (a mapped model with no offered model of its tier or below: an account listing only
//   gpt-6.2-sol has nothing for Terra and Luna) is not usable and names the models left without a substitute;
// - every mapped model with a fallback is usable and names the model used instead;
// - another CLI, no known list or the full list: null.
const test = require('node:test');
const assert = require('node:assert/strict');

const i18n = () => require('../i18n.js');
const load = () => require('../setup-model');
const codex = (models) => ({ id: 'codex', name: 'Codex CLI', path: '/usr/bin/codex', connected: true, models });

test.afterEach(() => { i18n().setLanguage('en'); });

test('#111 codexModelsWarning: an account listing only gpt-6.2-sol is not usable and names gpt-6.1-terra and gpt-6-luna', () => {
  i18n().setLanguage('en');
  const w = load().codexModelsWarning(codex(['gpt-6.2-sol']));
  assert.equal(w?.usable, false);
  assert.ok(w.text.includes('gpt-6.1-terra') && w.text.includes('gpt-6-luna'), `the models without a substitute: ${w.text}`);
  assert.ok(/orchestrator/i.test(w.text), `says Codex cannot be the orchestrator: ${w.text}`);
});

test('#111 codexModelsWarning: the partial-fallback text follows the interface language', () => {
  i18n().setLanguage('en');
  const en = load().codexModelsWarning(codex(['gpt-6.2-sol'])).text;
  i18n().setLanguage('pt-BR');
  const pt = load().codexModelsWarning(codex(['gpt-6.2-sol']));
  assert.equal(pt.usable, false);
  assert.notEqual(pt.text, en);
  assert.ok(pt.text.includes('gpt-6.1-terra') && pt.text.includes('gpt-6-luna'), pt.text);
});

test('#111 codexModelsWarning: a fallback for every mapped model is usable and names gpt-6-luna', () => {
  const w = load().codexModelsWarning(codex(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve']));
  assert.equal(w?.usable, true);
  assert.ok(w.text.includes('gpt-6-luna'), w.text);
});

test('#111 codexModelsWarning: no usable model at all is not usable', () => {
  assert.equal(load().codexModelsWarning(codex(['gpt-reserve', 'codex-auto-review']))?.usable, false);
});

test('#111 codexModelsWarning: null for the full list, no known list, an empty list or another CLI', () => {
  const { codexModelsWarning } = load();
  assert.equal(codexModelsWarning(codex(['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'])), null);
  assert.equal(codexModelsWarning(codex(undefined)), null);
  assert.equal(codexModelsWarning(codex([])), null);
  assert.equal(codexModelsWarning({ id: 'claude', path: '/usr/bin/claude', connected: true, models: ['gpt-reserve'] }), null);
});
