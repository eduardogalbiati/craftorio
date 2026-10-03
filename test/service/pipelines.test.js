// Service area: saved pipelines (#135, src/service/areas/pipelines.js). test/pipelines.test.js
// covers src/pipelines.js alone (parsing, validation, the chain it builds, seeding); this file only
// checks that a real run, through the service, really starts every stage in turn (or pauses, or
// stops at a bad mapping), the way test/service/chain.test.js checks a phase-1 chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, until, untilTrue } = require('./helpers');

// Three small fixture workflows chained like a pipeline: stage 1 has a review gate (accept/fail,
// like the issue tracker's), stage 2 and 3 take the previous stage's declared output and add to it,
// so a mapped value can be told apart from the workflow's own default.
const PL_ONE = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: pl-one
inputs:
  task: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
  - id: review
    type: human_approval
    message: "Accept?"
    choices:
      - { id: accept, label: Accept }
      - { id: fail, label: Fail }
    transitions:
      - when: "choice == 'fail'"
        goto: end
        status: failed
      - when: "true"
        goto: end
outputs:
  summary:
    type: string
    value: "{{ inputs.task }} done"
`;

const PL_TWO = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: pl-two
inputs:
  summary: { type: string, default: "" }
  task: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
outputs:
  report:
    type: string
    value: "{{ inputs.summary }} -> stage2"
`;

const PL_THREE = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: pl-three
inputs:
  report: { type: string, default: "" }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do stage3"
`;

const PIPE_TWO = `name: Pipe Two
category: build
stages:
  - workflow: pl-one.yaml
  - workflow: pl-two.yaml
    map:
      summary: summary
      task: summary
`;

const PIPE_THREE = `name: Pipe Three
category: build
stages:
  - workflow: pl-one.yaml
  - workflow: pl-two.yaml
    map:
      summary: summary
      task: summary
  - workflow: pl-three.yaml
    map:
      report: report
`;

function writeFixtures(ws) {
  fs.writeFileSync(path.join(ws.workflows, 'pl-one.yaml'), PL_ONE);
  fs.writeFileSync(path.join(ws.workflows, 'pl-two.yaml'), PL_TWO);
  fs.writeFileSync(path.join(ws.workflows, 'pl-three.yaml'), PL_THREE);
}

function writePipeline(ws, file, text) {
  fs.mkdirSync(ws.pipelines, { recursive: true });
  fs.writeFileSync(path.join(ws.pipelines, file), text);
}

// Resolves the first `approval.requested` of `stepId` for `runId` with `answer` (see test/service/chain.test.js).
function autoApprove(service, runId, stepId, answer) {
  const onEv = (ev) => {
    if (ev.run_id === runId && ev.type === 'approval.requested' && ev.step_id === stepId) {
      service.events.off('run:event', onEv);
      service.api['approval:resolve']({ runId, id: ev.approval_id, answer });
    }
  };
  service.events.on('run:event', onEv);
}

test('pipelines:run: a 2-stage mock pipeline runs both workflows with the mapped inputs; the pipeline id is the first run\'s', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  writePipeline(ws, 'pipe-two.yaml', PIPE_TWO);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1, pipelineId } = await api['pipelines:run']({ file: 'pipe-two.yaml', inputs: { task: 'Do it' }, mock: true });
  assert.equal(pipelineId, runId1);
  autoApprove(service, runId1, 'review', 'accept');

  await untilTrue(() => started.some((e) => e.file === 'pl-two.yaml'));
  const run2 = started.find((e) => e.file === 'pl-two.yaml');
  assert.equal(run2.inputs.summary, 'Do it done');
  assert.equal(run2.inputs.task, 'Do it done');
  assert.equal(run2.from.run_id, runId1);
  assert.equal(run2.from.workflow, 'pl-one');
  assert.deepEqual(run2.from.pipeline, { id: runId1, file: 'pipe-two.yaml', name: 'Pipe Two', stage: 1, stages: 2 });
});

test('pipelines:run: a 3-stage pipeline nests `then` and stamps the same pipeline run id on every stage after the first', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  writePipeline(ws, 'pipe-three.yaml', PIPE_THREE);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1 } = await api['pipelines:run']({ file: 'pipe-three.yaml', inputs: { task: 'Go' }, mock: true });
  autoApprove(service, runId1, 'review', 'accept');

  await untilTrue(() => started.some((e) => e.file === 'pl-two.yaml'));
  const run2 = started.find((e) => e.file === 'pl-two.yaml');
  assert.deepEqual(run2.from.pipeline, { id: runId1, file: 'pipe-three.yaml', name: 'Pipe Three', stage: 1, stages: 3 });

  await untilTrue(() => started.some((e) => e.file === 'pl-three.yaml'));
  const run3 = started.find((e) => e.file === 'pl-three.yaml');
  assert.deepEqual(run3.from.pipeline, { id: runId1, file: 'pipe-three.yaml', name: 'Pipe Three', stage: 2, stages: 3 });
  assert.equal(run3.inputs.report, 'Go done -> stage2');
});

test('pipelines:run: a failed stage pauses the pipeline; the owner\'s resume continues with the rest', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  writePipeline(ws, 'pipe-two.yaml', PIPE_TWO);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1 } = await api['pipelines:run']({ file: 'pipe-two.yaml', inputs: { task: 'Oops' }, mock: true });
  autoApprove(service, runId1, 'review', 'fail');

  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'paused');
  assert.equal(started.filter((e) => e.file === 'pl-two.yaml').length, 0, 'the second stage never started');

  await api['chain:resume']({ runId: runId1 });
  await untilTrue(() => started.some((e) => e.file === 'pl-two.yaml'));
  assert.equal(api['chain:get']({ runId: runId1 }).state, 'started');
});

test('pipelines:get-run: lists each stage\'s run and status, and the current stage', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  writePipeline(ws, 'pipe-two.yaml', PIPE_TWO);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1, pipelineId } = await api['pipelines:run']({ file: 'pipe-two.yaml', inputs: { task: 'Z' }, mock: true });
  autoApprove(service, runId1, 'review', 'accept');
  await untilTrue(() => started.some((e) => e.file === 'pl-two.yaml'));
  const runId2 = started.find((e) => e.file === 'pl-two.yaml').run_id;

  const info = api['pipelines:get-run']({ id: pipelineId });
  assert.equal(info.id, pipelineId);
  assert.equal(info.name, 'Pipe Two');
  assert.equal(info.runs.length, 2);
  assert.equal(info.runs[0].runId, runId1);
  assert.equal(info.runs[1].runId, runId2);
  assert.equal(info.runs[1].workflow, 'pl-two');
  assert.equal(info.current, 1);
  assert.throws(() => api['pipelines:get-run']({ id: 'nope' }), /Pipeline run not found/);
});

test('workflows:pipelines / pipelines:run: a mapping to an output the previous workflow doesn\'t declare is refused, naming the pipeline, stage, workflow and output', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  writePipeline(ws, 'pipe-bad.yaml', 'name: Pipe Bad\nstages:\n  - workflow: pl-one.yaml\n  - workflow: pl-two.yaml\n    map:\n      task: nope\n');

  const list = api['workflows:pipelines']();
  const bad = list.find((p) => p.file === 'pipe-bad.yaml');
  assert.match(bad.error, /Pipe Bad/);
  assert.match(bad.error, /stage 2 \(pl-two\.yaml\)/);
  assert.match(bad.error, /output "nope"/);
  assert.match(bad.error, /pl-one\.yaml does not declare/);
  assert.deepEqual(bad.stages, []);

  await assert.rejects(api['pipelines:run']({ file: 'pipe-bad.yaml', inputs: {}, mock: true }), /output "nope".*pl-one\.yaml does not declare/s);
});

test('pipelines:save: a hand-made chain is saved as a pipeline, loads back with the same stages, and a duplicate name is refused', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  const { runId } = await api['run:start']({
    file: 'pl-one.yaml', inputs: { task: 'Z' }, mock: true,
    then: { action: 'workflow', workflow: 'pl-two.yaml', map: { summary: 'summary', task: 'summary' } },
  });

  const saved = await api['pipelines:save']({ runId, name: 'My Saved Pipe', description: 'desc', category: 'build' });
  assert.equal(saved.file, 'my-saved-pipe.yaml');
  assert.equal(saved.name, 'My Saved Pipe');

  const list = api['workflows:pipelines']();
  const found = list.find((p) => p.file === 'my-saved-pipe.yaml');
  assert.ok(found, 'the saved pipeline loads without error');
  assert.equal(found.description, 'desc');
  assert.equal(found.stages.length, 2);
  assert.equal(found.stages[0].workflow, 'pl-one.yaml');
  assert.equal(found.stages[1].workflow, 'pl-two.yaml');
  assert.deepEqual(found.stages[1].map, { summary: 'summary', task: 'summary' });

  // savePipeline is synchronous (no file is read over the network): it throws, rather than rejecting.
  assert.throws(() => api['pipelines:save']({ runId, name: 'My Saved Pipe' }), /already exists/);
});

test('pipelines:save: a run without a chain cannot be saved', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  const { runId } = await api['run:start']({ file: 'pl-one.yaml', inputs: { task: 'No chain' }, mock: true });

  assert.throws(() => api['pipelines:save']({ runId, name: 'X' }), /no chain to save/);
});

test('pipelines:restore: the user\'s edited copy of a bundled pipeline is trashed and replaced with the default', async (t) => {
  const { service, api, trashed } = makeService(t);
  const ws = service.workspace();
  const before = api['workflows:pipelines']().find((p) => p.origin === 'default');
  assert.ok(before, 'at least one bundled pipeline is seeded by default');
  fs.writeFileSync(path.join(ws.pipelines, before.file), `name: Edited\nstages:\n  - workflow: a.yaml\n  - workflow: b.yaml\n`);
  assert.equal(api['workflows:pipelines']().find((p) => p.file === before.file).origin, 'modified');

  await api['pipelines:restore'](before.file);

  assert.equal(trashed.length, 1);
  const after = api['workflows:pipelines']().find((p) => p.file === before.file);
  assert.equal(after.origin, 'default');
  assert.equal(after.name, before.name);
});

test('backlog:assign with a pipeline: its first workflow receives the issues, with the pipeline\'s fixed inputs and the rest of the pipeline as the chain', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  writeFixtures(ws);
  writePipeline(ws, 'pipe-backlog.yaml', 'name: Pipe Backlog\ncategory: build\nstages:\n  - workflow: fixture-issue.yaml\n    inputs:\n      language: go\n  - workflow: pl-three.yaml\n');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-pipe-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ number: 1, title: 'Issue 1', state: 'open', url: 'https://github.com/o/r/issues/1', body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } }],
  }));
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  await api['backlog:assign']({ projectId: p.id, numbers: [1], mock: true, pipeline: 'pipe-backlog.yaml' });

  await until(() => started.some((e) => e.file === 'fixture-issue.yaml'));
  const run1 = started.find((e) => e.file === 'fixture-issue.yaml');
  assert.equal(run1.inputs.language, 'go');
  assert.equal(run1.then.workflow, 'pl-three.yaml');
  assert.equal(run1.then.pipeline.file, 'pipe-backlog.yaml');
  assert.equal(run1.then.pipeline.stage, 1);
});
