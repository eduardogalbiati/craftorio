// #790, #791: the details behind the project's default and kinds: a repository's workflow reaches the
// Product Owner and Fix the base, the Feature entry follows a new default, the screens get the manifest's
// choices, a voided manifest declares nothing and a kind's input wins over the model's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DefaultWorkflow = require('@craftorio/shared/default-workflow');
const manifest = require('../../domains/project/project-manifest');
const productOwner = require('../../domains/po/product-owner');
const projects = require('../../domains/project/projects');
const runDefaults = require('../../domains/project/project-run-defaults');
const { productOwnerWorkflows, projectListing } = require('../../service/seed-runs');

const task = { task: { type: 'string' } };
const MANIFEST = 'workflows:\n  - { name: feature, category: solo }\n  - { name: hero, category: solo, file: workflows/hero.yaml }\n  - { name: fix, category: fix }\ndefault: hero\nkinds:\n  fix: { name: fix, mode: remote }\n';

function folderWith(t, text) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'kinds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), text);
  return dir;
}

function projectsDir(t, record) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'kinds-projects-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify({ name: 'Demo', folder: dir, ...record }));
  return dir;
}

// ctx.listWorkflows as the service's: the repository's only with the project's id
const listingCtx = () => {
  const calls = [];
  const workspace = [{ file: 'feature.yaml', inputs: task }, { file: 'fix.yaml', inputs: task }];
  return { calls, listWorkflows: (opts = {}) => { calls.push(opts); return opts.projectId ? [...workspace, { file: 'project.yaml', error: 'x' }, { file: 'hero.yaml', origin: 'repository', inputs: task }, { file: 'feature.yaml', origin: 'repository', inputs: task }] : workspace; } };
};

test('#790 projectListing asks for the project\'s workflows, each file once, none with an error', () => {
  const ctx = listingCtx();
  const files = projectListing(ctx, { id: 'demo' }).map((w) => w.file);
  assert.deepEqual([ctx.calls, files], [[{ projectId: 'demo' }], ['feature.yaml', 'fix.yaml', 'hero.yaml']]);
});

test('#790 projectListing with no project lists the workspace\'s, and a ctx with no listing lists nothing', () => {
  assert.deepEqual([projectListing(listingCtx(), null).length, projectListing({}, { id: 'demo' })], [2, []]);
});

test('#790 a default only the repository declares is offered to the Product Owner', (t) => {
  const folder = folderWith(t, MANIFEST);
  const out = productOwnerWorkflows(listingCtx(), { id: 'demo', folder });
  assert.deepEqual([out.defaultWorkflow, out.workflows.some((w) => w.file === 'hero.yaml')], ['hero.yaml', true]);
});

test('#790 a default only the repository declares resolves to itself, not to feature.yaml', (t) => {
  const folder = folderWith(t, MANIFEST);
  const out = productOwnerWorkflows(listingCtx(), { id: 'demo', folder });
  assert.equal(DefaultWorkflow.resolve(out.defaultWorkflow, out.workflows.map((w) => w.file)).file, 'hero.yaml');
});

test('#790 a choice of the owner on a repository workflow outside the project\'s stays listed', () => {
  const out = productOwnerWorkflows(listingCtx(), { id: 'demo', workflows: [{ name: 'fix' }] }, 'hero.yaml');
  assert.equal(out.workflows.some((w) => w.file === 'hero.yaml'), true);
});

test('#791 a new default moves a saved Feature entry, its inputs kept', (t) => {
  const dir = projectsDir(t, { defaultWorkflow: 'hero', workflowKinds: { feature: { name: 'hero', inputs: { mode: 'remote' } }, fix: { name: 'fix', inputs: {} } } });
  const saved = projects.updateProject(dir, 'demo', { defaultWorkflow: 'other' });
  assert.deepEqual(saved.workflowKinds, { feature: { name: 'other', inputs: { mode: 'remote' } }, fix: { name: 'fix', inputs: {} } });
});

test('#791 the same default saved again leaves a Feature entry that differs from it', (t) => {
  const dir = projectsDir(t, { defaultWorkflow: 'hero', workflowKinds: { feature: { name: 'manifest-feature', inputs: {} } } });
  assert.equal(projects.updateProject(dir, 'demo', { defaultWorkflow: 'hero' }).workflowKinds.feature.name, 'manifest-feature');
});

test('#791 a map saved with the default is taken as given', (t) => {
  const dir = projectsDir(t, { defaultWorkflow: 'hero', workflowKinds: { feature: { name: 'hero', inputs: {} } } });
  assert.equal(projects.updateProject(dir, 'demo', { defaultWorkflow: 'other', workflowKinds: { feature: { name: 'third', inputs: {} } } }).workflowKinds.feature.name, 'third');
});

test('#791 a new default adds no Feature entry to a record without one', (t) => {
  const dir = projectsDir(t, { defaultWorkflow: 'hero', workflowKinds: { fix: { name: 'fix', inputs: {} } } });
  assert.equal(projects.updateProject(dir, 'demo', { defaultWorkflow: 'other' }).workflowKinds.feature, undefined);
});

test('#790 withManifest gives the screens the manifest\'s default and kinds', (t) => {
  const out = projects.withManifest({ id: 'demo', folder: folderWith(t, MANIFEST) });
  assert.deepEqual(out.manifest, { default: 'hero', kinds: { fix: { name: 'fix', inputs: { mode: 'remote' } } } });
});

test('#790 withManifest leaves a project whose manifest declares neither as it is', (t) => {
  const record = { id: 'demo', folder: folderWith(t, 'workflows:\n  - { name: feature }\n') };
  assert.equal(projects.withManifest(record), record);
});

test('#790 withManifest leaves a project without a folder as it is', () => {
  const record = { id: 'demo', error: 'broken file' };
  assert.equal(projects.withManifest(record), record);
});

test('#790 a manifest with another error declares no default and no kinds', () => {
  const out = manifest.parseManifest(`${MANIFEST.replace('category: fix', 'category: nonsense')}`);
  assert.deepEqual([out.workflows, out.default, out.kinds, out.errors.length], [[], null, {}, 1]);
});

test('#791 the mode rule is one: run defaults and the kinds read the same variant', () => {
  const project = { workflows: [{ name: 'x' }, { name: 'feature', variant: 'fork-code' }, { name: 'fix', variant: 'remote-e2e' }] };
  assert.equal(DefaultWorkflow.modeOfPicks(project.workflows), 'fork');
  assert.equal(runDefaults.runDefaultsWith({ project, profile: null }).mode, 'fork');
});

test('#791 modeOfVariant reads a variant that names a mode, else null', () => {
  assert.deepEqual(['local-code', 'remote-e2e', 'fork-code', 'other', ''].map(DefaultWorkflow.modeOfVariant), ['local', 'remote', 'fork', null, null]);
});

test('#791 installedFile: the name\'s file, a repository copy of that name, else null', () => {
  const { installedFile } = DefaultWorkflow;
  assert.deepEqual([installedFile('fix', ['fix.yaml']), installedFile('hero.yaml', ['workflows/hero.yaml']), installedFile('ghost', ['fix.yaml']), installedFile('', ['fix.yaml'])], ['fix.yaml', 'workflows/hero.yaml', null, null]);
});

test('#791 entryKind: a refactor uses the Feature entry', () => {
  assert.deepEqual(DefaultWorkflow.KINDS.map(DefaultWorkflow.entryKind), ['feature', 'fix', 'feature']);
});

test('#791 projectWorkflows offers what the record\'s manifest names when no kinds are given', () => {
  const list = [{ file: 'hero.yaml', inputs: task }, { file: 'fix.yaml', inputs: task }, { file: 'unrelated.yaml', inputs: task }];
  const project = { manifest: { default: 'hero', kinds: { fix: { name: 'fix', inputs: {} } } } };
  assert.deepEqual(DefaultWorkflow.projectWorkflows(list, project).map((w) => w.file), ['hero.yaml', 'fix.yaml']);
});

// ---- a plan's kinds --------------------------------------------------------------------------------

const FIX = { file: 'fix.yaml', name: 'fix', inputs: { ...task, mode: { type: 'string', default: 'local', enum: ['local', 'remote'] } } };
const FEATURE = { file: 'feature.yaml', name: 'feature', inputs: task };
const KINDS = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
const issue = (number, ...labels) => ({ number, state: 'open', title: `Issue ${number}`, labels: labels.map((name) => ({ name })), body: 'x'.repeat(200) });
const answer = (group, issues, extra = {}) => productOwner.normalizeAnswer({ summary: 's', groups: [group], conflicts: [], enrich: [] }, { issues, history: [], workflows: [FEATURE, FIX], workflowKinds: KINDS, ...extra });

test('#791 the kind\'s input wins over the same input from the model', () => {
  const [g] = answer({ name: 'A bug', issues: [8], workflow: 'fix.yaml', inputs: { mode: 'local' }, reason: 'r', stage: 1 }, [issue(8, 'bug')]).groups;
  assert.equal(g.inputs.mode, 'remote');
});

test('#791 a group keeps each issue\'s reason', () => {
  const issue_kinds = [{ issue: 1, kind: 'fix', reason: 'One.' }, { issue: 2, kind: 'fix', reason: 'Two.' }];
  const [g] = answer({ name: 'Bugs', issues: [1, 2], workflow: 'fix.yaml', issue_kinds, reason: 'r', stage: 1 }, [issue(1), issue(2)]).groups;
  assert.deepEqual(g.kindReasons, [{ issue: 1, reason: 'One.' }, { issue: 2, reason: 'Two.' }]);
});

test('#791 a reason of the code carries its i18n key', () => {
  const [g] = answer({ name: 'A bug', issues: [8], workflow: 'fix.yaml', reason: 'r', stage: 1 }, [issue(8, 'bug')]).groups;
  assert.equal(g.kindReasons[0].reasonKey, 'po.kind.reason_bug');
});

test('#791 the model\'s own reason has no key, even when it sends an unknown one', () => {
  const issue_kinds = [{ issue: 8, kind: 'fix', reason: 'Mine.', reasonKey: 'app.title' }];
  const [g] = answer({ name: 'A bug', issues: [8], workflow: 'fix.yaml', issue_kinds, reason: 'r', stage: 1 }, [issue(8)]).groups;
  assert.deepEqual(g.kindReasons, [{ issue: 8, reason: 'Mine.' }]);
});
