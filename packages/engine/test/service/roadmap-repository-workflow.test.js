// A workflow only the repository declares (#485, e.g. ai-development-remote-hero) has no copy in the
// workspace or the bundled folder: the roadmap and the Backlog read it from the repository, as the run
// does (repository-workflows.js projectWorkflowFile), instead of stopping at "Workflow not found".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmapModel = require('../../domains/roadmap/roadmap');
const { makeService, roadmapIssue, untilTrue } = require('./helpers');
const { repoWithManifest } = require('../repo-workflow-fixtures-485');

const WITH_TASK = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: repo-flow
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issue: { type: string, default: "" }
agents:
  a: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: committed
    agent: a
    prompt: "do the work"
`;

async function repoProject(t) {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  const repo = repoWithManifest(t);
  repo.write({ '.multiagent/workflows/repo-flow.yaml': WITH_TASK });
  repo.commit('the flow takes a task');
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1)], pullRequests: [] }));
  return { api, service, ws, repo, project };
}

const listed = async (api, project) => (await api['workflows:list']({ projectId: project.id })).find((w) => w.origin === 'repository' && /repo-flow/.test(String(w.file)));

test('a roadmap item of an accepted repository-only workflow starts its run', async (t) => {
  const { api, ws, project } = await repoProject(t);
  const w = await listed(api, project);
  await api['workflows:accept']({ projectId: project.id, file: w.file, commit: w.commit });
  roadmapModel.saveStages(ws.backlog, project.id, [{ items: [{ workflow: 'repo-flow.yaml', number: 1, mock: true }] }], { issues: [roadmapIssue(1)] });
  await api['roadmap:start']({ projectId: project.id, simulated: true });
  const item = () => roadmapModel.readRoadmap(ws.backlog, project.id).stages[0].items[0];
  await untilTrue(() => item().runId || item().error);
  assert.equal(item().error || null, null);
  await untilTrue(() => api['runs:active']().length === 0);
});

test('an unaccepted repository-only workflow stops the roadmap asking for acceptance, not as not found', async (t) => {
  const { api, ws, project } = await repoProject(t);
  roadmapModel.saveStages(ws.backlog, project.id, [{ items: [{ workflow: 'repo-flow.yaml', number: 1, mock: true }] }], { issues: [roadmapIssue(1)] });
  await api['roadmap:start']({ projectId: project.id, simulated: true });
  const item = () => roadmapModel.readRoadmap(ws.backlog, project.id).stages[0].items[0];
  await untilTrue(() => item().error);
  assert.match(item().error, /not accepted/);
});
