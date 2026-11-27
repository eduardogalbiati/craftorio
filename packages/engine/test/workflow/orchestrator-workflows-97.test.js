// #97 (acceptance tests, written before the code): the bundled default workflows run on the orchestrator AI chosen
// in the Setup (settings.orchestratorProvider); a custom workflow keeps the providers it names.
//
// Contract assumed (packages/shared/orchestrator-models.js, new):
// - applyOrchestrator(wf, provider, { bundled }) -> the workflow to run, a new object (wf is not changed). For a
//   bundled default workflow (bundled: true) and provider 'codex': orchestrator.provider and every agent's provider
//   become 'codex' with its model mapped (mapModel; a templated model such as the developer's
//   "{{ inputs.developer_model or 'claude-opus-5-5' }}" renders to the mapped model with the inputs' defaults),
//   `providers` defines codex; the multi-model second reviewer, which must run on a provider other than the
//   orchestrator's, moves to claude. With 'claude', no provider, or a custom workflow (bundled: false), the workflow
//   is returned as it was.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow, render } = require('../../engine/workflow');

const WORKFLOWS = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const load = () => require('@craftorio/shared/orchestrator-models');
const read = (name) => loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));
const plain = (x) => JSON.parse(JSON.stringify(x));

// an agent's model as a run sees it with the inputs' defaults
function modelOf(wf, agent) {
  const m = wf.agents[agent].model;
  if (typeof m !== 'string' || !m.includes('{{')) return m;
  const inputs = Object.fromEntries(Object.entries(wf.inputs || {}).filter(([, d]) => d && d.default !== undefined).map(([k, d]) => [k, d.default]));
  return render(m, { inputs }).trim();
}

function assertOnCodex(wf, expected) {
  assert.equal(wf.orchestrator.provider, 'codex', 'orchestrator.provider');
  assert.equal(wf.orchestrator.model, 'gpt-6.1-terra', 'orchestrator.model');
  assert.ok(wf.providers && wf.providers.codex, 'providers defines codex');
  assert.deepEqual(Object.keys(wf.agents).sort(), Object.keys(expected).sort(), 'the same agents');
  for (const [agent, [provider, model]] of Object.entries(expected)) {
    assert.equal(wf.agents[agent].provider, provider, `${agent}.provider`);
    if (model) assert.equal(modelOf(wf, agent), model, `${agent}.model`);
  }
}

test('#97 fix with Codex as orchestrator: orchestrator and every agent on codex, Claude models mapped', () => {
  const out = load().applyOrchestrator(read('fix'), 'codex', { bundled: true });
  assertOnCodex(out, {
    developer: ['codex', 'gpt-6.2-sol'],
    reviewer: ['codex', 'gpt-6.2-sol'],
    verifier: ['codex', 'gpt-6.1-terra'],
    ci_pusher: ['codex', 'gpt-6.1-terra'],
  });
});

test('#97 release with Codex as orchestrator: orchestrator and every agent on codex, Claude models mapped', () => {
  const out = load().applyOrchestrator(read('release'), 'codex', { bundled: true });
  assertOnCodex(out, {
    developer: ['codex', 'gpt-6.2-sol'],
    reviewer: ['codex', 'gpt-6.1-terra'],
    ci_pusher: ['codex', 'gpt-6.1-terra'],
  });
});

test('#97 feature with Codex as orchestrator: every agent on codex (the developer\'s templated model too), the second reviewer on claude', () => {
  const out = load().applyOrchestrator(read('feature'), 'codex', { bundled: true });
  assertOnCodex(out, {
    developer: ['codex', 'gpt-6.2-sol'],
    reviewer: ['codex', 'gpt-6.2-astra'],
    second_reviewer: ['claude', null],
    ci_pusher: ['codex', 'gpt-6.1-terra'],
    ui_reviewer: ['codex', 'gpt-6.1-terra'],
    test_writer: ['codex', 'gpt-6.2-sol'],
    mapper: ['codex', 'gpt-6.2-sol'],
    builder: ['codex', 'gpt-6.1-terra'],
    verifier: ['codex', 'gpt-6.1-terra'],
    evidence: ['codex', 'gpt-6.1-terra'],
    healer: ['codex', 'gpt-6.1-terra'],
  });
  assert.equal(String(out.agents.second_reviewer.model).startsWith('claude-'), true, `second_reviewer.model ${out.agents.second_reviewer.model}`);
});

test('#97 a bundled workflow with Claude Code as orchestrator, or none chosen, stays as it is today', () => {
  const { applyOrchestrator } = load();
  for (const name of ['fix', 'release', 'feature']) {
    const before = plain(read(name));
    assert.deepEqual(plain(applyOrchestrator(read(name), 'claude', { bundled: true })), before, `${name} with claude`);
    assert.deepEqual(plain(applyOrchestrator(read(name), undefined, { bundled: true })), before, `${name} with no setting`);
  }
});

test('#97 a custom workflow naming its providers keeps them with Codex as orchestrator', () => {
  const custom = {
    metadata: { name: 'my-flow' },
    providers: { claude: { type: 'claude-code', command: 'claude' } },
    orchestrator: { provider: 'claude', model: 'claude-sonnet-5-5' },
    agents: { writer: { provider: 'claude', model: 'claude-opus-5-5' } },
    steps: [{ id: 'write', agent: 'writer', prompt: 'x' }],
  };
  const before = plain(custom);
  const out = load().applyOrchestrator(custom, 'codex', { bundled: false });
  assert.deepEqual(plain(out), before);
  assert.deepEqual(plain(custom), before, 'the workflow given is not changed');
});
