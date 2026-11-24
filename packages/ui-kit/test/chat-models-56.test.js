// #56: window.ChatModels.modelsWith (packages/ui-kit/chat-models.js), the models a picker offers when
// one is already saved. Internal details of the AI Arena's and the Builder's model pickers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const chatModels = (expression) => JSON.parse(loadApp().run(`JSON.stringify(ChatModels.${expression})`));

test('#56 a saved model that is no longer offered is added after the offered ones', () => {
  assert.deepEqual(chatModels("modelsWith('claude-code', 'claude-fable-5-1')"), [...chatModels("models('claude-code')"), 'claude-fable-5-1']);
});

test('#56 a saved model that is offered is not repeated, and no saved model adds nothing', () => {
  const offered = chatModels("models('claude-code')");
  assert.deepEqual(chatModels(`modelsWith('claude-code', '${offered[0]}')`), offered);
  assert.deepEqual(chatModels("modelsWith('claude-code', '')"), offered);
});

test('#56 an unknown provider offers only the saved model', () => {
  assert.deepEqual(chatModels("modelsWith('gone-cli', 'old-model')"), ['old-model']);
});
