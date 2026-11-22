// #262 (acceptance tests, written before the code): fallback chains when a provider runs out of
// credits. A workflow (per agent, or in `defaults`) and Settings (per provider) declare an ordered
// list of "provider:model" entries; a turn that fails with a quota / credit / usage-limit error is
// retried on the next entry (a fresh session), recorded as an `agent.fallback` event, and the agent
// keeps that choice for the rest of the run. Other errors keep today's retries (no fallback); with no
// entry left the run fails with the provider's message; a fallback never skips a step or a gate.
//
// Interface assumed (the issue leaves the names open):
// - YAML: `fallbacks: ["<provider>:<model>", ...]` on an agent or in `defaults` (the agent's wins);
//   <provider> is a key of the workflow's `providers`. loadWorkflow refuses an entry that is not
//   "<provider>:<model>" with a message naming `fallbacks`.
// - WorkflowRun option `fallbacks: { <provider>: ["<provider>:<model>", ...] }`: Settings'
//   `providers.<name>.fallbacks`, used for an agent whose workflow declares none.
// - Mock provider: `mockSequences.usage_limits: ["<provider>" | "<provider>:<model>", ...]`: every
//   turn on a listed provider (any model) or provider:model fails with that provider type's real
//   usage-limit message (codex-cli: "You've hit your usage limit. Upgrade to Plus to continue using
//   Codex ..."). The provider is the agent's own (`claude`, `codex`, ...), not `mock`.
// - Event `agent.fallback`: { agent, step_id, from: "<provider>:<model>", to: "<provider>:<model>",
//   reason: <the provider's error message> }.
// - `isQuotaError(type, message)` exported by packages/engine/engine/providers.js, `type` a provider type
//   (claude-code | codex-cli | grok-cli): true for that CLI's quota / credit / usage-limit errors.
// - packages/engine/domains/workspace/notifications.js runNotice(ev) for an `agent.fallback` event: a `run` notice, event `fallback`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const PROVIDERS = `providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "{{ model }}"]
    resume_args: ["--resume", "{{ session_id }}"]
  codex:
    type: codex-cli
    command: codex
    args: ["exec", "--json", "--skip-git-repo-check", "-m", "{{ model }}"]
    resume_args: ["resume", "{{ session_id }}"]
    stdin_arg: "-"
  grok:
    type: grok-cli
    command: grok
    args: ["--output-format", "streaming-json", "-m", "{{ model }}"]
    resume_args: ["--resume", "{{ session_id }}"]
    prompt_file_arg: ["--prompt-file", "{{ prompt_file }}"]
`;

// the writer has its own chain; the reviewer runs on another model, with none
const AGENT_CHAIN = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-fallbacks-262 }
${PROVIDERS}
agents:
  writer:
    provider: claude
    model: claude-opus-5-5
    session: persistent
    fallbacks: ["codex:gpt-6-luna"]
    retry: { max_attempts: 2 }
  reviewer: { provider: claude, model: claude-sonnet-5, session: ephemeral }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
  - id: review
    agent: reviewer
    prompt: "Review the document."
`;

// the chain comes from `defaults`; the writer works before and after a human gate
const GATED = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-fallbacks-gate-262 }
${PROVIDERS}
defaults:
  fallbacks: ["codex:gpt-6-luna"]
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: persistent }
steps:
  - id: draft
    agent: writer
    prompt: "Write a draft."
  - id: approve
    type: human_approval
    message: "Accept the draft?"
  - id: revise
    agent: writer
    prompt: "Revise the draft."
`;

// no chain in the workflow: only Settings' (the `fallbacks` option) can give one
const NO_CHAIN = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-no-chain-262 }
${PROVIDERS}
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`;

async function runFixture(t, yamlText, options = {}) {
  const { WorkflowRun } = require('../engine/workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallbacks-262-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yamlText);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') || {} };
}

const fallbacksOf = (events) => events.filter((e) => e.type === 'agent.fallback');
// the model of the session that answered each turn of a step, in order
const answeredModels = (events, step) => events.filter((e) => e.type === 'session.message_received' && e.step_id === step).map((e) => e.session?.model);

test('#262 isQuotaError: the quota, credit and usage-limit messages of Claude, Codex and Grok are recognized', () => {
  const { isQuotaError } = require('../engine/providers');
  assert.equal(typeof isQuotaError, 'function');
  const quota = [
    ['claude-code', 'Claude AI usage limit reached|1760227200'],
    ['claude-code', 'Credit balance is too low'],
    ['codex-cli', "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again at 3:15 PM."],
    ['codex-cli', 'Quota exceeded. Check your plan and billing details.'],
    ['grok-cli', 'Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.'],
  ];
  const other = [
    ['claude-code', 'Timed out after 1800s'],
    ['claude-code', 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}'],
    ['codex-cli', 'invalid_request: the model gpt-x does not exist'],
    ['grok-cli', 'Process exited with code 1'],
  ];
  const wrong = [...quota.filter(([type, m]) => isQuotaError(type, m) !== true), ...other.filter(([type, m]) => isQuotaError(type, m) !== false)];
  assert.equal(wrong.map(([type, m]) => `${type}: ${m}`).join('\n'), '');
});

test('#262 a usage-limit error falls back to the next entry: agent.fallback with from/to/reason, a fresh session, the run finishes', async (t) => {
  const { isQuotaError } = require('../engine/providers');
  const { events, finished } = await runFixture(t, AGENT_CHAIN, { mockSequences: { usage_limits: ['claude:claude-opus-5-5'] } });
  assert.equal(finished.status, 'success', finished.error);
  const [fb, ...more] = fallbacksOf(events);
  assert.equal(more.length, 0, 'one fallback');
  assert.equal(fb?.agent, 'writer');
  assert.equal(fb?.step_id, 'write');
  assert.equal(fb?.from, 'claude:claude-opus-5-5');
  assert.equal(fb?.to, 'codex:gpt-6-luna');
  assert.equal(isQuotaError('claude-code', String(fb?.reason || '')), true, `the reason is Claude's own message: ${fb?.reason}`);
  assert.deepEqual(answeredModels(events, 'write'), ['gpt-6-luna']);
  const sent = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'write').map((e) => e.session_id);
  assert.equal(new Set(sent).size, 2, 'the fallback turn runs in a new session');
  assert.deepEqual(answeredModels(events, 'review'), ['claude-sonnet-5'], 'an agent on another model keeps it');
});

test('#262 the fallback is kept for the rest of the run: the agent\'s later turns go straight to it', async (t) => {
  const { events, finished } = await runFixture(t, GATED, { mockSequences: { usage_limits: ['claude:claude-opus-5-5'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(fallbacksOf(events).length, 1);
  assert.deepEqual(answeredModels(events, 'draft'), ['gpt-6-luna']);
  assert.deepEqual(answeredModels(events, 'revise'), ['gpt-6-luna']);
  const revise = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'revise');
  assert.equal(revise.length, 1, 'no attempt on the exhausted model first');
});

test('#262 a fallback never skips a gate: the human gate after the fallen-back step is still asked', async (t) => {
  const { events, finished } = await runFixture(t, GATED, { mockSequences: { usage_limits: ['claude'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(fallbacksOf(events).map((e) => e.step_id), ['draft'], 'the draft fell back');
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve').length, 1);
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  assert.deepEqual(started, ['draft', 'approve', 'revise']);
});

// Guards today's behaviour next to a declared chain: green before the change, it must stay green.
test('#262 a non-quota error (a timeout) keeps today\'s retry on the same model and never falls back', async (t) => {
  const { events, finished } = await runFixture(t, AGENT_CHAIN, { mockSequences: { timeouts: { write: 1 } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(fallbacksOf(events).length, 0);
  assert.deepEqual(answeredModels(events, 'write'), ['claude-opus-5-5']);
});

test('#262 with no fallback left the run fails with the provider\'s message', async (t) => {
  const { events, finished } = await runFixture(t, AGENT_CHAIN, { mockSequences: { usage_limits: ['claude', 'codex'] } });
  assert.equal(finished.status, 'failed');
  assert.match(String(finished.error), /You've hit your usage limit/);
  assert.deepEqual(fallbacksOf(events).map((e) => `${e.from}>${e.to}`), ['claude:claude-opus-5-5>codex:gpt-6-luna']);
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'review'), false, 'the next step never ran');
});

test('#262 Settings\' per-provider chain (the `fallbacks` option) applies to an agent whose workflow declares none', async (t) => {
  const { events, finished } = await runFixture(t, NO_CHAIN, {
    fallbacks: { claude: ['grok:grok-5'] },
    mockSequences: { usage_limits: ['claude'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(fallbacksOf(events).map((e) => `${e.from}>${e.to}`), ['claude:claude-opus-5-5>grok:grok-5']);
  assert.deepEqual(answeredModels(events, 'write'), ['grok-5']);
});

test('#262 loadWorkflow refuses a fallback entry that is not "<provider>:<model>"', (t) => {
  const { loadWorkflow } = require('../engine/workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallbacks-262-load-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, AGENT_CHAIN.replace('fallbacks: ["codex:gpt-6-luna"]', 'fallbacks: ["gpt-6-luna"]'));
  assert.throws(() => loadWorkflow(file), /fallbacks/);
});

test('#262 a fallback notifies the owner: runNotice of agent.fallback names the agent, from, to and the reason', () => {
  const { runNotice } = require('../domains/workspace/notifications');
  const n = runNotice({
    type: 'agent.fallback', run_id: '20261012-120000-abcd', agent: 'writer', step_id: 'write',
    from: 'claude:claude-opus-5-5', to: 'codex:gpt-6-luna', reason: 'Claude AI usage limit reached|1760227200',
  }, { workflow: 'writer-reviewer', project: 'demo' });
  assert.ok(n, 'a notice');
  assert.equal(n.kind, 'run');
  assert.equal(n.event, 'fallback');
  assert.equal(n.target.runId, '20261012-120000-abcd');
  assert.match(n.title, /writer-reviewer/);
  const text = `${n.title}\n${n.body}`;
  for (const part of ['writer', 'claude:claude-opus-5-5', 'codex:gpt-6-luna', 'usage limit']) assert.ok(text.includes(part), `the notice names ${part}: ${text}`);
});
