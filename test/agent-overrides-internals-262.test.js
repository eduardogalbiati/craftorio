// #262 internals (the developer's own tests, next to the acceptance tests of agent-overrides-262 and
// agent-fallbacks-262): what a resume keeps, the fallback session's record, the run chat's fallback
// item, Settings' `models` validation and the workflow list's `runs_on`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-internals-262 }
inputs:
  writer_model: { type: string, default: claude-opus-5-5 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p", "--model", "{{ model }}"] }
  codex: { type: codex-cli, command: codex, args: ["exec", "-m", "{{ model }}"] }
agents:
  writer:
    provider: claude
    model: "{{ inputs.writer_model }}"
    session: persistent
  reviewer: { provider: claude, model: claude-sonnet-5, effort: high, session: ephemeral, fallbacks: ["codex:gpt-6-luna"] }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
  - id: review
    agent: reviewer
    prompt: "Review the document."
`;

// Settings' chain of claude: an entry on a provider this workflow lacks, then codex
const SETTINGS_CHAIN = { claude: ['ghost:model-x', 'codex:gpt-6-luna'] };

function fixture(t, text = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'internals-262-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  return { dir, file };
}

async function runRecorded(t, options) {
  const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
  const { Recorder } = require('@multiagent/engine/engine/recorder');
  const { dir, file } = fixture(t);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => { rec.write(ev); events.push(ev); });
  await run.start();
  return { run, events };
}

test('#262 a fallback skips an entry whose provider the workflow does not define (a warning), and its session records fallback_from', async (t) => {
  const { run, events } = await runRecorded(t, { fallbacks: SETTINGS_CHAIN, mockSequences: { usage_limits: ['claude:claude-opus-5-5'] } });
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
  assert.ok(events.some((e) => e.type === 'log' && /fallback "ghost:model-x" skipped/.test(e.message)));
  const turn = events.find((e) => e.type === 'session.message_received' && e.step_id === 'write');
  assert.equal(turn.session.simulates, 'codex');
  assert.equal(turn.session.fallback_from.from, 'claude:claude-opus-5-5');
  assert.match(turn.session.fallback_from.reason, /usage limit/);
  assert.deepEqual(run.ctx.agents.writer, { provider: 'codex', model: 'gpt-6-luna' });
  // the usage limit is not retried on the same model: one attempt, then the fallback
  assert.equal(events.filter((e) => e.type === 'log' && e.kind === 'usage_limit').length, 1);
});

test('#262 resumeSpec: a resumed run gets the run\'s overrides, then the fallbacks its agents took', async (t) => {
  const { resumeSpec } = require('@multiagent/engine/domains/supervisor/supervisor');
  const { run } = await runRecorded(t, {
    agentOverrides: { reviewer: { effort: '' } },
    fallbacks: SETTINGS_CHAIN, mockSequences: { usage_limits: ['claude:claude-opus-5-5'] },
  });
  const spec = resumeSpec(run.runDir, 'review');
  assert.deepEqual(spec.agentOverrides, { reviewer: { effort: '' }, writer: { provider: 'codex', model: 'gpt-6-luna' } });
});

test('#262 an override equal to the workflow\'s value is no override; workflow.started records only what differs', async (t) => {
  const { events } = await runRecorded(t, { agentOverrides: { reviewer: { provider: 'claude', model: 'claude-sonnet-5', effort: 'low' } } });
  const started = events.find((e) => e.type === 'workflow.started');
  assert.deepEqual(started.agent_overrides, { reviewer: { effort: 'low' } });
  assert.deepEqual(started.agents.writer, { provider: 'claude', model: 'claude-opus-5-5', effort: null });
});

test('#262 an override to a provider the workflow does not define is refused', (t) => {
  const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
  const { dir, file } = fixture(t);
  assert.throws(() => new WorkflowRun({ file, inputs: {}, mock: true, runsDir: dir, agentOverrides: { writer: { provider: 'grok' } } }), /provider "grok"/);
});

test('#262 Settings\' models are validated like the workflow\'s: an unknown limit or a non-positive number is refused', (t) => {
  const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
  const { dir, file } = fixture(t);
  const make = (models) => new WorkflowRun({ file, inputs: {}, mock: true, runsDir: dir, models });
  assert.throws(() => make({ 'gpt-6-luna': { speed: 2 } }), /unknown limit "speed"/);
  assert.throws(() => make({ 'gpt-6-luna': { timeout_factor: 0 } }), /positive number/);
  assert.doesNotThrow(() => make({ 'gpt-6-luna': { timeout_factor: 1.5, max_total_cost_usd: 50 } }));
});

test('#262 the run chat model turns agent.fallback into a fallback item and keeps a simulated turn\'s provider', () => {
  const { RunChatModel } = require('../src/renderer/views/runchat/run-chat-model.js');
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

test('#262 listWorkflows: each agent\'s runs_on resolves its templates with the inputs\' defaults; the workflow lists its providers', (t) => {
  const { makeService } = require('@multiagent/engine/test/service/helpers');
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-internals-262.yaml'), FIXTURE);
  const wf = api['workflows:list']().find((w) => w.file === 'fixture-internals-262.yaml');
  assert.deepEqual(wf.agents.writer.runs_on, { provider: 'claude', model: 'claude-opus-5-5', effort: '' });
  assert.equal(wf.agents.writer.fallbacks, undefined);
  assert.deepEqual(wf.agents.reviewer.fallbacks, ['codex:gpt-6-luna']);
  assert.deepEqual(wf.agents.reviewer.runs_on, { provider: 'claude', model: 'claude-sonnet-5', effort: 'high' });
  assert.deepEqual(wf.providers, { claude: 'claude-code', codex: 'codex-cli' });
});

// ---- review findings (#262): overrides that must be refused, Settings chains, limits after a fallback ----

const newRun = (t, options) => {
  const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
  const { dir, file } = fixture(t);
  return new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
};

// whatever a failing test leaves on Object / Object.prototype is removed, so it cannot leak into the next tests
function cleanPrototypes(t) {
  t.after(() => {
    for (const k of ['provider', 'model', 'effort']) { delete Object.prototype[k]; delete Object[k]; }
  });
}

test('#262 an override keyed "__proto__" is refused and leaves Object.prototype untouched', (t) => {
  cleanPrototypes(t);
  // JSON.parse keeps "__proto__" as an own key, as an IPC payload or a saved roadmap item would
  const agentOverrides = JSON.parse('{"__proto__":{"provider":"codex","model":"gpt-6-luna"}}');
  assert.throws(() => newRun(t, { agentOverrides }), /__proto__/);
  assert.equal(({}).model, undefined);
  assert.equal(({}).provider, undefined);
});

test('#262 an override keyed "constructor" is refused and leaves Object untouched', (t) => {
  cleanPrototypes(t);
  assert.throws(() => newRun(t, { agentOverrides: { constructor: { model: 'gpt-6-luna' } } }), /constructor/);
  assert.equal(Object.model, undefined);
});

test('#262 an override whose model is only whitespace is refused instead of running the agent with no model', (t) => {
  assert.throws(() => newRun(t, { agentOverrides: { reviewer: { model: '   ' } } }), /reviewer/);
});

test('#262 a malformed Settings fallback entry (no provider:model) is skipped with a warning in the run log', async (t) => {
  const { events } = await runRecorded(t, { fallbacks: { claude: ['gpt-6-luna', 'codex:gpt-6-luna'] }, mockSequences: { usage_limits: ['claude:claude-opus-5-5'] } });
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
  assert.equal(events.filter((e) => e.type === 'agent.fallback' && e.agent === 'writer').map((e) => e.to).join(), 'codex:gpt-6-luna');
  const warned = events.filter((e) => e.type === 'log' && e.level === 'warn' && /"gpt-6-luna"/.test(e.message || ''));
  assert.equal(warned.length >= 1, true, 'a warning names the malformed entry');
});

test('#262 an agent whose model is a template over an input runs on the input\'s value when no override is sent', async (t) => {
  const { events } = await runRecorded(t, { inputs: { writer_model: 'claude-fable-5-1' }, agentOverrides: {} });
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
  const started = events.find((e) => e.type === 'workflow.started');
  assert.equal(started.agents.writer.model, 'claude-fable-5-1');
  assert.equal(started.agent_overrides, undefined);
  assert.equal(events.find((e) => e.type === 'session.message_received' && e.step_id === 'write').session.model, 'claude-fable-5-1');
});

test('#262 after a fallback the turn timeout follows the new model\'s timeout_factor, not the old one\'s', async (t) => {
  const { events } = await runRecorded(t, {
    fallbacks: { claude: ['codex:gpt-6-luna'] },
    models: { 'claude-opus-5-5': { timeout_factor: 1.5 } },
    mockSequences: { usage_limits: ['claude:claude-opus-5-5'] },
  });
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'success');
  const timeouts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'write').map((e) => e.timeout_ms);
  // 30m default: 45m on claude-opus-5-5 (x1.5), then 30m on gpt-6-luna (no factor)
  assert.deepEqual(timeouts, [2700000, 1800000]);
});
