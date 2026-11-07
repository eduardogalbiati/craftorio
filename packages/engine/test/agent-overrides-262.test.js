// #262 (acceptance tests, written before the code): choose any agent's provider, model and effort
// for one run, and limits that follow the model.
//
// Interface assumed (the issue leaves the names open):
// - WorkflowRun option `agentOverrides: { <agent>: { provider?, model?, effort? } }` (the Start
//   drawer / Assign dialog / roadmap item Edit "Agents" section; run:start's `agentOverrides`). The
//   workflow's values are the defaults; a change applies to that run only.
// - workflow.started gains `agents: { <agent>: { provider, model, effort } }`: what each agent runs on
//   in this run, overrides applied.
// - YAML: a top-level `models: { <model id>: { timeout_factor?, max_total_cost_usd? } }` (and the
//   WorkflowRun option `models`, Settings' `models`, same shape): the turn timeout of an agent on that
//   model is multiplied by timeout_factor (session.message_sent.timeout_ms, turnTimeout(agent)); the
//   run's cost limit is the largest max_total_cost_usd among orchestrator.limits and the models its
//   agents run on.
// - ai-development-local-hero: the developer's model is chosen through the override (its
//   `developer_model` input may stay or go); a Fable 5.1 developer still gets a longer turn timeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const HERO = path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml');

const PROVIDERS = `providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "{{ model }}"]
    effort_args: ["--effort", "{{ effort }}"]
  codex:
    type: codex-cli
    command: codex
    args: ["exec", "--json", "--skip-git-repo-check", "-m", "{{ model }}"]
    effort_args: ["-c", "model_reasoning_effort={{ effort }}"]
    stdin_arg: "-"
`;

const TWO_AGENTS = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-overrides-262 }
${PROVIDERS}
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
  reviewer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
  - id: review
    agent: reviewer
    prompt: "Review the document."
`;

function writeWorkflow(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-262-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  return { dir, file };
}

async function runFile(file, dir, options = {}) {
  const { WorkflowRun } = require('../engine/workflow');
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') || {} };
}

const started = (events) => events.find((e) => e.type === 'workflow.started') || {};
const answered = (events, step) => events.filter((e) => e.type === 'session.message_received' && e.step_id === step).map((e) => e.session);
const timeoutsOf = (events, step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.timeout_ms);

test('#262 an agent override (provider, model, effort) is recorded in workflow.started agents and answers that agent\'s turn', async (t) => {
  const { dir, file } = writeWorkflow(t, TWO_AGENTS);
  const { run, events, finished } = await runFile(file, dir, { agentOverrides: { writer: { provider: 'codex', model: 'gpt-6-luna', effort: 'high' } } });
  assert.equal(finished.status, 'success', finished.error);
  const agents = started(events).agents || {};
  const pick = (a) => ({ provider: a?.provider, model: a?.model, effort: a?.effort || null });
  assert.deepEqual(pick(agents.writer), { provider: 'codex', model: 'gpt-6-luna', effort: 'high' });
  assert.deepEqual(pick(agents.reviewer), { provider: 'claude', model: 'claude-opus-5-5', effort: null });
  assert.equal(run.wf.agents.writer.provider, 'codex');
  const [writer] = answered(events, 'write');
  assert.equal(writer?.model, 'gpt-6-luna');
  assert.equal(writer?.effort, 'high');
  assert.equal(answered(events, 'review')[0]?.model, 'claude-opus-5-5');
});

test('#262 an override applies to its run only: the workflow file is unchanged and the next run uses the workflow\'s values', async (t) => {
  const { dir, file } = writeWorkflow(t, TWO_AGENTS);
  await runFile(file, dir, { agentOverrides: { writer: { model: 'claude-fable-5-1' } } });
  assert.equal(fs.readFileSync(file, 'utf8'), TWO_AGENTS);
  const { events, finished } = await runFile(file, dir);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(started(events).agents?.writer?.model, 'claude-opus-5-5');
  assert.equal(answered(events, 'write')[0]?.model, 'claude-opus-5-5');
});

test('#262 an override of an agent the workflow does not have is refused before the run starts', (t) => {
  const { WorkflowRun } = require('../engine/workflow');
  const { dir, file } = writeWorkflow(t, TWO_AGENTS);
  assert.throws(
    () => new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], agentOverrides: { ghost: { model: 'gpt-6-luna' } } }),
    /ghost/,
  );
});

test('#262 a model\'s timeout_factor (workflow `models`) scales the turn timeout of the agent on that model only', async (t) => {
  const { dir, file } = writeWorkflow(t, `${TWO_AGENTS}models:\n  claude-fable-5-1: { timeout_factor: 1.5 }\n`);
  const { finished, events } = await runFile(file, dir, { agentOverrides: { writer: { model: 'claude-fable-5-1' } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(timeoutsOf(events, 'write'), [900000]);
  assert.deepEqual(timeoutsOf(events, 'review'), [600000]);
});

test('#262 a model\'s limits from Settings (the `models` option) apply the same way', async (t) => {
  const { dir, file } = writeWorkflow(t, TWO_AGENTS);
  const { finished, events } = await runFile(file, dir, {
    agentOverrides: { reviewer: { provider: 'codex', model: 'gpt-6-luna' } },
    models: { 'gpt-6-luna': { timeout_factor: 2 } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(timeoutsOf(events, 'write'), [600000]);
  assert.deepEqual(timeoutsOf(events, 'review'), [1200000]);
});

test('#262 the run cost limit follows the model: a model\'s max_total_cost_usd lifts the workflow\'s limit when an agent runs on it', async (t) => {
  const limited = TWO_AGENTS.replace('agents:\n', 'orchestrator:\n  limits: { max_total_cost_usd: 0.0001 }\nagents:\n');
  const { dir, file } = writeWorkflow(t, `${limited}models:\n  claude-fable-5-1: { max_total_cost_usd: 1000 }\n`);
  const plain = await runFile(file, dir);
  assert.equal(plain.finished.status, 'failed');
  assert.match(String(plain.finished.error), /Maximum cost exceeded/);
  const fable = await runFile(file, dir, { agentOverrides: { writer: { model: 'claude-fable-5-1' } } });
  assert.equal(fable.finished.status, 'success', fable.finished.error);
});

test('#262 ai-development-local-hero: the developer\'s model comes from an override (Fable 5.1) with a longer turn timeout; the reviewer keeps its own model (Fable 5.1)', (t) => {
  const { WorkflowRun } = require('../engine/workflow');
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-262-hero-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const make = (agentOverrides) => new WorkflowRun({ file: HERO, inputs: { task: 'Add the feature', repo_path: runsDir }, mock: true, runsDir, agentOverrides });
  const devTimeout = (r) => r.turnTimeout({ ...(r.wf.defaults || {}), ...r.wf.agents.developer });
  const opus = make(undefined);
  assert.equal(opus.wf.agents.developer.model, 'claude-opus-5-5');
  assert.equal(devTimeout(opus), 30 * 60e3);
  const fable = make({ developer: { model: 'claude-fable-5-1' } });
  assert.equal(fable.wf.agents.developer.model, 'claude-fable-5-1');
  assert.equal(fable.wf.agents.reviewer.model, 'claude-fable-5-1');
  assert.ok(devTimeout(fable) > 30 * 60e3, `a Fable 5.1 developer gets more than 30m per turn, got ${devTimeout(fable) / 60e3}m`);
});
