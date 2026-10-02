const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

test('builder: bundled workflows open read-only and clone into an editable copy', async (t) => {
  const { api, service } = makeService(t);
  const ro = api['builder:load']('writer-reviewer.yaml');
  assert.equal(ro.mode, 'readonly');
  assert.ok(ro.spec.fixed && ro.problems.length);
  assert.throws(() => api['builder:save']({ file: 'writer-reviewer.yaml', spec: ro.spec }), /bundled with the app: clone it/);

  const { file } = api['builder:clone']('writer-reviewer.yaml');
  assert.equal(file, 'writer-reviewer-copy.yaml');
  assert.equal(api['builder:clone']('writer-reviewer.yaml').file, 'writer-reviewer-copy-2.yaml');
  const copy = api['builder:load'](file);
  assert.equal(copy.mode, 'fixed');
  assert.equal(copy.spec.name, 'writer-reviewer-copy');
  copy.spec.agents.signoff.effort = 'low';
  api['builder:save']({ file, spec: copy.spec });
  const listed = api['workflows:list']().find((w) => w.file === file);
  assert.equal(listed.origin, 'custom');
  assert.match(fs.readFileSync(path.join(service.workspace().workflows, file), 'utf8'), /^# =+/); // comments kept

  // a hand-written workflow the builder can't draw keeps its steps; one it made is fully editable
  assert.equal(api['builder:load']('fixture-service.yaml').mode, 'fixed');
  const desk = { id: 'a', kind: 'agent', brief: 'Do it.', context: true, access: 'read', agent: { source: 'custom', provider: 'claude', model: 'claude-opus-5-5', effort: 'default', system_prompt: 'You do it.', skills: [] } };
  const made = api['builder:save']({ file: null, spec: { name: 'Made here', description: '', category: 'build', steps: [desk] } });
  assert.equal(made.file, 'made-here.yaml');
  assert.equal(api['builder:load'](made.file).mode, 'full');
});

// ---- #137: declared outputs (top-level `outputs:`, #134) and saved pipelines ------------------

test('listWorkflows: declared outputs are the engine\'s own map (name -> { type, description, value }); none declared is {}', (t) => {
  const { api, service } = makeService(t);
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: out-map
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
outputs:
  summary: { type: string, description: "What changed", value: "{{ steps.work.output.summary }}" }
  pr_url: { type: string, value: "{{ steps.work.output.pr_url }}" }
`;
  fs.writeFileSync(path.join(service.workspace().workflows, 'out-map.yaml'), yaml);
  const list = api['workflows:list']();
  const withOutputs = list.find((w) => w.file === 'out-map.yaml');
  assert.deepEqual(Object.keys(withOutputs.outputs), ['summary', 'pr_url']);
  assert.equal(withOutputs.outputs.summary.description, 'What changed');
  assert.equal(withOutputs.outputs.summary.type, 'string');
  assert.deepEqual(list.find((w) => w.file === 'fixture-service.yaml').outputs, {}); // no outputs: declared
});

test('workflows:pipelines (#135): a valid pipeline returns its stages, each with its target, condition, inputs and map', (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-pipe-a.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pipe-a
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
outputs:
  issues:
    type: array
    value: "{{ steps.work.output.issues }}"
`);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-pipe-b.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pipe-b
inputs:
  issues: { type: array, default: [] }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
`);
  fs.mkdirSync(ws.pipelines, { recursive: true });
  fs.writeFileSync(path.join(ws.pipelines, 'p1.yaml'), `name: Issue to dev
description: From the tracker to a development run
category: build
stages:
  - workflow: fixture-pipe-a.yaml
  - workflow: fixture-pipe-b.yaml
    on: success
    map: { issues: issues }
`);
  const p = api['workflows:pipelines']().find((x) => x.file === 'p1.yaml');
  assert.ok(p, 'the pipeline loads without error');
  assert.equal(p.name, 'Issue to dev');
  assert.equal(p.description, 'From the tracker to a development run');
  assert.equal(p.category, 'build');
  assert.equal(p.stages.length, 2);
  assert.deepEqual(p.stages[0], { workflow: 'fixture-pipe-a.yaml', target: 'workflow', on: 'success', inputs: {}, map: {} });
  assert.deepEqual(p.stages[1], { workflow: 'fixture-pipe-b.yaml', target: 'workflow', on: 'success', inputs: {}, map: { issues: 'issues' } });
});

test('listPipelines: a pipeline without stages, or a stage missing its workflow, comes back as an error entry', (t) => {
  const { api, service } = makeService(t);
  const dir = path.join(service.workspace().root, 'pipelines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'empty.yaml'), 'name: Empty\n');
  fs.writeFileSync(path.join(dir, 'bad-stage.yaml'), 'name: Bad\nstages:\n  - when: success\n');
  const pipelines = api['workflows:pipelines']();
  const empty = pipelines.find((p) => p.file === 'empty.yaml');
  const bad = pipelines.find((p) => p.file === 'bad-stage.yaml');
  assert.match(empty.error, /stages/);
  assert.deepEqual(empty.stages, []);
  assert.match(bad.error, /stages/);
  assert.deepEqual(bad.stages, []);
});

test('workflows:pipelines (#135): a fresh workspace already lists the bundled default pipelines, seeded like the workflows', (t) => {
  const { api } = makeService(t);
  const pipelines = api['workflows:pipelines']();
  assert.ok(pipelines.length >= 4, 'the 4 bundled pipelines (#135) are seeded into a fresh workspace');
  assert.ok(pipelines.every((p) => !p.error), pipelines.map((p) => p.error).filter(Boolean).join('; '));
  assert.ok(pipelines.every((p) => p.origin === 'default'));
});
