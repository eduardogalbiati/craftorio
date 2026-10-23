// #485: repository workflows on the service (src/service/areas/workflows.js, channels/workflows.js):
// `workflows:list` per project, `workflows:accept`, re-acceptance after a later commit, and a run
// refusing an unaccepted repository workflow. Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   api['workflows:list']({ projectId }) -> the workspace workflows as today, plus one entry per
//     repository workflow the project's .multiagent/project.yaml declares with a `file`:
//     { file, name, category (the manifest's), origin: 'repository', projectId, commit (the full sha
//       of the checkout's HEAD the file was read at), accepted (boolean), ... }.
//     `file` is whatever identifies it to workflows:accept and run:start (the tests pass it back as is).
//     A malformed manifest: the workspace workflows are still listed, plus an entry whose `error`
//     names .multiagent/project.yaml.
//   api['workflows:list']() (no project) -> as today (no repository entries).
//   api['workflows:accept']({ projectId, file, commit }) records the acceptance in
//     <workspace>/projects/<projectId>.json (the commit is written there); the entry is then accepted.
//     A later commit that changes the workflow's file makes it unaccepted again (accept that commit anew).
//   api['run:start']({ file, projectId, mock: true }) with an unaccepted repository workflow is
//     refused (rejects) with an error that says it is not accepted and names the workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');
const { repoWithManifest, repoFlow } = require('../repo-workflow-fixtures-485');

async function projectWithRepo(t, opts) {
  const { api, service } = makeService(t);
  const repo = repoWithManifest(t, opts);
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  return { api, service, repo, project };
}

const repoEntries = (list) => list.filter((w) => w.origin === 'repository' && !w.error);
const repoFlowOf = (list) => repoEntries(list).find((w) => w.name === 'repo-flow' || /repo-flow/.test(String(w.file)));

test('#485 workflows:list for a project lists its repository workflows with origin, commit, category and acceptance', async (t) => {
  const { api, repo, project } = await projectWithRepo(t);
  const list = await api['workflows:list']({ projectId: project.id });
  assert.ok(list.some((w) => w.file === 'fixture-service.yaml'), 'the workspace workflows are still listed');
  const item = repoFlowOf(list);
  assert.ok(item, 'repo-flow is listed with origin repository');
  assert.equal(item.commit, repo.head());
  assert.equal(item.accepted, false);
  assert.equal(item.category, 'solo');
  assert.equal(item.projectId, project.id);
  // a bundled workflow named without a file is not a repository workflow
  assert.equal(repoEntries(list).some((w) => w.name === 'writer-reviewer' || w.file === 'writer-reviewer.yaml'), false);
});

test('#485 workflows:list without a project lists no repository workflow (as today)', async (t) => {
  const { api } = await projectWithRepo(t);
  const list = await api['workflows:list']();
  assert.equal(list.some((w) => w.origin === 'repository'), false);
});

test('#485 workflows:accept records the commit in <workspace>/projects/<id>.json and the workflow is accepted', async (t) => {
  const { api, service, project } = await projectWithRepo(t);
  const item = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(item, 'repo-flow is listed');
  await api['workflows:accept']({ projectId: project.id, file: item.file, commit: item.commit });
  const saved = fs.readFileSync(path.join(service.workspace().projects, `${project.id}.json`), 'utf8');
  assert.ok(saved.includes(item.commit), 'the accepted commit is in the project file');
  assert.equal(repoFlowOf(await api['workflows:list']({ projectId: project.id })).accepted, true);
});

test('#485 a later commit that changes the repository workflow needs a new acceptance', async (t) => {
  const { api, repo, project } = await projectWithRepo(t);
  const first = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(first, 'repo-flow is listed');
  await api['workflows:accept']({ projectId: project.id, file: first.file, commit: first.commit });
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow('changed') });
  const second = repo.commit('change the flow');
  const after = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.equal(after.commit, second);
  assert.equal(after.accepted, false, 'changed since the accepted commit');
  await api['workflows:accept']({ projectId: project.id, file: after.file, commit: second });
  assert.equal(repoFlowOf(await api['workflows:list']({ projectId: project.id })).accepted, true);
});

test('#485 workflows:accept refuses a commit that is not the repository\'s', async (t) => {
  const { api, project } = await projectWithRepo(t);
  const item = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(item, 'repo-flow is listed');
  await assert.rejects(async () => api['workflows:accept']({ projectId: project.id, file: item.file, commit: 'f'.repeat(40) }));
  assert.equal(repoFlowOf(await api['workflows:list']({ projectId: project.id })).accepted, false);
});

test('#485 a malformed manifest is reported and the project keeps the workspace workflows', async (t) => {
  const { api, project } = await projectWithRepo(t, { manifest: 'workflows:\n  name: [unclosed\n' });
  const list = await api['workflows:list']({ projectId: project.id });
  assert.ok(list.some((w) => w.file === 'fixture-service.yaml'), 'the workspace workflows are listed');
  assert.ok(list.some((w) => /project\.yaml/.test(String(w.error || ''))), 'an entry reports the manifest error');
  assert.equal(repoEntries(list).length, 0);
});

test('#485 workflows:list with repositoryOnly gives the repository workflows and the manifest\'s categories only', async (t) => {
  const { api, project } = await projectWithRepo(t);
  const list = await api['workflows:list']({ projectId: project.id, repositoryOnly: true });
  assert.deepEqual([...new Set(list.map((w) => w.origin))].sort(), ['manifest', 'repository']);
  assert.equal(list.some((w) => w.file === 'fixture-service.yaml'), false, 'no workspace workflow');
  const own = repoFlowOf(list);
  assert.ok(own, 'repo-flow is listed');
  assert.equal(own.category, 'solo');
  // a workflow the manifest names without a file: its name and the manifest's category
  const named = list.filter((w) => w.origin === 'manifest').map((w) => `${w.name}:${w.category}`);
  assert.deepEqual(named, ['writer-reviewer:team']);
});

test('#485 workflows:list for a project files a workspace workflow the manifest names under the manifest\'s category', async (t) => {
  const { api, project } = await projectWithRepo(t);
  const plain = (await api['workflows:list']()).find((w) => w.file === 'writer-reviewer.yaml');
  assert.ok(plain, 'writer-reviewer is in the workspace');
  assert.notEqual(plain.category, 'team', 'its own category is not the manifest\'s (else this test proves nothing)');
  const forProject = (await api['workflows:list']({ projectId: project.id })).find((w) => w.file === 'writer-reviewer.yaml');
  assert.equal(forProject.category, 'team');
  assert.equal(forProject.origin, plain.origin, 'still the workspace\'s workflow');
});

test('#485 builder:load-repository opens the committed text of a repository workflow read-only', async (t) => {
  const { api, repo, project } = await projectWithRepo(t);
  const item = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(item, 'repo-flow is listed');
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow('uncommitted') });
  const loaded = await api['builder:load-repository']({ projectId: project.id, file: item.file });
  assert.equal(loaded.mode, 'readonly');
  const spec = JSON.stringify(loaded.spec);
  assert.equal(spec.includes('committed'), true, 'the committed step is in the spec');
  assert.equal(spec.includes('uncommitted'), false, 'an uncommitted edit of the checkout is not read');
});

test('#485 builder:load-repository refuses a workflow the manifest does not declare', async (t) => {
  const { api, project } = await projectWithRepo(t);
  await assert.rejects(
    async () => api['builder:load-repository']({ projectId: project.id, file: 'not-declared.yaml' }),
    (e) => /not found/i.test(e.message) && /not-declared/.test(e.message),
  );
});

test('#485 builder:clone-repository makes a custom, untrusted copy in the workspace and leaves the repository entry as is', async (t) => {
  const { api, service, project } = await projectWithRepo(t);
  const item = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(item, 'repo-flow is listed');
  const { file } = await api['builder:clone-repository']({ projectId: project.id, file: item.file });
  assert.equal(file, 'repo-flow-copy.yaml');
  assert.equal(fs.existsSync(path.join(service.workspace().workflows, 'repo-flow-copy.yaml')), true);
  const list = await api['workflows:list']({ projectId: project.id });
  const copy = list.find((w) => w.file === 'repo-flow-copy.yaml');
  assert.equal(copy.origin, 'custom');
  assert.equal(copy.trusted, false, 'not trusted until the owner confirms it (#474)');
  assert.equal(repoFlowOf(list).accepted, false, 'cloning does not accept the repository workflow');
});

test('#485 a run of an unaccepted repository workflow is refused, naming it', async (t) => {
  const { api, project } = await projectWithRepo(t);
  const item = repoFlowOf(await api['workflows:list']({ projectId: project.id }));
  assert.ok(item, 'repo-flow is listed');
  await assert.rejects(
    async () => api['run:start']({ file: item.file, projectId: project.id, mock: true }),
    (e) => /not accepted|accept/i.test(e.message) && /repo-flow/.test(e.message),
  );
  assert.equal(api['runs:active']().length, 0);
});
