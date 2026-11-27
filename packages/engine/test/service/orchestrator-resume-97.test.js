// #97 (review round 2): through the service, a resumed run and a child run stay on the orchestrator AI
// their run recorded (workflow.started orchestrator_ai), never on Settings' orchestratorProvider changed
// since; a run recorded before #97 resumes on Claude. The fixture is the workspace's edited copy of
// fix.yaml ('modified' origin: a bundled default, so its agents follow the chosen AI).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RESUME_WORKFLOW, makeService } = require('./helpers');

const PARENT = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-parent-97
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: approve
    type: human_approval
    message: "Go?"
  - id: child
    type: workflow
    workflow: fix.yaml
    inputs: {}
`;

function makeOrchestratorService(t) {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fix.yaml'), RESUME_WORKFLOW);
  return { service, api };
}

// starts a run, answers every gate (onGate first, if given), resolves when the started run finishes
function runToEnd(service, api, channel, opts, { onGate } = {}) {
  const events = [];
  let runId = null;
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'approval.requested') {
        setImmediate(() => {
          if (onGate) onGate(ev);
          api['approval:resolve']({ runId: ev.run_id, id: ev.approval_id, answer: true });
        });
      }
      if (ev.type === 'workflow.finished' && runId && ev.run_id === runId) { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return Promise.resolve(api[channel](opts)).then(async (started) => { runId = started.runId; return { ...started, events, end: await finished }; });
}

const startedOf = (events, runId) => events.find((e) => e.type === 'workflow.started' && e.run_id === runId) || {};

test('#97 a run started on Codex resumes on Codex after Settings moved back to Claude', async (t) => {
  const { service, api } = makeOrchestratorService(t);
  api['settings:set']({ orchestratorProvider: 'codex' });
  const first = await runToEnd(service, api, 'run:start', { file: 'fix.yaml', inputs: {}, mock: true });
  assert.equal(first.end.status, 'success', first.end.error);
  const s1 = startedOf(first.events, first.runId);
  assert.equal(s1.orchestrator_ai, 'codex');
  assert.equal(s1.orchestrator_applied, true);
  assert.equal(s1.agents?.a?.provider, 'codex');

  api['settings:set']({ orchestratorProvider: 'claude' });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: first.runId, step: 'plan' });
  assert.equal(resumed.end.status, 'success', resumed.end.error);
  const s2 = startedOf(resumed.events, resumed.runId);
  assert.equal(s2.orchestrator_ai, 'codex');
  assert.equal(s2.orchestrator_applied, true);
  assert.equal(s2.agents?.a?.provider, 'codex');
});

test('#97 a run recorded before #97 (no orchestrator_ai) resumes on Claude with Codex chosen', async (t) => {
  const { service, api } = makeOrchestratorService(t);
  const ws = service.workspace();
  const oldId = '20260101-000000-before97';
  const dir = path.join(ws.runs, oldId);
  fs.mkdirSync(dir, { recursive: true });
  const ev = (o) => `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', ...o })}\n`;
  fs.writeFileSync(path.join(dir, 'events.jsonl'),
    ev({ type: 'workflow.started', workflow: 'fixture-resume', file: 'fix.yaml', inputs: {}, mock: true })
    + ev({ type: 'step.finished', step_id: 'plan', visit: 1, output: {} }));
  api['settings:set']({ orchestratorProvider: 'codex' });
  const resumed = await runToEnd(service, api, 'runs:resume', { runId: oldId, step: 'plan' });
  assert.equal(resumed.end.status, 'success', resumed.end.error);
  const s = startedOf(resumed.events, resumed.runId);
  assert.equal(s.orchestrator_ai, 'claude');
  assert.equal('orchestrator_applied' in s, false);
  assert.equal(s.agents?.a?.provider, 'claude');
});

test('#97 a child run takes its parent\'s orchestrator AI although Settings changed while the parent ran', async (t) => {
  const { service, api } = makeOrchestratorService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-parent-97.yaml'), PARENT);
  api['settings:set']({ orchestratorProvider: 'codex' });
  // the parent's gate comes before its child step: the owner switches to Claude while it waits
  const onGate = () => api['settings:set']({ orchestratorProvider: 'claude' });
  const parent = await runToEnd(service, api, 'run:start', { file: 'fixture-parent-97.yaml', inputs: {}, mock: true }, { onGate });
  assert.equal(parent.end.status, 'success', parent.end.error);
  assert.equal(startedOf(parent.events, parent.runId).orchestrator_ai, 'codex');
  const child = parent.events.find((e) => e.type === 'workflow.started' && e.run_id !== parent.runId);
  assert.equal(!!child, true, 'the child run started');
  assert.equal(child.orchestrator_ai, 'codex');
  assert.equal(child.agents?.a?.provider, 'codex');
  assert.equal(api['settings:get']().orchestratorProvider, 'claude', 'the setting did change before the child started');
});
