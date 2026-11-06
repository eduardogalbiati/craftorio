// #794: the commit that last changed a repository workflow's file, on the service
// (packages/engine/service/areas/workflows.js). Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   api['workflows:list']({ projectId, repositoryOnly: true }) -> the entry of a waiting workflow
//     (accepted: false) has changedCommit, the full sha of the last commit that changed its file;
//     commit stays the checkout's HEAD (what workflows:accept is given).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./helpers');
const { MANIFEST, repoWithManifest, repoFlow } = require('../repo-workflow-fixtures-485');

async function projectWithRepo(t) {
  const { api } = makeService(t);
  const repo = repoWithManifest(t);
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  return { api, repo, project };
}

async function listed(api, project, name) {
  const list = await api['workflows:list']({ projectId: project.id, repositoryOnly: true });
  return list.find((w) => w.origin === 'repository' && !w.error && w.name === name);
}

test('#794 a waiting workflow names the commit that changed its file, while commit stays HEAD', async (t) => {
  const { api, repo, project } = await projectWithRepo(t);
  const first = await listed(api, project, 'repo-flow');
  assert.ok(first, 'repo-flow is listed');
  await api['workflows:accept']({ projectId: project.id, file: first.file, commit: first.commit });
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow('changed') });
  const changed = repo.commit('change the flow');
  repo.write({ 'README.md': '# demo, unrelated\n' });
  const unrelated = repo.commit('an unrelated commit');
  const item = await listed(api, project, 'repo-flow');
  assert.equal(item.accepted, false);
  assert.equal(item.commit, unrelated);
  assert.equal(item.changedCommit, changed);
});

test('#794 a workflow never accepted names the commit that added it', async (t) => {
  const { api, repo, project } = await projectWithRepo(t);
  repo.write({
    '.multiagent/project.yaml': `${MANIFEST}  - name: late-flow\n    file: workflows/late-flow.yaml\n    category: team\n`,
    '.multiagent/workflows/late-flow.yaml': repoFlow('committed', 'late-flow'),
  });
  const added = repo.commit('add a workflow');
  repo.write({ 'README.md': '# demo, unrelated\n' });
  const unrelated = repo.commit('an unrelated commit');
  const item = await listed(api, project, 'late-flow');
  assert.ok(item, 'late-flow is listed');
  assert.equal(item.accepted, false);
  assert.equal(item.commit, unrelated);
  assert.equal(item.changedCommit, added);
});
