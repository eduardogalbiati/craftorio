// #368 review fixes: pause after the current turn, in the paths the acceptance tests
// (pause-after-turn-368.slow.test.js) do not reach: a turn cut by max_requests in a parallel step,
// a schema retry, the supervisor-on-call stall gate after a finished step, a child run that ended
// paused after Cancel pause, and the step command a pause waits for (the screenshots, a transition
// action). Whole simulated runs (mock provider, tiny inline workflows).
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');
const machineActions = require('../../engine/machine-actions');
const { tempWorkflow, CHILD_ECHO_YAML } = require('../engine-helpers');
const { makeService } = require('../service/helpers');

const DEADLINE_MS = 20000;

// A run of `yaml` in a temp folder; onEvent(ev, run) sees every event before it is recorded.
function engineRun(t, yaml, opts = {}, onEvent = () => {}) {
  const { dir, file } = tempWorkflow(t, yaml);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...opts });
  const events = [];
  run.on('event', (ev) => { events.push(ev); onEvent(ev, run); });
  return { dir, run, events, finished: () => events.find((e) => e.type === 'workflow.finished') };
}

const sentIn = (events, stepId) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === stepId);
const started = (events, stepId) => events.some((e) => e.type === 'step.started' && e.step_id === stepId);

// ---- A turn cut by its request budget (max_requests) in a parallel step ------------------------

const PARALLEL_BUDGET_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pause-budget
providers:
  claude: { type: claude-code, command: claude, args: ["-p"] }
agents:
  a: { provider: claude, model: mock-model, session: handoff, max_requests: 40 }
  b: { provider: claude, model: mock-model, session: handoff, max_requests: 40 }
steps:
  - id: review
    agents: [a, b]
    supervise: false
    prompt: "review the work"
  - id: after
    agent: a
    prompt: "go on"
`;

function waitFor(service, pred, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.events.off('run:event', on); reject(new Error(`timed out waiting for ${what}`)); }, DEADLINE_MS);
    function on(ev) {
      if (!pred(ev)) return;
      clearTimeout(timer);
      service.events.off('run:event', on);
      resolve(ev);
    }
    service.events.on('run:event', on);
  });
}

test('pause during the wrap-up of a turn cut by max_requests in a parallel step: no continuation turn, the note saved, the visit uncounted; Resume starts the agent from its note', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pause-budget.yaml'), PARALLEL_BUDGET_WORKFLOW);
  const events = [];
  const pause = { error: null, called: false };
  service.events.on('run:event', (ev) => {
    events.push(ev);
    if (pause.called || ev.type !== 'session.message_sent' || !/request budget/.test(ev.prompt || '')) return;
    pause.called = true;
    try { api['run:pause']({ runId: ev.run_id }); } catch (e) { pause.error = e; }
  });
  const { runId } = await api['run:start']({ file: 'fixture-pause-budget.yaml', inputs: {}, mock: true, mockSequences: { request_budget: { review: 1 } } });
  const end = await waitFor(service, (e) => e.run_id === runId && e.type === 'workflow.finished', 'the run to end');
  const ofRun = events.filter((e) => e.run_id === runId);
  assert.equal(pause.called, true, 'the wrap-up of the cut turn was sent');
  assert.equal(pause.error, null, pause.error?.message);
  assert.equal(end.status, 'paused', end.error);
  assert.equal(ofRun.some((e) => e.type === 'session.message_sent' && /continued after/.test(e.prompt || '')), false, 'no continuation turn');
  const cut = ofRun.find((e) => e.type === 'session.message_received' && e.step_id === 'review' && e.cut);
  const other = cut.session.agent === 'a' ? 'b' : 'a';
  const answered = ofRun.filter((e) => e.type === 'session.message_received' && e.step_id === 'review' && e.session.agent === other);
  assert.equal(answered.length, 1, 'the other agent finished its turn, once');
  const saved = ofRun.find((e) => e.type === 'handoff.saved' && e.agent === cut.session.agent);
  assert.equal(saved?.step_id, 'review');
  assert.equal(fs.existsSync(saved.path), true);
  assert.equal(end.summary.steps.review.visits, 0);
  assert.equal(end.summary.paused.step, 'review');
  assert.equal(ofRun.some((e) => e.type === 'step.started' && e.step_id === 'after'), false);
  assert.equal(api['run:stop']({ runId }), false, 'a paused run is not in progress: nothing to stop');

  const resumed = await api['runs:resume']({ runId });
  const again = await waitFor(service, (e) => e.run_id === resumed.runId && e.type === 'workflow.finished', 'the resumed run to end');
  assert.equal(again.status, 'success', again.error);
  const prompts = events.filter((e) => e.run_id === resumed.runId && e.type === 'session.message_sent' && e.step_id === 'review').map((e) => e.prompt || '');
  assert.equal(prompts.some((p) => p.includes('<handoff_note>') && p.includes(saved.note)), true, 'the cut agent starts from the note of its cut turn');
});

// ---- A schema retry ----------------------------------------------------------------------------

const SCHEMA_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-pause-schema }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    supervise: false
    prompt: "do the work"
    output_schema:
      type: object
      required: [summary]
      properties:
        summary: { type: string }
  - id: after
    agent: a
    prompt: "go on"
`;

test('pause before a schema retry: no retry turn, the run ends paused at the step, its visit uncounted', async (t) => {
  const r = engineRun(t, SCHEMA_WORKFLOW, { mockSequences: { invalid_answers: { work: 1 } } }, (ev, run) => {
    if (ev.type === 'log' && ev.kind === 'invalid_output' && !run.pausing) run.pause();
  });
  await r.run.start();
  const end = r.finished();
  assert.equal(r.events.some((e) => e.type === 'log' && e.kind === 'invalid_output'), true, 'the answer was invalid');
  assert.equal(end.status, 'paused', end.error);
  assert.equal(sentIn(r.events, 'work').length, 1, 'no retry turn');
  assert.equal(end.summary.steps.work.visits, 0);
  assert.equal(end.paused.step, 'work');
  assert.equal(started(r.events, 'after'), false);
});

// ---- The supervisor-on-call stall gate, after the step finished ---------------------------------

const STALL_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-pause-stall }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: after
    agent: a
    prompt: "go on"
`;

test('pause while the stall gate of the supervisor on call waits after a finished step: the run ends paused, the gate unanswered, the visit still counted', async (t) => {
  const r = engineRun(t, STALL_WORKFLOW, { mockSequences: { permission_denials: { work: 1 } } }, (ev, run) => {
    if (ev.type === 'approval.requested') setImmediate(() => run.pause());
  });
  const original = r.run.sendToAgent.bind(r.run);
  r.run.sendToAgent = async (agent, prompt, opts) => {
    if (agent !== 'supervisor') return original(agent, prompt, opts);
    return { text: '```json\n' + JSON.stringify({ explanation: 'Its tools are refused.', action: 'user_action', user_action: 'Allow the tool.' }) + '\n```' };
  };
  await r.run.start();
  const end = r.finished();
  const gate = r.events.find((e) => e.type === 'approval.requested');
  assert.equal(gate?.step_id, 'work', 'the stall gate opened');
  assert.equal(r.events.findIndex((e) => e.type === 'step.finished' && e.step_id === 'work') < r.events.indexOf(gate), true, 'after the step finished');
  assert.equal(end.status, 'paused', end.error);
  assert.equal(r.events.some((e) => e.type === 'approval.resolved'), false);
  assert.equal(end.summary.steps.work.visits, 1, 'the finished visit stays counted');
  assert.equal(started(r.events, 'after'), false);
});

// ---- A child run that paused, after Cancel pause ------------------------------------------------

const PARENT_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-pause-parent }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: 1 }
  - id: after
    agent: a
    prompt: "go on"
`;

test('a child run that ended paused ends its parent paused, even when Cancel pause came after it paused', async (t) => {
  const seen = { cancelled: null, error: null };
  let run = null;
  // the child pauses with its parent, then the owner cancels the pause: the child had already paused
  const startChild = async () => ({
    runId: 'child-1', stop() {}, pause() {}, cancelPause() {},
    finished: new Promise((resolve) => setImmediate(() => {
      try { run.pause(); seen.cancelled = run.cancelPause(); } catch (e) { seen.error = e; }
      resolve({ status: 'paused', outputs: {} });
    })),
  });
  const r = engineRun(t, PARENT_WORKFLOW, { startChild });
  fs.writeFileSync(path.join(r.dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  run = r.run;
  await run.start();
  const end = r.finished();
  assert.equal(seen.error, null, seen.error?.message);
  assert.equal(seen.cancelled, true, 'the pause was taken back');
  assert.equal(r.events.some((e) => e.type === 'run.pause_cancelled'), true);
  assert.equal(end.status, 'paused', end.error);
  assert.equal(end.paused.step, 'child');
  assert.equal(started(r.events, 'after'), false);
});

// ---- The step command a pause waits for: the screenshots, a transition action --------------------

const SHOTS_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-pause-shots }
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: implement
    output_schema:
      type: object
      properties: {}
  - id: shots
    type: screenshots
    from: develop
    folder: ui
  - id: after
    agent: dev
    prompt: "go on"
`;

test('pause during a screenshots step: runs:active names the screenshots, the capture runs to its end, no step starts after it', async (t) => {
  const base = machineActions.simulated({});
  const seen = { state: null, finished: false, error: null };
  let run = null;
  const machine = {
    ...base,
    captureScreenshots: (opts) => new Promise((resolve) => setImmediate(() => {
      try { run.pause(); seen.state = run.pauseState(); } catch (e) { seen.error = e; }
      setTimeout(() => { seen.finished = true; resolve(base.captureScreenshots(opts)); }, 50);
    })),
  };
  const r = engineRun(t, SHOTS_WORKFLOW, { machine });
  run = r.run;
  await run.start();
  const end = r.finished();
  assert.equal(seen.error, null, seen.error?.message);
  assert.equal(seen.state?.command, 'the screenshots of shots');
  assert.equal(r.events.find((e) => e.type === 'run.pausing')?.command, 'the screenshots of shots');
  assert.equal(seen.finished, true);
  assert.equal(end.status, 'paused', end.error);
  assert.equal(r.events.some((e) => e.type === 'step.finished' && e.step_id === 'shots'), true);
  assert.equal(started(r.events, 'after'), false);
  assert.equal(run.pauseState()?.command, undefined, 'no command left to wait for once the capture ended');
});

const ACTION_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-pause-action }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: gate
    type: human_approval
    message: "Go on?"
    transitions:
      - when: "approved"
        action: "echo hi"
        goto: after
  - id: after
    agent: a
    prompt: "go on"
`;

test('pause during a transition action: runs:active names the action, it runs to its end, the next step does not start', async (t) => {
  const seen = { state: null, finished: false, error: null };
  let run = null;
  const machine = {
    ...machineActions.simulated({}),
    runAction: () => new Promise((resolve) => setImmediate(() => {
      try { run.pause(); seen.state = run.pauseState(); } catch (e) { seen.error = e; }
      setTimeout(() => { seen.finished = true; resolve({ exit_code: 0, stdout: 'hi', stderr: '', output: 'hi' }); }, 50);
    })),
  };
  const r = engineRun(t, ACTION_WORKFLOW, { machine }, (ev, rn) => {
    if (ev.type === 'approval.requested') setImmediate(() => rn.resolveApproval(ev.approval_id, true));
  });
  run = r.run;
  await run.start();
  const end = r.finished();
  assert.equal(seen.error, null, seen.error?.message);
  assert.equal(seen.state?.command, 'echo hi');
  assert.equal(r.events.find((e) => e.type === 'run.pausing')?.command, 'echo hi');
  assert.equal(seen.finished, true);
  assert.equal(r.events.find((e) => e.type === 'action.executed')?.command, 'echo hi');
  assert.equal(end.status, 'paused', end.error);
  assert.equal(started(r.events, 'after'), false);
});
