// #785: the drawer no longer sends a workflow or options with its questions, so the live roadmap's refill
// (productOwner.lastWorkflow, #235) finds them only in a conversation recorded before the change. Either
// way, the refilled item keeps only what was chosen, never a workflow's defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until, watchRuns } = require('./helpers');

const pickable = (number, complexity) => ({ ...roadmapIssue(number), body: 'x'.repeat(130), labels: [{ name: `complexity:${complexity}` }] });
const ASK = { question: 'Analisar o backlog e propor runs', mock: true, attachments: [], issues: [] };

async function setup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chosen.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-chosen'));
  const p = await roadmapProject(api, ws, t, [1], name);
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), pickable(2, 1)],
  }));
  return { service, api, p };
}

// the only stage ends with the roadmap live: the item of the stage the refill adds
async function refilledItem({ service, api, p }) {
  const { gates } = watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });
  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).stages.length === 2);
  return api['roadmap:get']({ projectId: p.id }).stages[1].items[0];
}

test('#785 after a drawer question with no workflow, the refill stores no input', async (t) => {
  const s = await setup(t, 'live-785-new');
  await s.api['po:ask']({ ...ASK, projectId: s.p.id, mode: 'auto', workflow: null, inputs: null });
  const item = await refilledItem(s);
  assert.deepEqual(item.inputs || {}, {});
});

test('#785 a workflow recorded before the change still leads the refill, with none of its defaults', async (t) => {
  const s = await setup(t, 'live-785-old');
  await s.api['po:ask']({ ...ASK, projectId: s.p.id, mode: 'plan', workflow: 'fixture-chosen.yaml', inputs: { language: 'js' } });
  await s.api['po:ask']({ ...ASK, projectId: s.p.id, mode: 'auto', workflow: null, inputs: null });
  const item = await refilledItem(s);
  assert.deepEqual([item.workflow, item.inputs || {}], ['fixture-chosen.yaml', {}]);
});
