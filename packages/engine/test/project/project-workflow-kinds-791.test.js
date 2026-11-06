// #791: each project names its workflow per kind of work. Acceptance tests, written before the code.
// Seams (packages/engine/domains/project/projects.js):
// - workflowForKind(project, kind) -> { name, inputs }, kind `feature` | `fix` | `refactor` (refactor uses
//   the Feature entry). Order: project.workflowKinds[kind]; for Feature the project's defaultWorkflow;
//   the manifest's kinds in project.folder (the Feature entry also the manifest's `default`); the wizard's
//   picks `feature` / `fix` in project.workflows with their variant; last `feature` / `fix` in the
//   project's way of working;
// - createProject and updateProject accept `workflowKinds`; a clone saves the manifest's map.
// The way of working is what the app records: the workflows' variant (local-* / remote-* / fork-*,
// project-run-defaults.js wizardMode) and the project's fork (Fork + PR, #738).
// The git runner is the boundary: a fake whose clone writes the manifest into the folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cloned } = require('./clone-wait');

const load = () => require('../../domains/project/projects');
const kindOf = (project, kind) => load().workflowForKind(project, kind);

const WORKFLOWS = `version: 1
workflows:
  - name: hero
    category: solo
  - name: fix
    category: fix
`;
const MAP = `${WORKFLOWS}default: hero
kinds:
  feature: { name: hero }
  fix: { name: fix, mode: remote }
`;
const FIX_ONLY = `${WORKFLOWS}default: hero
kinds:
  fix: { name: fix, mode: remote }
`;

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinds-791-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function folderWith(t, text) {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), text);
  return dir;
}

const plain = (x) => JSON.parse(JSON.stringify(x ?? null));

// ---- the order ------------------------------------------------------------------------------------

test('#791 the project\'s own entry comes first, over the manifest\'s', (t) => {
  const project = { folder: folderWith(t, MAP), workflowKinds: { fix: { name: 'my-fix', inputs: { mode: 'fork' } } } };
  assert.deepEqual(plain(kindOf(project, 'fix')), { name: 'my-fix', inputs: { mode: 'fork' } });
});

test('#791 without its own entry, a project takes the manifest\'s, inputs included', (t) => {
  assert.deepEqual(plain(kindOf({ folder: folderWith(t, MAP) }, 'fix')), { name: 'fix', inputs: { mode: 'remote' } });
});

test('#791 the manifest\'s map wins over the wizard\'s picks', (t) => {
  const project = { folder: folderWith(t, MAP), workflows: [{ name: 'fix', variant: 'local-code' }] };
  assert.deepEqual(plain(kindOf(project, 'fix')), { name: 'fix', inputs: { mode: 'remote' } });
});

test('#791 the Feature entry extends the manifest\'s default', (t) => {
  assert.deepEqual(plain(kindOf({ folder: folderWith(t, FIX_ONLY) }, 'feature')), { name: 'hero', inputs: {} });
});

// #790's decision: the Feature entry is the default workflow, and a project's own default comes first;
// a migrated project (a default, no map) keeps running what it ran
test('#791 without its own entry, the project\'s default is the Feature workflow, over the manifest\'s', (t) => {
  const project = { folder: folderWith(t, FIX_ONLY), defaultWorkflow: 'my-flow' };
  assert.equal(kindOf(project, 'feature').name, 'my-flow');
});

test('#791 the project\'s default says nothing about its Fix workflow', (t) => {
  const project = { folder: folderWith(t, FIX_ONLY), defaultWorkflow: 'my-flow' };
  assert.deepEqual(plain(kindOf(project, 'fix')), { name: 'fix', inputs: { mode: 'remote' } });
});

test('#791 a default that is also the wizard\'s pick keeps the pick\'s mode', () => {
  const out = kindOf({ defaultWorkflow: 'feature', workflows: [{ name: 'feature', variant: 'remote-code' }] }, 'feature');
  assert.deepEqual([out.name, out.inputs.mode], ['feature', 'remote']);
});

test('#791 the wizard\'s feature pick gives the Feature workflow in its variant\'s mode', () => {
  const out = kindOf({ workflows: [{ name: 'feature', variant: 'remote-code' }, { name: 'fix', variant: 'fork-e2e' }] }, 'feature');
  assert.deepEqual([out.name, out.inputs.mode], ['feature', 'remote']);
});

test('#791 the wizard\'s fix pick gives the Fix workflow in its variant\'s mode', () => {
  const out = kindOf({ workflows: [{ name: 'feature', variant: 'remote-code' }, { name: 'fix', variant: 'fork-e2e' }] }, 'fix');
  assert.deepEqual([out.name, out.inputs.mode], ['fix', 'fork']);
});

test('#791 with neither, a project on Remote gets fix in Remote mode', () => {
  const out = kindOf({ workflows: [{ name: 'my-flow', variant: 'remote-code' }] }, 'fix');
  assert.deepEqual([out.name, out.inputs.mode], ['fix', 'remote']);
});

test('#791 with neither, a project on Local gets feature in Local mode', () => {
  const out = kindOf({ workflows: [{ name: 'my-flow', variant: 'local-e2e' }] }, 'feature');
  assert.deepEqual([out.name, out.inputs.mode], ['feature', 'local']);
});

test('#791 with neither, a project with a fork gets fix in Fork + PR mode', () => {
  const out = kindOf({ fork: { url: 'https://github.com/me/r.git', upstream: 'https://github.com/o/r.git' } }, 'fix');
  assert.deepEqual([out.name, out.inputs.mode], ['fix', 'fork']);
});

test('#791 an existing project with no map, picks or way of working resolves to feature and fix', (t) => {
  const folder = tmp(t);
  assert.deepEqual([kindOf({ folder }, 'feature').name, kindOf({ folder }, 'fix').name], ['feature', 'fix']);
});

test('#791 a kind the manifest names wrongly falls through to the next rule', (t) => {
  const folder = folderWith(t, `${WORKFLOWS}kinds:\n  fix: { name: ghost, mode: remote }\n`);
  assert.equal(kindOf({ folder }, 'fix').name, 'fix');
});

test('#791 Refactor uses the Feature entry', () => {
  const entry = { name: 'hero', inputs: { mode: 'remote' } };
  assert.deepEqual(plain(kindOf({ workflowKinds: { feature: entry } }, 'refactor')), entry);
});

// ---- the record -----------------------------------------------------------------------------------

test('#791 a clone saves the manifest\'s map on the project', async (t) => {
  const root = tmp(t);
  const projects = load();
  const dir = path.join(root, 'projects');
  const git = async (args) => {
    if (args[0] === 'clone') {
      fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
      fs.mkdirSync(path.join(args[2], '.multiagent'), { recursive: true });
      fs.writeFileSync(path.join(args[2], '.multiagent', 'project.yaml'), MAP);
    }
    return '';
  };
  const created = await projects.createProject(dir, { name: 'Cloned', repo: 'https://github.com/o/r.git' }, { git, reposDir: path.join(root, 'repos') });
  const p = await cloned(projects, dir, created.id);
  assert.deepEqual(plain(p.workflowKinds), { feature: { name: 'hero', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } });
});

test('#791 createProject keeps the given map', async (t) => {
  const workflowKinds = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
  const p = await load().createProject(path.join(tmp(t), 'projects'), { name: 'Own', folder: tmp(t), workflowKinds });
  assert.deepEqual(plain(p.workflowKinds), workflowKinds);
});

test('#791 updateProject changes the map', async (t) => {
  const projects = load();
  const dir = path.join(tmp(t), 'projects');
  const p = await projects.createProject(dir, { name: 'Edit', folder: tmp(t) });
  const workflowKinds = { feature: { name: 'feature', inputs: {} }, fix: { name: 'my-fix', inputs: { mode: 'fork' } } };
  projects.updateProject(dir, p.id, { workflowKinds });
  assert.deepEqual(plain(projects.readProject(dir, p.id).workflowKinds), workflowKinds);
});

test('#791 projectManifest carries the manifest\'s map', async (t) => {
  const out = await load().projectManifest({ folder: folderWith(t, MAP) });
  assert.deepEqual(plain(out.kinds?.fix ?? null), { name: 'fix', inputs: { mode: 'remote' } });
});
