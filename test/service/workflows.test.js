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

// ---- #137: declared outputs (top-level `outputs:`) and saved pipelines -----------------------

test('listWorkflows: declared outputs are the top-level "outputs:", a list or a map, by name', (t) => {
  const { api, service } = makeService(t);
  const listYaml = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: out-list
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
outputs:
  - summary
  - { name: pr_url }
`;
  const mapYaml = `apiVersion: multiagent/v1
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
  summary: { type: string }
  pr_url: { type: string }
`;
  fs.writeFileSync(path.join(service.workspace().workflows, 'out-list.yaml'), listYaml);
  fs.writeFileSync(path.join(service.workspace().workflows, 'out-map.yaml'), mapYaml);
  const list = api['workflows:list']();
  assert.deepEqual(list.find((w) => w.file === 'out-list.yaml').outputs, ['summary', 'pr_url']);
  assert.deepEqual(list.find((w) => w.file === 'out-map.yaml').outputs, ['summary', 'pr_url']);
  assert.deepEqual(list.find((w) => w.file === 'fixture-service.yaml').outputs, []); // no outputs: declared
});

test('listPipelines: a valid pipeline returns its stages, each with its "when" and "map"', (t) => {
  const { api, service } = makeService(t);
  const dir = path.join(service.workspace().root, 'pipelines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'p1.yaml'), `name: Issue to dev
description: From the tracker to a development run
category: build
stages:
  - workflow: fixture-service.yaml
  - workflow: fixture-service.yaml
    when: success
    map: { issues: issues }
`);
  const pipelines = api['workflows:pipelines']();
  assert.equal(pipelines.length, 1);
  const p = pipelines[0];
  assert.equal(p.name, 'Issue to dev');
  assert.equal(p.description, 'From the tracker to a development run');
  assert.equal(p.category, 'build');
  assert.equal(p.stages.length, 2);
  assert.deepEqual(p.stages[0], { workflow: 'fixture-service.yaml', when: null, map: {} });
  assert.deepEqual(p.stages[1], { workflow: 'fixture-service.yaml', when: 'success', map: { issues: 'issues' } });
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

test('listPipelines: a missing pipelines folder returns no pipelines', (t) => {
  const { api } = makeService(t);
  assert.deepEqual(api['workflows:pipelines'](), []);
});
