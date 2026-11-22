// T2c: a repository set up before the rename to Craftorio keeps its .multiagent/ folder: the manifest
// is read from there (on disk and at a commit), its workflows resolve there, and nothing is split
// into a second .craftorio/ folder. A repository with .craftorio/ reads only that one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { projectDirName, projectFiles, inProjectDir } = require('@craftorio/shared/project-dir');
const { projectDirOf, readManifest } = require('../domains/project/project-manifest');
const { resolveWorkflow } = require('../domains/workflow/workflows');

const MANIFEST = 'version: 1\nworkflows:\n  - name: mine\n    file: workflows/mine.yaml\n';
const repo = (t, dir) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-legacy-dir-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, dir, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'project.yaml'), MANIFEST);
  fs.writeFileSync(path.join(root, dir, 'workflows', 'mine.yaml'), 'apiVersion: multiagent/v1\nkind: Workflow\n');
  return root;
};

test('T2c the resolver: .craftorio unless only .multiagent exists; reads try the new folder first', () => {
  assert.equal(projectDirName(() => false), '.craftorio');
  assert.equal(projectDirName((n) => n === '.multiagent'), '.multiagent');
  assert.equal(projectDirName(() => true), '.craftorio');
  assert.deepEqual(projectFiles('project.yaml'), ['.craftorio/project.yaml', '.multiagent/project.yaml']);
  assert.equal(inProjectDir('.craftorio/workflows/a.yaml', '.multiagent'), '.multiagent/workflows/a.yaml');
  assert.equal(inProjectDir('docs/x.md', '.multiagent'), 'docs/x.md');
});

test('T2c a repository with only .multiagent/: its manifest is read and its workflows resolve there', (t) => {
  const root = repo(t, '.multiagent');
  assert.equal(projectDirOf(root), '.multiagent');
  assert.deepEqual(readManifest(root).workflows.map((w) => w.name), ['mine']);
  const r = resolveWorkflow('mine', [os.tmpdir()], { repo: root });
  assert.equal(r.origin, 'repository');
  assert.equal(r.file, path.join(root, '.multiagent', 'workflows', 'mine.yaml'));
});

test('T2c a repository with .craftorio/: read from there', (t) => {
  const root = repo(t, '.craftorio');
  assert.equal(projectDirOf(root), '.craftorio');
  assert.deepEqual(readManifest(root).workflows.map((w) => w.name), ['mine']);
  assert.equal(resolveWorkflow('mine', [os.tmpdir()], { repo: root }).file, path.join(root, '.craftorio', 'workflows', 'mine.yaml'));
});

test('T2c the manifest at a commit is found under either folder (the acceptance per commit)', (t) => {
  const root = repo(t, '.multiagent');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'legacy');
  assert.match(git('show', 'HEAD:.multiagent/project.yaml'), /name: mine/);
  const area = fs.readFileSync(path.join(__dirname, '..', 'service', 'areas', 'repository-workflows.js'), 'utf8');
  assert.match(area, /for \(const file of \[MANIFEST_FILE, LEGACY_MANIFEST_FILE\]\)/, 'the area tries the new file, then the old one');
});
