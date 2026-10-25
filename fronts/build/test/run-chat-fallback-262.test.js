// #262: the run chat model (views/runchat/run-chat-model.js) turns an agent.fallback event into a
// fallback item and keeps a simulated turn's provider. Was a case of the kit's
// agent-overrides-internals-262 test; it lives with the screen it tests (#579).
const test = require('node:test');
const assert = require('node:assert/strict');

test('#262 the run chat model turns agent.fallback into a fallback item and keeps a simulated turn\'s provider', () => {
  const { RunChatModel } = require('../views/runchat/run-chat-model.js');
  const m = new RunChatModel();
  const session = { agent: 'writer', provider: 'mock', simulates: 'codex', model: 'gpt-6-luna' };
  for (const ev of [
    { seq: 1, type: 'workflow.started', workflow: 'w', inputs: {} },
    { seq: 2, type: 'step.started', step_id: 'write', agent: 'writer', visit: 1 },
    { seq: 3, type: 'agent.fallback', agent: 'writer', step_id: 'write', from: 'claude:claude-opus-5-5', to: 'codex:gpt-6-luna', reason: 'Claude AI usage limit reached|1' },
    { seq: 4, type: 'session.opened', session_id: 's2', session },
    { seq: 5, type: 'session.message_received', session_id: 's2', turn: 1, step_id: 'write', text: 'done', session },
  ]) m.apply(ev);
  const fallback = m.items.find((i) => i.kind === 'fallback');
  assert.deepEqual([fallback.agent, fallback.stepId, fallback.from, fallback.to], ['writer', 'write', 'claude:claude-opus-5-5', 'codex:gpt-6-luna']);
  const turn = m.items.find((i) => i.kind === 'turn');
  assert.deepEqual([turn.provider, turn.simulates, turn.model], ['mock', 'codex', 'gpt-6-luna']);
});
