// #71 What a run recorded as tested ("no tests") reaches its roadmap item: the transition's `set`, the
// run's summary.json, its row and roadmap:get's item (areas/roadmap.js), through a simulated run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, roadmapProject, until } = require('./helpers');

const workflow = (set) => `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-tested-71 }
inputs:
  task: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }
    transitions:
      - { when: "true", goto: end${set} }
`;

for (const [name, set, tested] of [['no tests', ', set: { tested: "no tests" }', 'no tests'], ['tested green', '', undefined]]) {
  test(`#71 roadmap: the item of a run recorded as ${name}`, async (t) => {
    const { service, api } = makeService(t);
    const ws = service.workspace();
    fs.writeFileSync(path.join(ws.workflows, 'fixture-tested-71.yaml'), workflow(set));
    const p = await roadmapProject(api, ws, t, [1], `tested-71-${tested ? 'none' : 'green'}`);
    await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-tested-71.yaml', number: 1, mock: true }] }] });
    await api['roadmap:start']({ projectId: p.id, simulated: true });
    const item = () => api['roadmap:get']({ projectId: p.id }).stages[0].items[0];
    await until(() => item().status === 'done');
    assert.equal(item().tested, tested);
  });
}
