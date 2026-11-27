// #97 (acceptance tests, written before the code): the default workflows follow the orchestrator AI chosen in the
// Setup (settings.orchestratorProvider), with one mapping from Claude models to Codex models, in one place.
//
// Contract assumed (packages/shared/orchestrator-models.js, new; browser global + module.exports like setup-model.js):
// - CODEX_MODEL_FOR: { <claude model id>: <codex model id> } for the four Claude models the bundled workflows use;
// - mapModel(model, provider): the model an agent runs on with that orchestrator provider: the Codex model for a
//   Claude model when provider is 'codex', the model unchanged for 'claude' (or no provider); a model the mapping
//   does not know is left as it is.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../orchestrator-models');

const EXPECTED = {
  'claude-fable-5-2': 'gpt-6.2-astra',
  'claude-opus-5-5': 'gpt-6.2-sol',
  'claude-sonnet-5-5': 'gpt-6.1-terra',
  'claude-haiku-5-5': 'gpt-6-luna',
};

test('#97 CODEX_MODEL_FOR maps each Claude model of the bundled workflows to its Codex model', () => {
  const { CODEX_MODEL_FOR } = load();
  assert.deepEqual({ ...CODEX_MODEL_FOR }, EXPECTED);
});

test('#97 mapModel with codex gives the mapped Codex model', () => {
  const { mapModel } = load();
  assert.equal(mapModel('claude-fable-5-2', 'codex'), 'gpt-6.2-astra');
  assert.equal(mapModel('claude-opus-5-5', 'codex'), 'gpt-6.2-sol');
  assert.equal(mapModel('claude-sonnet-5-5', 'codex'), 'gpt-6.1-terra');
  assert.equal(mapModel('claude-haiku-5-5', 'codex'), 'gpt-6-luna');
});

test('#97 mapModel with claude, or no provider, returns the model unchanged; an unknown model is kept', () => {
  const { mapModel } = load();
  assert.equal(mapModel('claude-opus-5-5', 'claude'), 'claude-opus-5-5');
  assert.equal(mapModel('claude-fable-5-2', undefined), 'claude-fable-5-2');
  assert.equal(mapModel('gpt-6-luna', 'codex'), 'gpt-6-luna');
});
