// #738 Fork + PR: the project records the owner's fork of the repository it imported (updateProject's
// `fork`): { url (origin, the fork), upstream (the original), dependentPr? }; null when there is none.
// dependentPr is how a dependent roadmap item's pull request opens: 'wait-and-rebase' (the default, not
// stored) or 'depends-on'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../../domains/project/projects');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-738-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* a temp folder left behind */ } });
  return dir;
}

async function imported(t) {
  const dir = tmpDir(t);
  const p = await projects.createProject(dir, { name: 'Widgets', repo: 'https://github.com/acme/widgets', folder: path.join(dir, 'widgets') });
  return { dir, id: p.id };
}

test('#738 a project without a fork has none recorded', async (t) => {
  const { dir, id } = await imported(t);
  assert.equal(projects.readProject(dir, id).fork ?? null, null);
});

test('#738 updateProject records the fork as origin and the original as upstream', async (t) => {
  const { dir, id } = await imported(t);
  projects.updateProject(dir, id, { fork: { url: ' https://github.com/me/widgets ', upstream: 'https://github.com/acme/widgets' } });
  assert.deepEqual(projects.readProject(dir, id).fork, { url: 'https://github.com/me/widgets', upstream: 'https://github.com/acme/widgets' });
});

test('#738 the fork\'s upstream defaults to the project\'s repository', async (t) => {
  const { dir, id } = await imported(t);
  projects.updateProject(dir, id, { fork: { url: 'https://github.com/me/widgets' } });
  assert.equal(projects.readProject(dir, id).fork.upstream, 'https://github.com/acme/widgets');
});

test('#738 dependentPr keeps depends-on; wait-and-rebase (the default) and unknown values are not stored', async (t) => {
  const { dir, id } = await imported(t);
  projects.updateProject(dir, id, { fork: { url: 'https://github.com/me/widgets', dependentPr: 'depends-on' } });
  assert.equal(projects.readProject(dir, id).fork.dependentPr, 'depends-on');
  projects.updateProject(dir, id, { fork: { url: 'https://github.com/me/widgets', dependentPr: 'wait-and-rebase' } });
  assert.equal('dependentPr' in projects.readProject(dir, id).fork, false);
  projects.updateProject(dir, id, { fork: { url: 'https://github.com/me/widgets', dependentPr: 'whenever' } });
  assert.equal('dependentPr' in projects.readProject(dir, id).fork, false);
});

test('#738 a fork without a url clears it', async (t) => {
  const { dir, id } = await imported(t);
  projects.updateProject(dir, id, { fork: { url: 'https://github.com/me/widgets' } });
  projects.updateProject(dir, id, { fork: { url: '' } });
  assert.equal(projects.readProject(dir, id).fork ?? null, null);
});
