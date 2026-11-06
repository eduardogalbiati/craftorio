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
const { makeResumeService } = require('./helpers');

const FLOW = `apiVersion: multiagent/v1
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
function seeded(t, events) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-799-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'flow.yaml');
  fs.writeFileSync(file, FLOW);
  const runDir = path.join(root, 'run-799');
  fs.mkdirSync(runDir);
  const all = [{ type: 'workflow.started', file: 'flow.yaml', inputs: { developer_model: 'a' } }, ...events];
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

test('#799 the new run is told what changed', (t) => {
  const { area, started } = seeded(t, fellBack);
  area.resumeRun({ runId: 'run-799', inputs: { developer_model: 'b' } });
  assert.deepEqual(started[0].notices, [{ level: 'info', message: 'Inputs changed on this resume: developer_model: gpt → b.' }]);
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
