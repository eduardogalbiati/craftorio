// #790: one order everywhere. The Product Owner's roadmap.add, its plans and the live roadmap's refill use
// the project's default, in the project order, with no setting behind it. Acceptance tests, written
// before the code. Seams: the channels po:request and po:ask (simulated: no model) and a roadmap's live
// refill, driven as live-roadmap-785.test.js drives it. The chains and the Oracle pass the same value:
// they are held by the source scan of test/project-default-repository-790-791.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, until, watchRuns } = require('./helpers');

const MANIFEST = 'version: 1\ndefault: fixture-manifest\nworkflows:\n  - name: fixture-manifest\n    category: solo\n';
const pickable = (number) => ({ ...roadmapIssue(number), body: 'x'.repeat(130), labels: [{ name: 'complexity:1' }] });

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-manifest.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-manifest'));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'po-790-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, '.multiagent'));
  fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), MANIFEST);
  const p = await api['projects:create']({ name: 'po-790', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), pickable(2)] }));
  return { service, api, p };
}

const itemWorkflows = (roadmap) => (roadmap?.stages || []).flatMap((s) => (s.items || []).map((x) => x.workflow));

test('#790 roadmap.add puts a new item on the manifest\'s default', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t);
  await api['po:request']({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1] }, reason: 'ready', from: 'oracle', ref: 'r-790', mock: true });
  assert.deepEqual(itemWorkflows(await api['roadmap:get']({ projectId: p.id })), ['fixture-manifest.yaml']);
});

test('#790 a simulated plan puts its groups on the manifest\'s default', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t);
  const out = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true });
  assert.deepEqual([...new Set((out?.message?.answer?.groups || []).map((g) => g.workflow))], ['fixture-manifest.yaml']);
});

test('#790 a live roadmap\'s refill puts its item on the manifest\'s default', { timeout: 60000 }, async (t) => {
  const { service, api, p } = await setup(t);
  const { gates } = watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });
  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).stages.length === 2);
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[1].items[0].workflow, 'fixture-manifest.yaml');
});
