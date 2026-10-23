// #472 (SEC-7): a project whose repository the app clones (src/projects.js createProject) is not the
// user's own checkout, so it starts with "Install dependencies without running their scripts" on; a
// project on an existing folder starts with it off; the dialog's explicit choice wins either way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../src/projects');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-472-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// a git that "clones" by creating the target's .git folder
const fakeGit = async (args) => { if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };

test('a project whose repository is cloned starts with ignoreInstallScripts on', async (t) => {
  const root = tmp(t);
  const p = await projects.createProject(path.join(root, 'projects'), { name: 'Lib', repo: 'https://github.com/o/r.git' }, { git: fakeGit, reposDir: path.join(root, 'repos') });
  assert.equal(p.ignoreInstallScripts, true);
  assert.equal(projects.readProject(path.join(root, 'projects'), p.id).ignoreInstallScripts, true);
});

test('an explicit ignoreInstallScripts: false wins over the clone default', async (t) => {
  const root = tmp(t);
  const p = await projects.createProject(path.join(root, 'projects'), { name: 'Lib', repo: 'https://github.com/o/r.git', ignoreInstallScripts: false }, { git: fakeGit, reposDir: path.join(root, 'repos') });
  assert.equal(!!p.ignoreInstallScripts, false);
});

test('a project on the user\'s own folder starts with ignoreInstallScripts off', async (t) => {
  const root = tmp(t);
  const p = await projects.createProject(path.join(root, 'projects'), { name: 'Mine' }, { git: fakeGit });
  assert.equal(!!p.ignoreInstallScripts, false);
});

test('a project on the user\'s own folder keeps an explicit ignoreInstallScripts: true', async (t) => {
  const root = tmp(t);
  const p = await projects.createProject(path.join(root, 'projects'), { name: 'Mine', ignoreInstallScripts: true }, { git: fakeGit });
  assert.equal(p.ignoreInstallScripts, true);
});
