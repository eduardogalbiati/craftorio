// #799, internals the acceptance tests do not reach: what resumeRun hands to startWorkflowRun when a
// recorded fallback meets a changed input, the step a failed run stopped at after an error it got
// past, the alias that never changes inputs, and how a provider's limit is recognised.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const resumeArea = require('../../service/areas/resume');
const { isAnyQuotaError, isQuotaError } = require('../../engine/providers');
const { inputsRead } = require('../../engine/run/templates');
const { makeResumeService } = require('./helpers');

const FLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: internals-799
inputs:
  developer_model: { type: string, default: a }
  developer_effort: { type: string, default: low }
  validation: { type: string, default: validated }
agents:
  planner: { provider: claude, model: m, session: persistent }
  developer: { provider: claude, model: "{{ inputs.developer_model or 'a' }}", session: persistent }
steps:
  - id: plan
    agent: planner
    prompt: "plan"
  - id: develop
    agent: developer
    prompt: "develop"
  - id: fix
    agent: developer
    prompt: "fix"
  - id: finish
    agent: planner
    prompt: "finish"
`;

// the area over a seeded run folder; `started`: what it asked startWorkflowRun for
function seeded(t, events, { flow = FLOW, start = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-799-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'flow.yaml');
  fs.writeFileSync(file, flow);
  const runDir = path.join(root, 'run-799');
  fs.mkdirSync(runDir);
  const all = [{ type: 'workflow.started', file: 'flow.yaml', inputs: { developer_model: 'a' }, ...start }, ...events];
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${all.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const started = [];
  const area = resumeArea({
    ws: { runs: root }, runFolder: () => runDir, runIsLive: () => false, runAlive: () => false, projectWorkflowFile: () => file,
    startWorkflowRun: (opts) => { started.push(opts); return { runId: 'new' }; },
  });
  return { area, started };
}

const fellBack = [
  { type: 'session.opened', session: { agent: 'developer', provider: 'codex', provider_session_id: 'on-codex' } },
  { type: 'session.opened', session: { agent: 'planner', provider: 'claude', provider_session_id: 'on-claude' } },
  { type: 'agent.fallback', agent: 'developer', to: 'codex:gpt' },
  { type: 'step.started', step_id: 'develop' },
  { type: 'workflow.finished', status: 'failed', error: 'It broke' },
];

test('#799 a changed model drops the fallback it replaces, and the conversation on that provider', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.equal(started[0].agentOverrides, null);
  assert.deepEqual(started[0].resume.sessions, { planner: 'on-claude' });
});

test('#799 an input no agent setting reads keeps the fallback', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799', inputs: { developer_effort: 'high' } });
  assert.deepEqual(started[0].agentOverrides, { developer: { provider: 'codex', model: 'gpt' } });
  assert.equal(started[0].resume.sessions.developer, 'on-codex');
});

test('#799 a resume refuses an input it does not offer, and nothing starts', (t) => {
  const { area, started } = seeded(t, fellBack);
  assert.throws(() => area.resumeRun({ runId: 'run-799', inputs: { validation: 'auto', developer_model: 'b' } }), /Cannot change validation on a resume/);
  assert.equal(started.length, 0);
});

test('#799 the options give the value the agent ran on, not the input an override covered', (t) => {
  const { area } = seeded(t, fellBack);
  assert.deepEqual(area.resumeOptions({ runId: 'run-799' }).inputs, { developer_model: 'gpt', developer_effort: 'low' });
});

test('#799 choosing the recorded input over the override that ran drops the override, and says so', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'a' } });
  assert.equal(started[0].agentOverrides, null);
  assert.deepEqual(started[0].notices, [{ level: 'info', message: 'Inputs changed on this resume: developer_model: gpt → a.' }]);
});

test('#799 a resume with no inputs hands on what the run recorded and says nothing', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799' });
  assert.deepEqual(started[0].agentOverrides, { developer: { provider: 'codex', model: 'gpt' } });
  assert.equal(started[0].notices, undefined);
});

// an effort override left blank: the agent ran on the provider's default
const blankEffort = {
  flow: FLOW.replace('developer: { provider: claude,', 'developer: { provider: claude, effort: "{{ inputs.developer_effort }}",'),
  start: { agent_overrides: { developer: { effort: '' } } },
};

test('#799 a blank effort override reads as the input\'s default, never as an empty value', (t) => {
  const { area } = seeded(t, fellBack.slice(3), blankEffort);
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_effort, 'default');
});

test('#799 a blank effort override reads as default even when the input\'s list has no default', (t) => {
  const flow = blankEffort.flow.replace('developer_effort: { type: string, default: low }', 'developer_effort: { type: string, enum: [low, high], default: low }');
  const { area } = seeded(t, fellBack.slice(3), { ...blankEffort, flow });
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_effort, 'default');
});

test('#799 the notice over a blank effort override names the value it had', (t) => {
  const { area, started } = seeded(t, fellBack.slice(3), blankEffort);
  area.resumeRun({ runId: 'run-799', inputs: { developer_effort: 'high' } });
  assert.deepEqual(started[0].notices, [{ level: 'info', message: 'Inputs changed on this resume: developer_effort: default → high.' }]);
});

test('#799 the new run is told what changed', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.deepEqual(started[0].notices, [{ level: 'info', message: 'Inputs changed on this resume: developer_model: gpt → b.' }]);
});

test('#799 the inputs a template reads are named whole, so a longer name is not its prefix', () => {
  assert.deepEqual(inputsRead("{{ inputs.developer_model_note or inputs.developer_effort }}"), ['developer_model_note', 'developer_effort']);
  assert.deepEqual(inputsRead('a fixed model'), []);
  assert.deepEqual(inputsRead(undefined), []);
});

// the developer reads an input whose name starts with the one the owner changes
const longerName = {
  flow: FLOW
    .replace('  validation:', '  developer_model_note: { type: string, default: n }\n  validation:')
    .replace("{{ inputs.developer_model or 'a' }}", '{{ inputs.developer_model_note }}'),
};

test('#799 a changed input leaves the fallback of an agent that reads a longer name', (t) => {
  const { area, started } = seeded(t, fellBack, longerName);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.deepEqual(started[0].agentOverrides, { developer: { provider: 'codex', model: 'gpt' } });
  assert.equal(started[0].resume.sessions.developer, 'on-codex');
});

test('#799 the options never take the override of an agent that reads a longer name', (t) => {
  const { area } = seeded(t, fellBack, longerName);
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_model, 'a');
});

// two agents read developer_model, as the developer and the mapper of feature.yaml do; a fallback
// moves one of them, the other stays on the input the run recorded
const twoReaders = {
  flow: FLOW.replace('  developer: {', '  mapper: { provider: claude, model: "{{ inputs.developer_model }}", session: persistent }\n  developer: {'),
};
const fellBackOn = (agent) => [
  { type: 'session.opened', session: { agent: 'developer', provider: agent === 'developer' ? 'codex' : 'claude', provider_session_id: 'of-developer' } },
  { type: 'session.opened', session: { agent: 'mapper', provider: agent === 'mapper' ? 'codex' : 'claude', provider_session_id: 'of-mapper' } },
  { type: 'agent.fallback', agent, to: 'codex:gpt' },
  { type: 'step.started', step_id: 'develop' },
  { type: 'workflow.finished', status: 'failed', error: 'It broke' },
];

test('#799 with two readers, a changed model drops the one fallback and both take the new input', (t) => {
  const { area, started } = seeded(t, fellBackOn('developer'), twoReaders);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.equal(started[0].inputs.developer_model, 'b');
  assert.equal(started[0].agentOverrides, null);
});

test('#799 with two readers, only the agent that left its provider loses its conversation', (t) => {
  const { area, started } = seeded(t, fellBackOn('developer'), twoReaders);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.deepEqual(started[0].resume.sessions, { mapper: 'of-mapper' });
});

test('#799 with two readers, a resume with no inputs keeps the fallback and both conversations', (t) => {
  const { area, started } = seeded(t, fellBackOn('mapper'), twoReaders);
  area.resumeRun({ runId: 'run-799' });
  assert.deepEqual(started[0].agentOverrides, { mapper: { provider: 'codex', model: 'gpt' } });
  assert.deepEqual(started[0].resume.sessions, { developer: 'of-developer', mapper: 'of-mapper' });
});

test('#799 the Developer model shows the fallback the developer ran on', (t) => {
  const { area } = seeded(t, fellBackOn('developer'), twoReaders);
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_model, 'gpt');
});

test('#799 the Developer model never shows a fallback only another reader took', (t) => {
  const { area } = seeded(t, fellBackOn('mapper'), twoReaders);
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_model, 'a');
});

test('#799 the Developer model shows the developer\'s fallback when another reader fell back first', (t) => {
  const events = [{ type: 'agent.fallback', agent: 'mapper', to: 'codex:of-mapper' }, ...fellBackOn('developer')];
  const { area } = seeded(t, events, twoReaders);
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_model, 'gpt');
});

test('#799 in a workflow with no developer agent, the agent that reads the input stands for it', (t) => {
  const flow = FLOW.replace('  developer: {', '  builder: {').replaceAll('agent: developer', 'agent: builder');
  const events = [{ type: 'agent.fallback', agent: 'builder', to: 'codex:gpt' }, { type: 'step.started', step_id: 'develop' }, { type: 'workflow.finished', status: 'failed', error: 'It broke' }];
  const { area } = seeded(t, events, { flow });
  assert.equal(area.resumeOptions({ runId: 'run-799' }).inputs.developer_model, 'gpt');
});

test('#799 the new run is told when the developer moves to the model another reader fell back to', (t) => {
  const { area, started } = seeded(t, fellBackOn('mapper'), twoReaders);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'gpt' } });
  assert.deepEqual(started[0].notices, [{ level: 'info', message: 'Inputs changed on this resume: developer_model: a → gpt.' }]);
});

test('#799 a failed run resumes at the step its error route failed at, not at the step that took the error', (t) => {
  const { area, started } = seeded(t, [
    { type: 'step.started', step_id: 'plan' },
    { type: 'step.finished', step_id: 'plan', error: true, output: { error: "You've hit your weekly limit" } },
    { type: 'step.started', step_id: 'develop' },
    { type: 'workflow.finished', status: 'failed', error: 'It broke' },
  ]);
  area.resumeRun({ runId: 'run-799' });
  assert.equal(started[0].resume.fromStep, 'develop');
  assert.equal(area.resumeOptions({ runId: 'run-799' }).suggested, 'develop');
});

test('#799 a failed run resumes at the step it stopped at, not at an error it got past', (t) => {
  const { area, started } = seeded(t, [
    { type: 'step.started', step_id: 'develop' },
    { type: 'step.finished', step_id: 'develop', error: true, output: { error: 'x' } },
    { type: 'step.started', step_id: 'fix' },
    { type: 'step.finished', step_id: 'fix', output: {} },
    { type: 'step.started', step_id: 'finish' },
    { type: 'workflow.finished', status: 'failed', error: 'It broke' },
  ]);
  area.resumeRun({ runId: 'run-799' });
  assert.equal(started[0].resume.fromStep, 'finish');
});

test('#799 a failed run resumes at the step that reported the error when its error route also failed', (t) => {
  const { area, started } = seeded(t, [
    { type: 'step.started', step_id: 'develop' },
    { type: 'step.finished', step_id: 'develop', error: true, output: { error: 'x' } },
    { type: 'workflow.finished', status: 'failed', error: 'It broke' },
  ]);
  area.resumeRun({ runId: 'run-799' });
  assert.equal(started[0].resume.fromStep, 'develop');
});

test('#799 an interrupted run, with no end recorded, resumes at its last step', (t) => {
  const { area, started } = seeded(t, [{ type: 'step.started', step_id: 'plan' }, { type: 'step.finished', step_id: 'plan', output: {} }, { type: 'step.started', step_id: 'develop' }]);
  area.resumeRun({ runId: 'run-799' });
  assert.equal(started[0].resume.fromStep, 'develop');
});

test('#799 supervisor:resume never changes a run\'s inputs', async (t) => {
  const { service, api } = makeResumeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'internals-799.yaml'), FLOW);
  const seen = [];
  const ends = [];
  let ended = () => {};
  service.events.on('run:event', (ev) => {
    if (ev.type === 'workflow.started') seen.push(ev);
    if (ev.type === 'workflow.finished') { ends.push(ev); ended(); }
  });
  const runEnded = (n) => new Promise((resolve) => {
    ended = () => { if (ends.length >= n) resolve(); };
    ended();
  });
  const { runId } = await api['run:start']({ file: 'internals-799.yaml', inputs: { developer_model: 'a' }, mock: true });
  await runEnded(1);
  await api['supervisor:resume']({ runId, step: 'develop', inputs: { developer_model: 'b' } });
  await runEnded(2);
  assert.equal(seen[1].inputs.developer_model, 'a');
});

test('#799 the weekly limit is Claude Code\'s quota message, and any CLI\'s quota is recognised without its name', () => {
  assert.equal(isQuotaError('claude-code', "You've hit your weekly limit"), true);
  assert.equal(isQuotaError('claude-code', "You've hit your limit"), true);
  assert.equal(isAnyQuotaError("You've hit your weekly limit"), true);
  assert.equal(isAnyQuotaError('Claude AI usage limit reached'), true);
  assert.equal(isAnyQuotaError('Tests failed: 3 of 10'), false);
});
