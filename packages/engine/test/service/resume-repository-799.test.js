// #799: resuming a run that a weekly provider limit stopped. Through the service's channels:
// a run of a workflow only the repository declares resumes with no workspace copy (workflow.started
// records the file's basename, so ctx.workflowPath never finds it); with no step a failed or cancelled
// run resumes where it stopped, never silently at the first step; a provider limit is named by
// runs:resumeOptions, with what each agent's next turn re-reads; and the owner may change the
// developer's model and effort for the resumed run (`inputs`, merged over the recorded ones).
//
// Acceptance tests written before the code. Interface the developer provides:
// - runs:resume takes `inputs` (an object, the keys that change), last in the channel's params.
// - runs:resumeOptions adds `inputs`, `inputDefs` and `turns`, and `limit` also names a provider limit.
//
// Failed runs are real simulations where the mock can do it (mockSequences.usage_limits: the turn of an
// agent on that provider:model throws the CLI's usage-limit message, and the run ends failed with no
// step.finished for that step). The weekly limit's own text is seeded: the mock cannot say it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, makeResumeService, roadmapIssue } = require('./helpers');
const { repoWithManifest, tempDir } = require('../repo-workflow-fixtures-485');

const WEEKLY = "You've hit your weekly limit";
const FABLE = 'claude-fable-5-1';
const OPUS = 'claude-opus-5-5';

const MODEL_INPUT = `  developer_model:
    label: "Developer model"
    type: string
    enum: [claude-opus-5-5, claude-fable-5-1]
    default: claude-opus-5-5
    options: { claude-opus-5-5: "Opus 5.5", claude-fable-5-1: "Fable 5.1" }
`;
const EFFORT_INPUT = `  developer_effort:
    label: "Developer effort"
    type: string
    enum: [default, low, high]
    default: default
    options: { "default": "Default", "low": "Low", "high": "High" }
`;
const flowSteps = `steps:
  - id: plan
    agent: planner
    prompt: "plan"
  - id: develop
    agent: developer
    prompt: "develop"
  - id: finish
    agent: planner
    prompt: "finish"
`;

// plan → develop → finish, the developer's model and effort chosen by inputs
const FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-799
inputs:
${MODEL_INPUT}${EFFORT_INPUT}  note: { type: string, default: "" }
agents:
  planner: { provider: claude, model: m, session: persistent }
  developer: { provider: claude, model: "{{ inputs.developer_model }}", effort: "{{ inputs.developer_effort }}", session: persistent }
${flowSteps}`;

// the same steps, with only the developer's model as an input
const MODEL_ONLY_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-799-model
inputs:
${MODEL_INPUT}agents:
  planner: { provider: claude, model: m, session: persistent }
  developer: { provider: claude, model: "{{ inputs.developer_model }}", session: persistent }
${flowSteps}`;

// plan → approve (a human gate) → work: `work` stops past a decided gate
const GATE_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-799-gate
agents:
  planner: { provider: claude, model: m, session: ephemeral }
  worker: { provider: claude, model: w, session: ephemeral }
steps:
  - id: plan
    agent: planner
    prompt: "plan"
  - id: approve
    type: human_approval
    message: "Proceed?"
  - id: work
    agent: worker
    prompt: "work"
`;

// a workflow only the repository declares; `extra`: more steps
const repoFlow = (extra = '') => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: repo-flow
inputs:
  task: { type: string, default: "the work" }
agents:
  planner: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read] } }
  developer: { provider: claude, model: d, session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: plan
    agent: planner
    prompt: "plan"
  - id: develop
    agent: developer
    prompt: "develop"
${extra}`;
const VERIFY_STEP = `  - id: verify
    agent: planner
    prompt: "verify"
`;

const call = async (api, channel, arg) => api[channel](arg); // a sync throw becomes a rejection
const eventsOf = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const startOf = (run) => run.events.find((e) => e.type === 'workflow.started');
const stepsStarted = (run) => run.events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
const sessionOf = (run, step) => run.events.find((e) => e.type === 'session.opened' && e.session.step_id === step)?.session;

// Calls the channel, answers every gate, stops the run at the step `stopAt` when given; resolves with
// the start's answer, every event and the workflow.finished event. One run at a time in these tests.
function runToEnd(service, api, channel, opts, { stopAt = null } = {}) {
  const events = [];
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (stopAt && ev.type === 'step.started' && ev.step_id === stopAt) setImmediate(() => api['run:stop']({ runId: ev.run_id }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return call(api, channel, opts).then(async (started) => ({ ...started, events, end: await finished }));
}

function flowService(t) {
  const { service, api } = makeResumeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-799.yaml'), FLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-799-model.yaml'), MODEL_ONLY_FLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-799-gate.yaml'), GATE_FLOW);
  return { service, api, ws };
}

// fixture-799 stopped at develop by the provider's usage limit, on Fable at high effort
function limitedRun(service, api, extra = {}) {
  return runToEnd(service, api, 'run:start', {
    file: 'fixture-799.yaml', inputs: { developer_model: FABLE, developer_effort: 'high', note: 'keep' }, mock: true,
    mockSequences: { usage_limits: [`claude:${FABLE}`] }, ...extra,
  });
}

// A project whose repository alone declares repo-flow.yaml, accepted at HEAD.
async function repoProject(t, flow = repoFlow()) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = repoWithManifest(t, { flow });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  const accept = async () => {
    const w = (await api['workflows:list']({ projectId: project.id })).find((x) => x.origin === 'repository' && /repo-flow/.test(String(x.file)));
    await api['workflows:accept']({ projectId: project.id, file: w.file, commit: w.commit });
  };
  await accept();
  return { service, api, ws, repo, project, accept };
}

// repo-flow stopped at develop by the provider's usage limit
const failedRepoRun = (service, api, project) => runToEnd(service, api, 'run:start', {
  file: 'repo-flow.yaml', inputs: {}, mock: true, projectId: project.id, mockSequences: { usage_limits: ['claude:d'] },
});

// ---- 1. Resume finds a repository workflow ------------------------------------------------------

test('#799 a run of an accepted repository-only workflow resumes from a step, with no workspace copy', async (t) => {
  const { service, api, ws, project } = await repoProject(t);
  const first = await failedRepoRun(service, api, project);
  assert.equal(first.end.status, 'failed');
  assert.equal(startOf(first).file, 'repo-flow.yaml', 'the run records the file\'s basename');
  assert.equal(fs.existsSync(path.join(ws.workflows, 'repo-flow.yaml')), false, 'no workspace copy');

  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop' });
  assert.equal(resumed.end.status, 'success');
  assert.deepEqual(startOf(resumed).resumed_from, { run_id: first.runId, step: 'develop' });
  assert.equal(startOf(resumed).project_id, project.id);
});

test('#799 runs:resumeOptions lists the steps of a repository-only workflow', async (t) => {
  const { service, api, project } = await repoProject(t);
  const first = await failedRepoRun(service, api, project);
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual(o.steps.map((s) => s.id), ['plan', 'develop']);
  assert.equal(o.workflow, 'repo-flow');
  assert.equal(o.suggested, 'develop');
});

test('#799 a repository-only run resumes after the folder of the workflow copies is gone', async (t) => {
  const { service, api, ws, project } = await repoProject(t);
  const first = await failedRepoRun(service, api, project);
  fs.rmSync(path.join(ws.root, 'repository-workflows'), { recursive: true, force: true });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop' });
  assert.equal(resumed.end.status, 'success');
});

test('#799 a repository-only run resumes on the workflow of a newer accepted commit', async (t) => {
  const { service, api, repo, project, accept } = await repoProject(t);
  const first = await failedRepoRun(service, api, project);
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow(VERIFY_STEP) });
  repo.commit('the flow verifies');
  await accept();

  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual(o.steps.map((s) => s.id), ['plan', 'develop', 'verify']);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop' });
  assert.deepEqual(stepsStarted(resumed), ['develop', 'verify']);
});

test('#799 a repository workflow not accepted at HEAD is refused, naming it, and nothing starts', async (t) => {
  const { service, api, repo, project } = await repoProject(t);
  const first = await failedRepoRun(service, api, project);
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow(VERIFY_STEP) });
  repo.commit('the flow changes after the run');

  await assert.rejects(call(api, 'runs:resume', { runId: first.runId, step: 'develop' }), /Workflow "repo-flow" from the repository @ \w+ is not accepted/);
  assert.equal((await api['runs:list']()).runs.length, 1);
});

test('#799 a workspace workflow run of a project keeps resuming from the workspace', async (t) => {
  const { service, api, ws, project } = await repoProject(t);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-799.yaml'), FLOW);
  const first = await limitedRun(service, api, { projectId: project.id });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop' });
  assert.equal(resumed.end.status, 'success');
});

test('#799 the kept-work question of a repository-only run says the steps left', async (t) => {
  const { api, ws, repo, project } = await repoProject(t);
  // an ended run of issue 1 whose worktree kept a commit of its own, stopped at develop
  const wt = path.join(tempDir(t, 'wt-799-'), 'wt');
  repo.git('worktree', 'add', '-q', '-b', 'feature', wt);
  repo.git('-C', wt, 'commit', '-q', '--allow-empty', '-m', 'own work');
  const issue = { number: 1, url: roadmapIssue(1).url, title: 'Issue 1' };
  const runId = '20261105-120000-kept799a1';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const ts = '2026-11-05T12:00:00.000Z';
  const events = [
    { ts, type: 'workflow.started', run_id: runId, workflow: 'repo-flow', file: 'repo-flow.yaml', project_id: project.id, inputs: {}, mock: true, issues: [issue] },
    { ts, type: 'worktree.ready', dir: wt, base: 'main', branch: 'feature', repo: repo.dir },
    { ts, type: 'step.started', step_id: 'plan', agent: 'planner' },
    { ts, type: 'step.finished', step_id: 'plan', visit: 1, output: {} },
    { ts, type: 'step.started', step_id: 'develop', agent: 'developer' },
    { ts, type: 'workflow.finished', status: 'failed', error: 'It broke', summary: {} },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: runId, workflow: 'repo-flow', project_id: project.id, status: 'failed', started_at: ts, finished_at: ts, duration_ms: 1000, issues: [issue], inputs: {}, sessions: [] }));

  const out = await api['run:start']({ file: 'repo-flow.yaml', inputs: {}, mock: true, projectId: project.id, issues: [issue] });
  assert.equal(out.kept?.runId, runId);
  assert.match(out.kept.message, /Done: Plan\. Left: Develop\./);
});

// ---- 3. A resume starts where the run stopped ---------------------------------------------------

test('#799 a failed run with no step resumes at the step it stopped at', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  assert.equal(first.end.status, 'failed');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId });
  assert.deepEqual(startOf(resumed).resumed_from, { run_id: first.runId, step: 'develop' });
});

test('#799 a failed run resumed with no step does not run its finished steps again', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId });
  assert.deepEqual(stepsStarted(resumed), ['develop', 'finish']);
});

test('#799 a cancelled run with no step resumes at the step it stopped at', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-799.yaml', inputs: {}, mock: true }, { stopAt: 'develop' });
  assert.equal(first.end.status, 'cancelled');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId });
  assert.deepEqual(startOf(resumed).resumed_from, { run_id: first.runId, step: 'develop' });
});

test('#799 choosing the first step still starts a failed run over', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'plan' });
  assert.deepEqual(startOf(resumed).resumed_from, { run_id: first.runId, step: 'plan' });
  assert.deepEqual(stepsStarted(resumed), ['plan', 'develop', 'finish']);
});

test('#799 a failed run stopped past a decided human gate is refused with no step, never restarted at the first step', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-799-gate.yaml', inputs: {}, mock: true, mockSequences: { usage_limits: ['claude:w'] } });
  assert.equal(first.end.status, 'failed');
  await assert.rejects(call(api, 'runs:resume', { runId: first.runId }), /Cannot resume from "work": it would go past the human gate "approve"/);
  assert.equal((await api['runs:list']()).runs.length, 1);
});

test('#799 a run that ended successfully with no step starts at its first step', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-799.yaml', inputs: {}, mock: true });
  assert.equal(first.end.status, 'success');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId });
  assert.deepEqual(startOf(resumed).resumed_from, { run_id: first.runId, step: 'plan' });
});

// ---- 4. Resuming after a provider limit ---------------------------------------------------------

// fixture-799 as a real run ends at develop: plan done, then `develop` as given ({ events, status,
// error }). A developer session with 140K of context, its cache long gone.
function seedRun(ws, runId, { events, status, error = null }) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const ts = '2026-09-30T10:00:00.000Z';
  const all = [
    { type: 'workflow.started', run_id: runId, workflow: 'fixture-799', file: 'fixture-799.yaml', project_id: null, inputs: { developer_model: FABLE, developer_effort: 'high', note: '' }, mock: true },
    { type: 'step.started', step_id: 'plan', visit: 1, agent: 'planner' },
    { type: 'step.finished', step_id: 'plan', visit: 1, output: {} },
    { type: 'step.started', step_id: 'develop', visit: 1, agent: 'developer' },
    ...events,
    { type: 'workflow.finished', status, ...(error ? { error } : {}), summary: {} },
  ].map((e) => ({ ts, ...e }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${all.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-799', status, started_at: ts, finished_at: ts, duration_ms: 1000,
    inputs: { developer_model: FABLE, developer_effort: 'high', note: '' },
    sessions: [
      { id: 'orchestrator', agent: 'orchestrator', provider: 'engine', closed_at: ts, cost_usd: 0 },
      { id: 's2', agent: 'developer', provider: 'claude', mode: 'persistent', turns: 3, closed_at: ts, last_turn_at: ts, context_tokens: 140000, cold_resume_usd: 0.7, cost_usd: 1 },
    ],
    steps: { plan: { visits: 1, output: {} }, develop: { visits: 1, output: null }, finish: { visits: 0, output: null } },
  }));
  return runId;
}

// the step reports the failure (a step with on_error, the case of the issue)
const weeklyAtStep = (ws, runId = '20260930-100000-weekly799') => seedRun(ws, runId, {
  status: 'failed', error: WEEKLY, events: [{ type: 'step.finished', step_id: 'develop', visit: 1, output: { error: WEEKLY }, error: true }],
});

test('#799 a run stopped by the weekly limit says so in runs:resumeOptions', async (t) => {
  const { api, ws } = flowService(t);
  const o = await api['runs:resumeOptions']({ runId: weeklyAtStep(ws) });
  assert.match(String(o.limit), /weekly limit/i);
});

test('#799 the weekly limit is named when the step has no step.finished: the run itself failed with it', async (t) => {
  const { api, ws } = flowService(t);
  const runId = seedRun(ws, '20260930-100000-weekly799b', { status: 'failed', error: WEEKLY, events: [] });
  const o = await api['runs:resumeOptions']({ runId });
  assert.match(String(o.limit), /weekly limit/i);
});

test('#799 a run stopped by the weekly limit suggests its stopped step', async (t) => {
  const { api, ws } = flowService(t);
  const o = await api['runs:resumeOptions']({ runId: weeklyAtStep(ws) });
  assert.equal(o.suggested, 'develop');
});

test('#799 a run stopped by the weekly limit says what its agent\'s next turn re-reads', async (t) => {
  const { api, ws } = flowService(t);
  const o = await api['runs:resumeOptions']({ runId: weeklyAtStep(ws) });
  const developer = (o.turns || []).find((x) => x.agent === 'developer');
  assert.deepEqual([developer?.turn.kind, developer?.turn.tokens, developer?.turn.cost_usd], ['cold', 140000, 0.7]);
});

test('#799 a simulated run stopped by its provider\'s usage limit names it, at its step', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.match(String(o.limit), /usage limit/i);
  assert.equal(o.suggested, 'develop');
});

test('#799 a run stopped by a usage limit lists the next turn of the agent that ran', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.equal((o.turns || []).map((x) => x.agent).includes('planner'), true);
});

test('#799 a cancelled run lists the next turn of the agent that ran', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-799.yaml', inputs: {}, mock: true }, { stopAt: 'develop' });
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.equal((o.turns || []).map((x) => x.agent).includes('planner'), true);
});

test('#799 a failure that is no limit names no limit', async (t) => {
  const { api, ws } = flowService(t);
  const error = 'Tests failed: 3 of 10';
  const runId = seedRun(ws, '20260930-100000-tests799', { status: 'failed', error, events: [{ type: 'step.finished', step_id: 'develop', visit: 1, output: { error }, error: true }] });
  const o = await api['runs:resumeOptions']({ runId });
  assert.equal(o.limit, null);
});

test('#799 a limit the run recovered from names no limit once the run ended well', async (t) => {
  const { api, ws } = flowService(t);
  const runId = seedRun(ws, '20260930-100000-recov799', {
    status: 'success',
    events: [
      { type: 'step.finished', step_id: 'develop', visit: 1, output: { error: WEEKLY }, error: true },
      { type: 'step.started', step_id: 'finish', visit: 1, agent: 'planner' },
      { type: 'step.finished', step_id: 'finish', visit: 1, output: {} },
    ],
  });
  const o = await api['runs:resumeOptions']({ runId });
  assert.equal(o.limit, null);
});

// ---- 5. Inputs can change on a resume -----------------------------------------------------------

test('#799 runs:resume takes `inputs` as its last positional parameter', async (t) => {
  const { service } = flowService(t);
  const entry = service.manifest.find((e) => e.channel === 'runs:resume');
  assert.deepEqual(entry.params, ['runId', 'step', 'instruction', 'mock', 'confirmGate', 'images', 'inputs']);
});

test('#799 runs:resume refuses `inputs` that are not an object', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  await assert.rejects(call(api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: OPUS }), /inputs/);
});

test('#799 a changed input is merged over the recorded ones in the new run\'s workflow.started', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_model: OPUS } });
  assert.deepEqual(startOf(resumed).inputs, { developer_model: OPUS, developer_effort: 'high', note: 'keep' });
});

test('#799 a changed model is the model the resumed step\'s session runs on', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_model: OPUS } });
  assert.deepEqual([sessionOf(resumed, 'develop')?.model, sessionOf(resumed, 'develop')?.effort], [OPUS, 'high']);
});

test('#799 a changed effort is the effort the resumed step\'s session runs at', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_effort: 'low' } });
  assert.deepEqual([sessionOf(resumed, 'develop')?.model, sessionOf(resumed, 'develop')?.effort], [FABLE, 'low']);
});

test('#799 a changed model wins over the agent override the failed run recorded', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api, { agentOverrides: { developer: { model: 'override-model' } }, mockSequences: { usage_limits: ['claude:override-model'] } });
  assert.equal(sessionOf(first, 'develop')?.model, 'override-model');
  assert.equal(first.end.status, 'failed');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_model: OPUS } });
  assert.equal(sessionOf(resumed, 'develop')?.model, OPUS);
});

test('#799 a changed input leaves the failed run\'s events byte-identical', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const file = path.join(first.runDir, 'events.jsonl');
  const before = fs.readFileSync(file, 'utf8');
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_model: OPUS } });
  assert.equal(startOf(resumed).inputs.developer_model, OPUS, 'the change reached the new run');
  assert.equal(fs.readFileSync(file, 'utf8') === before, true);
  assert.equal(eventsOf(first.runDir).find((e) => e.type === 'workflow.started').inputs.developer_model, FABLE);
});

test('#799 a value the workflow does not offer is refused, and nothing starts', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  await assert.rejects(call(api, 'runs:resume', { runId: first.runId, step: 'develop', inputs: { developer_model: 'no-such-model' } }), /Input "developer_model" must be one of/);
  assert.equal((await api['runs:list']()).runs.length, 1);
});

test('#799 runs:resumeOptions gives the run\'s recorded model and effort, and no other input', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual(o.inputs, { developer_model: FABLE, developer_effort: 'high' });
});

test('#799 runs:resumeOptions gives the definitions of those inputs as the workflow has them', async (t) => {
  const { service, api } = flowService(t);
  const first = await limitedRun(service, api);
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual(o.inputDefs, {
    developer_model: { label: 'Developer model', type: 'string', enum: [OPUS, FABLE], default: OPUS, options: { [OPUS]: 'Opus 5.5', [FABLE]: 'Fable 5.1' } },
    developer_effort: { label: 'Developer effort', type: 'string', enum: ['default', 'low', 'high'], default: 'default', options: { default: 'Default', low: 'Low', high: 'High' } },
  });
});

test('#799 runs:resumeOptions gives only the inputs the workflow declares', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-799-model.yaml', inputs: { developer_model: FABLE }, mock: true });
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual([o.inputs, Object.keys(o.inputDefs || {})], [{ developer_model: FABLE }, ['developer_model']]);
});

test('#799 runs:resumeOptions of a workflow declaring neither input gives empty objects', async (t) => {
  const { service, api } = flowService(t);
  const first = await runToEnd(service, api, 'run:start', { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const o = await api['runs:resumeOptions']({ runId: first.runId });
  assert.deepEqual([o.inputs, o.inputDefs], [{}, {}]);
});
