// A fan-out step's `agent_when` and `required_agents` (#151, WorkflowRun.runFanOut): an agent whose
// condition is false this visit is skipped, and a required agent that fails fails the step even when
// `min_success` is met. The agents' turns are stubbed: only the fan-out's bookkeeping is under test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const YAML = `name: fanout-agent-when
inputs:
  task: { type: string, default: t }
agents:
  a: { provider: claude, model: m }
  b: { provider: claude, model: m }
steps:
  - id: review
    agents: [a, b]
    min_success: 1
    required_agents: [a]
    agent_when:
      b: "previous_step == 'shots'"
    prompt: Review.
    transitions:
      - when: "true"
        goto: end
`;

function makeRun(t, answers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-when-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, YAML);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs') });
  const ran = [];
  run.emitEvent = () => {};
  run.runAgentStep = async (step, st, name) => {
    ran.push(name);
    if (answers[name] instanceof Error) throw answers[name];
    return answers[name];
  };
  return { run, ran, step: run.wf.steps[0] };
}

test('agent_when: an agent whose condition is false is skipped, and min_success is capped at the agents that run', async (t) => {
  const { run, ran, step } = makeRun(t, { a: { verdict: 'approved' }, b: { ui: [] } });
  run.ctx.previous_step = 'develop';
  const out = await run.runFanOut(step, {});
  assert.deepEqual(ran, ['a']);
  assert.deepEqual(out.succeeded, ['a']);
  assert.deepEqual(out.skipped, ['b']);
});

test('agent_when: an agent whose condition holds runs with the others', async (t) => {
  const { run, ran, step } = makeRun(t, { a: { verdict: 'approved' }, b: { ui: [] } });
  run.ctx.previous_step = 'shots';
  const out = await run.runFanOut(step, {});
  assert.deepEqual(ran.sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(out.results).sort(), ['a', 'b']);
  assert.equal(out.skipped, undefined);
});

test('min_success: a failed optional agent does not fail the step', async (t) => {
  const { run, step } = makeRun(t, { a: { verdict: 'approved' }, b: new Error('boom') });
  run.ctx.previous_step = 'shots';
  const out = await run.runFanOut(step, {});
  assert.deepEqual(out.succeeded, ['a']);
  assert.deepEqual(out.failed, [{ agent: 'b', error: 'boom' }]);
});

test('required_agents: a failed required agent fails the step even when min_success is met', async (t) => {
  const { run, step } = makeRun(t, { a: new Error('down'), b: { ui: [] } });
  run.ctx.previous_step = 'shots';
  await assert.rejects(run.runFanOut(step, {}), /required: a/);
});
