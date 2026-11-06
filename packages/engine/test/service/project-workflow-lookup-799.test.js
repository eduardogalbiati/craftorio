// #799, criterion 2: one lookup everywhere. Where a project is known, the areas that read a workflow
// find it as a run does (ctx.projectWorkflowFile, repository-workflows.js): a chain's next workflow,
// a saved pipeline's stages, the workflow a push conflict is handed to and the release workflow.
// Today they read ctx.workflowPath, which never sees a workflow only the repository declares.
//
// Acceptance tests written before the code, through the channels. Not here: chain.js:229 (finishedRun's
// outputDefs): nothing reads them after that line, so no channel shows the difference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmapModel = require('../../domains/roadmap/roadmap');
const { makeService, roadmapIssue, untilTrue } = require('./helpers');
const { makeRepo, repoWithManifest, tempDir } = require('../repo-workflow-fixtures-485');

const REPO_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: repo-flow
inputs:
  task: { type: string, default: "the work" }
agents:
  a: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: committed
    agent: a
    prompt: "do the work"
`;

// the first run of a chain: a workspace workflow; model `x` lets a test make it fail
const FIRST_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-first-799
agents:
  a: { provider: claude, model: x, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

const PIPELINE = `name: Repo Pipe
category: build
stages:
  - workflow: repo-flow.yaml
  - workflow: repo-flow.yaml
`;

const THEN_REPO = { action: 'workflow', workflow: 'repo-flow.yaml' };

const firstEvent = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n')[0]);
const call = async (api, channel, arg) => api[channel](arg); // a sync throw becomes a rejection

async function acceptAll(api, project) {
  for (const w of (await api['workflows:list']({ projectId: project.id })).filter((x) => x.origin === 'repository')) {
    if (!w.accepted) await api['workflows:accept']({ projectId: project.id, file: w.file, commit: w.commit });
  }
}

// A project whose repository alone declares repo-flow.yaml; `accepted: false` leaves it to be accepted.
async function repoProject(t, { accepted = true } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-first-799.yaml'), FIRST_FLOW);
  const repo = repoWithManifest(t, { flow: REPO_FLOW });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  if (accepted) await acceptAll(api, project);
  return { service, api, ws, repo, project };
}

// The chain of a run once it left `waiting`: it started the next run, or paused.
async function settledChain(api, runId) {
  const state = () => { try { return api['chain:get']({ runId })?.state; } catch { return null; } };
  await untilTrue(() => ['started', 'paused', 'done'].includes(state()));
  return api['chain:get']({ runId });
}

function writePipeline(ws) {
  fs.mkdirSync(ws.pipelines, { recursive: true });
  fs.writeFileSync(path.join(ws.pipelines, 'repo-pipe.yaml'), PIPELINE);
}

// ---- chain.js: a run's next workflow ------------------------------------------------------------

test('#799 a run\'s chain starts a workflow only the repository declares', async (t) => {
  const { api, project } = await repoProject(t);
  const { runId } = await api['run:start']({ file: 'fixture-first-799.yaml', inputs: {}, mock: true, projectId: project.id, then: THEN_REPO });
  const chain = await settledChain(api, runId);
  assert.equal(chain.state, 'started', chain.reason);
  assert.equal(api['runs:events']({ runId: chain.nextRunId }).find((e) => e.type === 'workflow.started').file, 'repo-flow.yaml');
});

test('#799 a paused chain resumes into a workflow only the repository declares', async (t) => {
  const { api, project } = await repoProject(t);
  const { runId } = await api['run:start']({ file: 'fixture-first-799.yaml', inputs: {}, mock: true, projectId: project.id, then: THEN_REPO, mockSequences: { usage_limits: ['claude:x'] } });
  assert.equal((await settledChain(api, runId)).state, 'paused');
  const chain = await api['chain:resume']({ runId });
  assert.equal(chain.state, 'started', chain.reason);
});

test('#799 a chain to a repository workflow not accepted pauses saying so, not as not found', async (t) => {
  const { api, project } = await repoProject(t, { accepted: false });
  const { runId } = await api['run:start']({ file: 'fixture-first-799.yaml', inputs: {}, mock: true, projectId: project.id, then: THEN_REPO });
  const chain = await settledChain(api, runId);
  assert.equal(chain.state, 'paused');
  assert.match(chain.reason, /not accepted/);
});

// ---- pipelines.js: a saved pipeline in a project ------------------------------------------------

test('#799 a pipeline of a project starts with a stage only the repository declares', async (t) => {
  const { api, ws, project } = await repoProject(t);
  writePipeline(ws);
  const started = await call(api, 'pipelines:run', { file: 'repo-pipe.yaml', mock: true, projectId: project.id });
  assert.equal(firstEvent(started.runDir).file, 'repo-flow.yaml');
});

test('#799 a pipeline of a project goes on to its next repository-only stage', async (t) => {
  const { api, ws, project } = await repoProject(t);
  writePipeline(ws);
  const started = await call(api, 'pipelines:run', { file: 'repo-pipe.yaml', mock: true, projectId: project.id });
  const chain = await settledChain(api, started.runId);
  assert.equal(chain.state, 'started', chain.reason);
});

test('#799 the Backlog assigns a pipeline whose first stage only the repository declares', async (t) => {
  const { api, ws, project } = await repoProject(t);
  writePipeline(ws);
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1)], pullRequests: [] }));
  await call(api, 'backlog:assign', { projectId: project.id, numbers: [1], pipeline: 'repo-pipe.yaml', mock: true });
  const items = roadmapModel.readRoadmap(ws.backlog, project.id).stages.flatMap((s) => s.items);
  assert.deepEqual(items.map((i) => i.workflow), ['repo-flow.yaml']);
});

test('#799 a run\'s chain of repository-only workflows is saved as a pipeline', async (t) => {
  const { api, ws, project } = await repoProject(t);
  const { runId } = await api['run:start']({ file: 'repo-flow.yaml', inputs: {}, mock: true, projectId: project.id, then: THEN_REPO });
  await settledChain(api, runId);
  const saved = await call(api, 'pipelines:save', { runId, name: 'Saved repo pipe', category: 'build' });
  assert.equal(saved.name, 'Saved repo pipe');
  assert.equal(fs.existsSync(path.join(ws.pipelines, saved.file)), true);
});

// ---- local-push.js: a push conflict -------------------------------------------------------------

test('#799 a push conflict is handed to the repository-only workflow that merged there last', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = repoWithManifest(t, { flow: REPO_FLOW });
  const tmp = tempDir(t, 'push-799-');
  const origin = path.join(tmp, 'origin.git');
  const other = path.join(tmp, 'other');
  repo.git('init', '-q', '--bare', origin);
  repo.git('remote', 'add', 'origin', origin);
  repo.git('push', '-q', '-u', 'origin', 'main');
  repo.git('clone', '-q', '-b', 'main', origin, other);
  repo.git('-C', other, 'commit', '-q', '--allow-empty', '-m', 'their change');
  repo.git('-C', other, 'push', '-q', 'origin', 'main');
  const mine = repo.commit('my change');
  repo.git('fetch', '-q', 'origin');

  const project = await api['projects:create']({ name: 'local', folder: repo.dir });
  await acceptAll(api, project);
  // the run of the repository's workflow that merged locally last
  const runDir = path.join(ws.runs, 'run-local-799');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', file: 'repo-flow.yaml', project_id: project.id, inputs: {} })}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local-799', workflow: 'repo-flow', project_id: project.id, status: 'success', started_at: '2026-09-29T10:00:00Z',
    inputs: {}, sessions: [], worktree: { repo: repo.dir }, local_merge: { branch: 'feat/one', base: 'main', commit: mine },
  }));

  const started = await call(api, 'backlog:resolve-push', { projectId: project.id, files: ['a.txt'], mock: true });
  const first = firstEvent(started.runDir);
  assert.equal(first.file, 'repo-flow.yaml');
  assert.match(first.inputs.task, /git merge origin\/main/);
});

// ---- releases.js: the project's own release workflow --------------------------------------------

test('#799 a release takes the inputs of the release workflow the repository declares', async (t) => {
  const { api } = makeService(t);
  const release = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: repo-release
inputs:
  task: { type: string, default: "" }
  version: { type: string, default: "" }
  docs_dir: { type: string, default: "" }
agents:
  a: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: check
    agent: a
    prompt: "check the release"
`;
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': 'version: 1\nworkflows:\n  - name: release\n    file: workflows/release.yaml\n    category: solo\n',
    '.multiagent/workflows/release.yaml': release,
  });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  await acceptAll(api, project);
  const started = await call(api, 'releases:start', { projectId: project.id, simulated: true });
  assert.equal(firstEvent(started.runDir).workflow, 'repo-release');
  assert.equal(firstEvent(started.runDir).inputs.docs_dir, project.folder);
});
