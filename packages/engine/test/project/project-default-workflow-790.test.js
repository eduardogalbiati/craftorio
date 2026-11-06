// #790: the default workflow comes from the project and its manifest, never a global setting.
// Acceptance tests, written before the code.
// Seams (packages/engine/domains/project/projects.js):
// - projectDefaultWorkflow(project) -> `<name>.yaml`, always a value: the project's defaultWorkflow, the
//   manifest's default (project.folder), the first build workflow of project.workflows, `feature.yaml`;
//   a second argument is ignored;
// - createProject on a repository it clones: the clone's manifest gives the project its default;
// - projectManifest({ folder }) also carries `default` and `kinds` (what the wizard reads).
// The git runner is the boundary: a fake whose clone writes the manifest into the folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cloned } = require('./clone-wait');

const load = () => require('../../domains/project/projects');

const MANIFEST = `version: 1
default: hero
workflows:
  - name: feature
    category: solo
  - name: hero
    category: solo
`;
const OWN_FILE = `version: 1
default: repo-flow
workflows:
  - name: feature
    category: solo
  - name: repo-flow
    file: workflows/repo-flow.yaml
    category: solo
`;
const bare = (v) => String(v ?? '').replace(/\.ya?ml$/i, '');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-790-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function folderWith(t, text) {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), text);
  return dir;
}

function cloningGit(text) {
  return async (args) => {
    if (args[0] === 'clone') {
      fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
      fs.mkdirSync(path.join(args[2], '.multiagent'), { recursive: true });
      fs.writeFileSync(path.join(args[2], '.multiagent', 'project.yaml'), text);
    }
    return '';
  };
}

async function clonedProject(t, text, data = {}) {
  const root = tmp(t);
  const projects = load();
  const dir = path.join(root, 'projects');
  const created = await projects.createProject(dir, { name: 'Cloned', repo: 'https://github.com/o/r.git', ...data }, { git: cloningGit(text), reposDir: path.join(root, 'repos') });
  return cloned(projects, dir, created.id);
}

// ---- the order ------------------------------------------------------------------------------------

test('#790 the project\'s own default comes first, over its manifest\'s', (t) => {
  const project = { defaultWorkflow: 'mine', folder: folderWith(t, MANIFEST), workflows: [{ name: 'feature', category: 'build' }] };
  assert.equal(load().projectDefaultWorkflow(project), 'mine.yaml');
});

test('#790 without one of its own, the project takes its manifest\'s default, over its first build workflow', (t) => {
  const project = { folder: folderWith(t, MANIFEST), workflows: [{ name: 'other', category: 'build' }] };
  assert.equal(load().projectDefaultWorkflow(project), 'hero.yaml');
});

test('#790 without a manifest default, the project takes its first build workflow', (t) => {
  const project = { folder: tmp(t), workflows: [{ name: 'refresh', category: 'intake' }, { name: 'sd', category: 'build' }] };
  assert.equal(load().projectDefaultWorkflow(project), 'sd.yaml');
});

test('#790 with nothing else, the default is feature', (t) => {
  assert.equal(load().projectDefaultWorkflow({ folder: tmp(t) }), 'feature.yaml');
});

test('#790 a project whose folder is gone still has a default', () => {
  assert.equal(load().projectDefaultWorkflow({ folder: path.join(os.tmpdir(), 'no-such-folder-790') }), 'feature.yaml');
});

test('#790 no project at all still has a default', () => {
  assert.equal(load().projectDefaultWorkflow(null), 'feature.yaml');
});

test('#790 a fallback a caller still passes is ignored', (t) => {
  assert.equal(load().projectDefaultWorkflow({ folder: tmp(t) }, 'from-settings.yaml'), 'feature.yaml');
});

// ---- import: the clone ----------------------------------------------------------------------------

test('#790 a cloned project takes its manifest\'s default, not its first build workflow', async (t) => {
  const p = await clonedProject(t, MANIFEST);
  assert.equal(bare(p.defaultWorkflow), 'hero');
});

test('#790 a default given when the project is created wins over the manifest\'s', async (t) => {
  const p = await clonedProject(t, MANIFEST, { defaultWorkflow: 'feature' });
  assert.equal(bare(p.defaultWorkflow), 'feature');
});

test('#790 a repository workflow that becomes the default is still not accepted', async (t) => {
  const p = await clonedProject(t, OWN_FILE);
  assert.deepEqual([bare(p.defaultWorkflow), p.acceptedWorkflows ?? null], ['repo-flow', null]);
});

// ---- what the wizard reads ------------------------------------------------------------------------

test('#790 projectManifest carries the manifest\'s default', async (t) => {
  const out = await load().projectManifest({ folder: folderWith(t, MANIFEST) });
  assert.equal(out.default, 'hero');
});
