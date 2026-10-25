// #554: the owner's edited workspace copy of a workflow wins over the repository's copy of the same
// name (#485 made the repository win), the owner's per-agent models apply whichever copy runs, no
// surprise "is not accepted" refusal for a copy that does not run, and the Workflows listing says
// which copy a project's run uses. Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   resolveWorkflow(name, dirs, { repo, preferRepository }) (packages/engine/domains/workflow/workflows.js)
//     dirs: [workspace, bundled]. The workspace copy's origin is workflowStatus(bundled, workspace)'s
//     (seeded by seedWorkflows): a 'modified' or 'custom' workspace copy wins over the repository's
//     copy of the same name (origin 'workspace'); the repository copy wins over an untouched
//     ('default') workspace copy or none (origin 'repository').
//     preferRepository: true (the project's "prefer the repository's workflows") -> the repository
//     copy wins even over a modified / custom workspace copy.
//   The project setting is `preferRepositoryWorkflows: true` (projects:update, like ignoreInstallScripts).
//   run:start({ file, projectId, mock }) (the path the roadmap dispatcher takes, areas/runs.js):
//     - runs the workspace's modified copy without asking for the repository copy's acceptance;
//     - with the repository copy taken (preferRepositoryWorkflows), the workspace copy's per-agent
//       provider / model / effort apply; workflow.started `agents.<a>` says where each came from
//       (some field mentioning the workspace);
//     - refusing an unaccepted repository copy, the error names the copy it took (the repository
//       and the commit's short sha).
//   workflows:list({ projectId }) entries carry `runs`, a text: the workspace copy that runs says
//     "runs: workspace copy (your models)"; the repository entry it shadows does not say it runs;
//     with no edited workspace copy the repository entry says "runs: repository @ <sha7>".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, makeRepo } = require('../repo-workflow-fixtures-485');

const loadWorkflows = () => require('../../domains/workflow/workflows');
const loadHelpers = () => require('../service/helpers');

const OWNER_MODEL = 'owner-model-554';
const REPO_MODEL = 'repo-model-554';
const BUNDLED_MODEL = 'bundled-model-554';

// One agent turn, read-only tools (within the repository caps of #485).
const flow = (name, { provider = 'claude', model, effort = null }) => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: ${name}
agents:
  a: { provider: ${provider}, model: ${model},${effort ? ` effort: ${effort},` : ''} session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

const MANIFEST = (name) => `version: 1
workflows:
  - name: ${name}
    file: workflows/${name}.yaml
    category: solo
`;

// ---- resolveWorkflow (packages/engine/domains/workflow/workflows.js) ---------------------------------------------------------

// A repository declaring `shared`, a bundled `shared` seeded into the workspace (origin 'default').
// workspace: 'default' (as seeded), 'modified' (seeded then edited), 'custom' (no bundled one, the
// owner's own file) or 'none'.
function resolveSetup(t, workspace) {
  const { seedWorkflows, workflowStatus } = loadWorkflows();
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': MANIFEST('shared'),
    '.multiagent/workflows/shared.yaml': flow('shared', { model: REPO_MODEL }),
  });
  const ws = tempDir(t, 'owner-ws-554-');
  const bundled = tempDir(t, 'owner-bundled-554-');
  if (workspace !== 'custom') fs.writeFileSync(path.join(bundled, 'shared.yaml'), flow('shared', { model: BUNDLED_MODEL }));
  seedWorkflows(bundled, ws);
  if (workspace === 'modified' || workspace === 'custom') fs.writeFileSync(path.join(ws, 'shared.yaml'), flow('shared', { model: OWNER_MODEL }));
  if (workspace === 'none') fs.rmSync(path.join(ws, 'shared.yaml'), { force: true });
  // the setup itself: the workspace copy has the origin the test means
  const st = workflowStatus(bundled, ws)['shared.yaml'];
  assert.equal(st ? st.origin : 'none', workspace, 'fixture: the workspace copy\'s origin');
  return { repo: repo.dir, dirs: [ws, bundled] };
}

const resolvedModel = (r) => {
  const text = fs.readFileSync(r.file, 'utf8');
  return [OWNER_MODEL, REPO_MODEL, BUNDLED_MODEL].find((m) => text.includes(m)) || null;
};

test('#554 resolveWorkflow: a modified workspace copy wins over the repository copy of the same name', (t) => {
  const { resolveWorkflow } = loadWorkflows();
  const { repo, dirs } = resolveSetup(t, 'modified');
  const r = resolveWorkflow('shared', dirs, { repo });
  assert.equal(r.origin, 'workspace');
  assert.equal(resolvedModel(r), OWNER_MODEL);
});

test('#554 resolveWorkflow: a custom workspace copy wins over the repository copy of the same name', (t) => {
  const { resolveWorkflow } = loadWorkflows();
  const { repo, dirs } = resolveSetup(t, 'custom');
  const r = resolveWorkflow('shared.yaml', dirs, { repo });
  assert.equal(r.origin, 'workspace');
  assert.equal(resolvedModel(r), OWNER_MODEL);
});

test('#554 resolveWorkflow: the repository copy wins over an untouched (default) workspace copy or none (guards #485)', (t) => {
  const { resolveWorkflow } = loadWorkflows();
  for (const workspace of ['default', 'none']) {
    const { repo, dirs } = resolveSetup(t, workspace);
    const r = resolveWorkflow('shared', dirs, { repo });
    assert.equal(r.origin, 'repository', workspace);
    assert.equal(resolvedModel(r), REPO_MODEL, workspace);
  }
});

test('#554 resolveWorkflow: preferRepository (the project\'s setting) makes the repository copy win over a modified workspace copy', (t) => {
  const { resolveWorkflow } = loadWorkflows();
  const { repo, dirs } = resolveSetup(t, 'modified');
  const r = resolveWorkflow('shared', dirs, { repo, preferRepository: true });
  assert.equal(r.origin, 'repository');
  assert.equal(resolvedModel(r), REPO_MODEL);
});

// ---- the service: run:start (the dispatcher's path) and workflows:list ---------------------------

// A project whose repository declares `writer-reviewer` with its own file (like this repository's
// ai-development-local-hero), and the workspace's seeded writer-reviewer.yaml: edited by the owner
// (`edited`, a different provider / model / effort for agent a) or left as seeded.
async function projectSetup(t, { edited }) {
  const { makeService } = loadHelpers();
  const { service, api } = makeService(t);
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': MANIFEST('writer-reviewer'),
    '.multiagent/workflows/writer-reviewer.yaml': flow('writer-reviewer', { provider: 'claude', model: REPO_MODEL }),
  });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  const wsFile = path.join(service.workspace().workflows, 'writer-reviewer.yaml');
  if (edited) fs.writeFileSync(wsFile, flow('writer-reviewer', { provider: 'codex', model: OWNER_MODEL, effort: 'high' }));
  const list = await api['workflows:list']({ projectId: project.id });
  const own = list.find((w) => w.file === 'writer-reviewer.yaml' && w.origin !== 'repository');
  const fromRepo = list.find((w) => w.origin === 'repository' && !w.error);
  // the setup itself: the workspace copy's origin and the repository entry
  assert.equal(own?.origin, edited ? 'modified' : 'default', 'fixture: the workspace copy\'s origin');
  assert.ok(fromRepo, 'fixture: the repository copy is listed');
  return { service, api, repo, project, own, fromRepo };
}

function startAndFinish(service, api, payload) {
  const events = [];
  let runId = null;
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev);
      if (ev.type === 'workflow.finished' && (!runId || ev.run_id === runId)) resolve(ev);
    });
  });
  return api['run:start'](payload).then(async (r) => {
    runId = r.runId;
    const end = await finished;
    return { ...r, end, started: events.find((e) => e.type === 'workflow.started' && e.run_id === runId) || null };
  });
}

test('#554 run:start for a project runs the owner\'s modified workspace copy, no acceptance asked for the unaccepted repository copy', async (t) => {
  const { service, api, project, fromRepo } = await projectSetup(t, { edited: true });
  assert.equal(fromRepo.accepted, false, 'fixture: the repository copy is not accepted');
  const { end, started } = await startAndFinish(service, api, { file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true });
  assert.equal(end.status, 'success', end.error);
  assert.equal(started?.agents?.a?.model, OWNER_MODEL);
});

test('#554 with "prefer the repository\'s workflows", the repository copy runs with the owner\'s per-agent provider, model and effort, and says where they came from', async (t) => {
  const { service, api, project, fromRepo } = await projectSetup(t, { edited: true });
  await api['projects:update']({ id: project.id, patch: { preferRepositoryWorkflows: true } });
  await api['workflows:accept']({ projectId: project.id, file: fromRepo.file, commit: fromRepo.commit });
  const { end, started } = await startAndFinish(service, api, { file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true });
  assert.equal(end.status, 'success', end.error);
  const a = started?.agents?.a || {};
  assert.equal(a.provider, 'codex');
  assert.equal(a.model, OWNER_MODEL);
  assert.equal(a.effort, 'high');
  // where each came from: the workspace copy (whatever the field is called)
  const { provider, model, effort, ...source } = a;
  assert.match(JSON.stringify(source), /workspace/i, 'workflow.started agents.a says the model came from the workspace copy');
  // and the repository copy is the one that ran: its file is the repository's
  assert.match(String(started?.file || ''), /writer-reviewer/);
});

test('#554 run:start with no edited workspace copy still refuses the unaccepted repository copy, naming the copy it took (repository @ sha)', async (t) => {
  const { api, repo, project } = await projectSetup(t, { edited: false });
  const sha = repo.head().slice(0, 7);
  await assert.rejects(
    async () => api['run:start']({ file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true }),
    (e) => /not accepted/i.test(e.message) && /repository/i.test(e.message) && e.message.includes(sha),
  );
  assert.equal(api['runs:active']().length, 0);
});

test('#554 workflows:list for a project: the owner\'s modified copy says it runs (your models), the repository copy it shadows does not', async (t) => {
  const { own, fromRepo } = await projectSetup(t, { edited: true });
  assert.match(String(own.runs || ''), /workspace copy/i);
  assert.match(String(own.runs || ''), /your models/i);
  assert.doesNotMatch(String(fromRepo.runs || ''), /runs: repository/i);
  assert.match(String(fromRepo.runs || ''), /workspace/i, 'the repository entry says the workspace copy runs instead');
});

test('#554 workflows:list for a project with no edited workspace copy: the repository entry says "runs: repository @ <sha>"', async (t) => {
  const { repo, own, fromRepo } = await projectSetup(t, { edited: false });
  const sha = repo.head().slice(0, 7);
  assert.match(String(fromRepo.runs || ''), new RegExp(`runs: repository @ ${sha}`, 'i'));
  assert.doesNotMatch(String(own.runs || ''), /runs: workspace/i, 'the untouched workspace copy does not run');
});
