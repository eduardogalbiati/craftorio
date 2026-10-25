const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../src/engine/workflow');
const evidence = require('../../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { tempWorkflow, runWith, until, CHILD_ECHO_YAML, CHILD_FAIL_YAML, CHILD_GATE_YAML } = require('../engine-helpers');

test('type: workflow step: without foreach, the output is { status, run_id, outputs } from the child\'s declared outputs', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-once }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: 7 }
`);
  fs.writeFileSync(path.join(dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'child');
  assert.equal(step.output.status, 'success');
  assert.ok(step.output.run_id);
  assert.deepEqual(step.output.outputs, { n: 7 });
});
test('type: workflow step: foreach runs one child per item, at most max_parallel at a time; outputs come back as an ordered list', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-foreach }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: "{{ item }}" }
    foreach: [1, 2, 3]
    max_parallel: 2
`);
  fs.writeFileSync(path.join(dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  let active = 0;
  let peak = 0;
  for (const ev of events) {
    if (ev.type === 'workflow.child_started') { active++; peak = Math.max(peak, active); }
    if (ev.type === 'workflow.child_finished') active--;
  }
  assert.equal(peak, 2, 'never more than max_parallel children at once');
  assert.equal(events.filter((e) => e.type === 'workflow.child_started').length, 3);

  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'children');
  assert.equal(step.output.status, 'success');
  assert.deepEqual(step.output.outputs, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(step.output.succeeded, 3);
  assert.equal(step.output.failed, 0);
  assert.deepEqual(run.childRuns.map((c) => c.status), ['success', 'success', 'success']);
  assert.deepEqual(finished.summary.child_runs.map((c) => c.step_id), ['children', 'children', 'children']);
});
test('type: workflow step (#175): each child\'s cost is recorded on workflow.child_finished, summed in run.childRuns and the run\'s summary.children_cost_usd', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-cost }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: "{{ item }}" }
    foreach: [1, 2]
`);
  fs.writeFileSync(path.join(dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const finishedEvents = events.filter((e) => e.type === 'workflow.child_finished');
  assert.equal(finishedEvents.length, 2);
  assert.ok(finishedEvents.every((e) => e.cost_usd > 0), 'each child\'s mock turn has a cost');
  assert.ok(run.childRuns.every((c) => c.cost_usd > 0));
  const total = run.childRuns.reduce((a, c) => a + c.cost_usd, 0);
  assert.equal(run.childrenCostUsd(), total);
  assert.equal(finished.summary.children_cost_usd, +total.toFixed(6));
});
test('checkLimits (#175): max_total_cost_usd counts child runs\' cost too, and the message says how much they added', (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: cost-limit }
orchestrator:
  limits: { max_total_cost_usd: 1 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: one
    agent: a
    prompt: first
`);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  assert.doesNotThrow(() => run.checkLimits()); // no sessions, no children: well under the limit

  run.childRuns.push({ cost_usd: 0.4 }, { cost_usd: 0.4 });
  assert.doesNotThrow(() => run.checkLimits()); // 0.8 of 1: still under

  run.childRuns.push({ cost_usd: 0.3 });
  assert.throws(() => run.checkLimits(), /Maximum cost exceeded \(US\$ 1, of which US\$ 1\.10 by its child runs\)\./);
});
test('on_error: a failing child workflow routes the step to its on_error step, with output.status failed', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-onerror }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
    on_error: after
  - id: after
    agent: a
    prompt: "child failed: {{ steps.child.output.error }}"
`);
  fs.writeFileSync(path.join(dir, 'child-fail.yaml'), CHILD_FAIL_YAML);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'child');
  assert.equal(step.output.status, 'failed');
  assert.equal(step.error, true);
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'child' && e.to === 'after' && e.when === 'on_error'));
  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'after');
  assert.match(sent.prompt, /child failed: Skill not found: "does-not-exist"/);
});
test('without on_error, a step\'s transitions can read output.status; without either, a failed child fails the run', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-transitions }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
    transitions:
      - when: "status == 'failed'"
        goto: handle
      - when: "status == 'success'"
        goto: end
  - id: handle
    agent: a
    prompt: "handling: {{ steps.child.output.error }}"
`);
  fs.writeFileSync(path.join(dir, 'child-fail.yaml'), CHILD_FAIL_YAML);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'child' && e.to === 'handle'));
  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'handle');
  assert.match(sent.prompt, /handling: Skill not found: "does-not-exist"/);

  // neither on_error nor transitions: the run itself fails with the reason named
  fs.writeFileSync(file, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-no-handler }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
`);
  const noHandler = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(noHandler.finished.status, 'failed');
  assert.match(noHandler.finished.error, /the child workflow child-fail\.yaml ended failed/);
});
test('a child\'s human gate keeps the parent waiting; the parent never answers it, and never finishes the step', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-gate }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-gate.yaml
`);
  fs.writeFileSync(path.join(dir, 'child-gate.yaml'), CHILD_GATE_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  let child = null;
  const childEvents = [];
  run.on('child', (c) => {
    child = c;
    c.on('event', (ev) => childEvents.push(ev));
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  const startP = run.start();
  await until(() => child && childEvents.some((e) => e.type === 'approval.requested'));
  assert.equal(run.orchestrator.status, 'waiting');
  assert.ok(!events.some((e) => e.type === 'approval.requested'));
  assert.ok(!events.some((e) => e.type === 'step.finished' && e.step_id === 'child'));

  const gateEv = childEvents.find((e) => e.type === 'approval.requested');
  child.resolveApproval(gateEv.approval_id, true);
  await startP;
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
});

test('type: workflow step: a child run gets the parent run\'s test workers in its agents\' environment (#367)', async (t) => {
  const promptOf = async (testWorkers) => {
    const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-workers }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-workers.yaml
`);
    fs.writeFileSync(path.join(dir, 'child-workers.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-workers }
agents:
  dev: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read, bash:npm] } }
steps:
  - { id: work, agent: dev, prompt: "Run the tests." }
`);
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
    const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, ...(testWorkers ? { testWorkers } : {}) });
    const childEvents = [];
    run.on('child', (c) => c.on('event', (ev) => childEvents.push(ev)));
    const events = [];
    run.on('event', (ev) => events.push(ev));
    await run.start();
    const finished = events.find((e) => e.type === 'workflow.finished');
    assert.equal(finished.status, 'success', finished.error);
    // the command guide of the child agent's prompt names the variables set in its environment
    const sent = childEvents.find((e) => e.type === 'session.message_sent' && e.step_id === 'work');
    assert.equal(typeof sent?.prompt, 'string', 'the child agent got a prompt');
    return sent.prompt;
  };
  const prompt = await promptOf(3);
  assert.match(prompt, /MULTIAGENT_TEST_WORKERS=3/);
  assert.match(prompt, /MULTIAGENT_E2E_WORKERS=3/);
  assert.doesNotMatch(await promptOf(null), /MULTIAGENT_TEST_WORKERS=/);
});
