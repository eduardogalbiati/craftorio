// #554 (review): the edges of "the owner's edited workspace copy wins" through the service
// (test/service/helpers.js): the owner's per-agent values that are templated or belong to an agent
// the repository's copy lacks, a broken owner copy with "prefer the repository's workflows", a
// manifest entry whose name differs from its file (the listing and the run agree), and the roadmap's
// dispatcher on an item that names the owner's edited copy (no pause for acceptance).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeRepo } = require('../repo-workflow-fixtures-485');
const { makeService, roadmapIssue, until } = require('./helpers');

const OWNER_MODEL = 'owner-model-554';
const REPO_MODEL = 'repo-model-554';

// agents: { <name>: '<inline yaml map body>' }
const flow = (name, agents, extra = '') => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: ${name}
${extra}agents:
${Object.entries(agents).map(([a, body]) => `  ${a}: { ${body}, session: ephemeral, capabilities: { tools: [read] } }`).join('\n')}
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

const manifest = (name, file) => `version: 1
workflows:
  - name: ${name}
    file: workflows/${file}
    category: solo
`;

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
    return { end, started: events.find((e) => e.type === 'workflow.started' && e.run_id === runId) || null };
  });
}

// a project whose repository declares writer-reviewer (agent a on claude / REPO_MODEL), accepted, with
// the project preferring the repository's workflows; the workspace's copy is `owner` (a text)
async function preferRepositorySetup(t, owner) {
  const { service, api } = makeService(t);
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': manifest('writer-reviewer', 'writer-reviewer.yaml'),
    '.multiagent/workflows/writer-reviewer.yaml': flow('writer-reviewer', { a: `provider: claude, model: ${REPO_MODEL}` }),
  });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  fs.writeFileSync(path.join(service.workspace().workflows, 'writer-reviewer.yaml'), owner);
  await api['projects:update']({ id: project.id, patch: { preferRepositoryWorkflows: true } });
  const fromRepo = (await api['workflows:list']({ projectId: project.id })).find((w) => w.origin === 'repository' && !w.error);
  await api['workflows:accept']({ projectId: project.id, file: fromRepo.file, commit: fromRepo.commit });
  return { service, api, project };
}

test('#554 the repository copy that runs takes the owner\'s literal values only: a templated model stays the repository\'s, an agent only the owner has is not added', async (t) => {
  const owner = flow('writer-reviewer', {
    a: 'provider: codex, model: "{{ inputs.model }}"',
    extra: `provider: claude, model: ${OWNER_MODEL}`,
  }, 'inputs:\n  model: { type: string, default: x }\n');
  const { service, api, project } = await preferRepositorySetup(t, owner);
  const { end, started } = await startAndFinish(service, api, { file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true });
  assert.equal(end.status, 'success', end.error);
  assert.equal(started?.agents?.a?.provider, 'codex', 'the owner\'s literal provider applies');
  assert.equal(started?.agents?.a?.model, REPO_MODEL, 'the owner\'s templated model is left out');
  assert.deepEqual(Object.keys(started?.agents || {}).sort(), ['a'], 'no agent of the owner\'s copy only');
});

test('#554 with "prefer the repository\'s workflows", a broken owner copy does not stop the repository copy: it runs with its own models', async (t) => {
  const { service, api, project } = await preferRepositorySetup(t, 'apiVersion: multiagent/v1\nkind: Workflow\nagents: [ not a map\n');
  const { end, started } = await startAndFinish(service, api, { file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true });
  assert.equal(end.status, 'success', end.error);
  assert.equal(started?.agents?.a?.provider, 'claude');
  assert.equal(started?.agents?.a?.model, REPO_MODEL);
});

test('#554 a manifest entry whose name differs from its file: the listing and the run agree on the owner\'s edited copy of that name', async (t) => {
  const { service, api } = makeService(t);
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': manifest('writer-reviewer', 'team-flow.yaml'),
    '.multiagent/workflows/team-flow.yaml': flow('writer-reviewer', { a: `provider: claude, model: ${REPO_MODEL}` }),
  });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  fs.writeFileSync(path.join(service.workspace().workflows, 'writer-reviewer.yaml'), flow('writer-reviewer', { a: `provider: claude, model: ${OWNER_MODEL}` }));

  const list = await api['workflows:list']({ projectId: project.id });
  const fromRepo = list.find((w) => w.origin === 'repository' && !w.error);
  assert.ok(fromRepo, 'fixture: the repository copy is listed');
  const { end, started } = await startAndFinish(service, api, { file: 'writer-reviewer.yaml', projectId: project.id, inputs: {}, mock: true });
  const ran = end.status === 'success' && started?.agents?.a?.model === OWNER_MODEL ? 'workspace' : 'repository';
  assert.equal(fromRepo.runsCopy, ran, `the listing says the ${fromRepo.runsCopy} copy runs, the run took the ${ran} one (${end.error || started?.agents?.a?.model})`);
});

test('#554 the roadmap\'s dispatcher runs an item naming the owner\'s edited copy without pausing for the unaccepted repository copy', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const inputs = 'inputs:\n  task: { type: string, required: true }\n  repo_path: { type: string, required: true }\n  issue: { type: string, default: "" }\n  issues: { type: array, default: [] }\n';
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': manifest('owner-issue', 'owner-issue.yaml'),
    '.multiagent/workflows/owner-issue.yaml': flow('owner-issue', { a: `provider: claude, model: ${REPO_MODEL}` }, inputs),
  });
  const p = await api['projects:create']({ name: 'demo', folder: repo.dir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1)] }));
  // the owner's own copy of that name (custom: no bundled one)
  fs.writeFileSync(path.join(ws.workflows, 'owner-issue.yaml'), flow('owner-issue', { a: `provider: claude, model: ${OWNER_MODEL}` }, inputs));
  const repoEntry = (await api['workflows:list']({ projectId: p.id })).find((w) => w.origin === 'repository' && !w.error);
  assert.equal(repoEntry?.accepted, false, 'fixture: the repository copy is not accepted');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'owner-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const item = () => api['roadmap:get']({ projectId: p.id }).stages.flatMap((s) => s.items)[0];
  await until(() => ['done', 'failed', 'skipped'].includes(item()?.status) || api['roadmap:get']({ projectId: p.id }).state === 'paused');
  const r = api['roadmap:get']({ projectId: p.id });
  assert.doesNotMatch(String(r.error || ''), /not accepted/i);
  assert.notEqual(r.state, 'paused', `the roadmap is not paused: ${r.error || ''}`);
  assert.equal(item()?.status, 'done', `the item ran: ${item()?.error || ''}`);
});
