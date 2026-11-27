// #105, beyond the acceptance tests (local-import-remote-105.test.js): a folder on this computer imported by its
// file:// URL is the clone's source, its own origin the project's repository. Seams: the whole service in a
// simulation (onboarding:start, test/project/local-import-105-fixture.js) and projects.js createProject /
// retryClone / readProject. Real git in os.tmpdir(), no network.
// - a GitLab remote is kept as a GitHub one is (provider gitlab, owner/name);
// - an origin with credentials in its URL never puts them in the project's record;
// - importing the same folder again resumes the same project (found by its source, #741);
// - a plain path (no file://) is still the project's repository, with no source (as before #105);
// - a failed clone of a folder retries from the folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const Platforms = require('@craftorio/shared/platforms');
const projects = require('../../domains/project/projects');
const { importFolder, personFolder, run } = require('./local-import-105-fixture');

const samePath = (a, b) => fs.realpathSync.native(a) === fs.realpathSync.native(b);
const folderOf = (url) => (/^file:/i.test(url) ? fileURLToPath(url) : url);

function tmpDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'local-source-105-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function settled(dir, id) {
  for (let i = 0; i < 400; i++) {
    const p = projects.readProject(dir, id);
    if (p.status !== 'cloning') return p;
    await pause(50);
  }
  assert.fail('the clone never ended');
}

test('#105 a folder with a GitLab remote: the project records that remote (gitlab, grp/tool)', { timeout: 60000 }, async (t) => {
  const { project } = await importFolder(t, personFolder(t, { remote: 'https://gitlab.com/grp/tool.git' }));
  assert.doesNotMatch(String(project.repo), /^file:/i, `the project's repository: ${project.repo}`);
  assert.equal(Platforms.platformOfRepoUrl(project.repo)?.id, 'gitlab', `the provider, from ${project.repo}`);
  assert.equal(Platforms.parseRepoUrl(project.repo)?.path, 'grp/tool', `owner/name, from ${project.repo}`);
});

test('#105 a folder whose origin carries credentials: the project\'s record never holds them', { timeout: 60000 }, async (t) => {
  const { project, ws, id } = await importFolder(t, personFolder(t, { remote: 'https://someone:s3cr3t-token@github.com/acme/widget.git' }));
  const saved = fs.readFileSync(path.join(ws.projects, `${id}.json`), 'utf8');
  assert.equal(saved.includes('s3cr3t-token'), false, 'the token is not in the saved project');
  assert.equal(String(project.repo).includes('s3cr3t-token'), false, `the project's repository: ${project.repo}`);
  assert.equal(Platforms.parseRepoUrl(project.repo)?.path, 'acme/widget', `owner/name, from ${project.repo}`);
});

test('#105 importing the same folder again resumes the same project', { timeout: 60000 }, async (t) => {
  const folder = personFolder(t, { remote: 'https://github.com/acme/widget.git' });
  const { api, id } = await importFolder(t, folder);
  const again = await api['onboarding:start']({ name: 'Widget again', repo: pathToFileURL(folder).href });
  assert.equal(again.projectId, id, 'the same project');
  const list = await api['projects:list']();
  assert.equal(list.filter((p) => !p.error).length, 1, 'no second project');
});

test('#105 a plain path (no file://) stays the project\'s repository, with no source', { timeout: 60000 }, async (t) => {
  const folder = personFolder(t, { remote: 'https://github.com/acme/widget.git' });
  const dir = tmpDir(t);
  const created = await projects.createProject(path.join(dir, 'projects'), { name: 'Plain', repo: folder }, { reposDir: path.join(dir, 'repos') });
  const p = await settled(path.join(dir, 'projects'), created.id);
  assert.equal(p.repo, folder);
  assert.equal(p.source ?? null, null, 'no source');
  assert.equal(p.status, 'ready');
});

test('#105 a failed clone of a folder retries from the folder, keeping its remote as the repository', { timeout: 60000 }, async (t) => {
  const folder = personFolder(t, { remote: 'https://github.com/acme/widget.git' });
  const dir = tmpDir(t);
  const pdir = path.join(dir, 'projects');
  const created = await projects.createProject(pdir, { name: 'Retry', repo: pathToFileURL(folder).href }, { reposDir: path.join(dir, 'repos'), cloneError: 'refused once' });
  assert.equal(projects.readProject(pdir, created.id).status, 'failed');
  await projects.retryClone(pdir, created.id);
  const p = await settled(pdir, created.id);
  assert.equal(p.status, 'ready', `the retried clone: ${p.cloneError || ''}`);
  assert.equal(Platforms.parseRepoUrl(p.repo)?.path, 'acme/widget', `the repository: ${p.repo}`);
  const origin = run(p.folder, ['remote', 'get-url', 'origin']);
  assert.equal(samePath(folderOf(origin), folder), true, `the clone's origin is the folder: ${origin}`);
});
