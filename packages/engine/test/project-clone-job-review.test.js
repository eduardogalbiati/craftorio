// #639 review: a failed project pointed at another folder is ready (Retry would remove the owner's folder);
// checkAccess tells a timed-out ls-remote (no-network) and a missing git (no-git) from no access.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../domains/project/projects');
const { cloned } = require('./project/clone-wait');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-job-639-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const settled = (dir, id) => cloned(projects, dir, id);

test('#639 a failed project pointed at a folder cloned by hand is ready, and Retry is refused', async (t) => {
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const git = async (args) => { if (args[0] === 'clone') throw new Error('git clone failed: boom'); return ''; };
  const created = await projects.createProject(dir, { name: 'Demo', repo: 'https://github.com/acme/demo.git' }, { git, reposDir: path.join(root, 'repos') });
  assert.equal((await settled(dir, created.id)).status, 'failed');

  const own = path.join(root, 'own-checkout');
  fs.mkdirSync(path.join(own, '.git'), { recursive: true });
  fs.writeFileSync(path.join(own, 'work.txt'), 'uncommitted');
  const p = projects.updateProject(dir, created.id, { folder: own });
  assert.equal(p.status, 'ready');
  assert.equal(p.cloneError, undefined);
  await assert.rejects(projects.retryClone(dir, created.id, { git }));
  assert.ok(fs.existsSync(path.join(own, 'work.txt')));
});

test('#639 checkAccess reads a timed-out ls-remote as no-network and a missing git as no-git', async () => {
  const fail = (message, code) => async () => { throw Object.assign(new Error(message), { code }); };
  assert.equal((await projects.checkAccess('https://github.com/acme/demo.git', { git: fail('git ls-remote timed out after 30 s.', 'ETIMEDOUT') })).status, 'no-network');
  assert.equal((await projects.checkAccess('https://github.com/acme/demo.git', { git: fail('git was not found', 'ENOENT') })).status, 'no-git');
});
