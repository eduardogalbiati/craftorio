// #778: every build, check and suite step (and so their Retry, which enters the step again) starts with
// a dependency check (depsBeforeStep). A simulated run never links dependencies (prepareDeps returns at
// once), so this whole mock run records which steps the check ran before, through the run's own
// depsBeforeStep, replaced on the instance by a recorder that calls the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-deps-before-step-778 }
agents:
  builder: { provider: claude, model: m, session: ephemeral }
steps:
  - id: build
    agent: builder
    prompt: "build it"
  - id: check
    type: check
    command: "node --version"
  - id: suite
    type: suite
    command: "npm test"
`;

test('#778 a run checks its dependencies before the build (agent), check and suite steps', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-before-step-778-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const before = [];
  const started = [];
  const real = run.depsBeforeStep;
  assert.equal(typeof real, 'function', 'the run has a depsBeforeStep');
  run.depsBeforeStep = async function (step) {
    before.push({ id: step.id, startedSoFar: started.length });
    return real.call(this, step);
  };
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'step.started') started.push(ev.step_id);
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.ok(finished, 'the run finished');
  const ids = before.map((b) => b.id);
  for (const id of ['build', 'check', 'suite']) assert.equal(ids.includes(id), true, `checked before ${id}: ${JSON.stringify(ids)}`);
  // the check of a step runs after that step started and before the next one did
  for (const b of before) {
    const idx = started.indexOf(b.id);
    assert.equal(idx >= 0 && idx < b.startedSoFar + 1, true, `${b.id}: ${JSON.stringify({ started, b })}`);
  }
});
