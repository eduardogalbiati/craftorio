// #46, the edges the acceptance and internals tests leave: a product's other folders (`paths`), a version
// file that is not package.json, a version command that commits by itself, a worktree with changes, the
// product input of a repository without products, the product's tags in a prompt, an output's `default`,
// the product the Releases screen starts and the release runs the Roadmap draws for two products.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const releases = require('../domains/releases/releases');
const machineActions = require('../engine/machine-actions');
const { WorkflowRun, loadWorkflow, render } = require('../engine/workflow');
const area = require('../service/areas/releases');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'release.yaml');
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});
const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const ENGINE = { id: 'engine', folder: 'engine', tag_prefix: 'engine-v', version_command: 'bump', paths: [] };
const pkg = (name, version) => `${JSON.stringify({ name, version }, null, 2)}\n`;

function tempDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-edges-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}
function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}
function commit(dir, message, files = {}) { write(dir, files); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); }
function repo(t, files) {
  const dir = tempDir(t);
  git(dir, 'init', '-q');
  commit(dir, 'base', files);
  return dir;
}
const release = (dir, version, { product = ENGINE, ...more } = {}) => releases.writeProductVersion({ dir, product, version, branch: 'release-fix-x', ...more });

// ---------- what a product is made of ----------

test('#46 the issues of a product are those of its folder and its paths; a changeset of a paths package covers one', async (t) => {
  const dir = repo(t, { 'engine/package.json': pkg('motor', '1.0.0'), 'shared/package.json': pkg('common', '1.0.0'), '.changeset/common-8.md': '---\n"common": patch\n---\n\nShared.\n' });
  commit(dir, 'Shared work\n\nCloses #8', { 'shared/a.js': '1' });
  commit(dir, 'More shared work\n\nCloses #9', { 'shared/b.js': '1' });
  commit(dir, 'App work\n\nCloses #10', { 'app/a.js': '1' });
  const out = await release(dir, '1.1.0', { product: { ...ENGINE, paths: ['shared'] }, mock: true });
  assert.deepEqual([out.issues, out.missing_changesets], [[8, 9], [9]]);
  assert.deepEqual((await release(dir, '1.1.0', { mock: true })).issues, [], 'without paths, only its folder');
});

test('#46 a product whose version is in pyproject.toml is released from it; one with no version file stops the release', async (t) => {
  const dir = repo(t, { 'py/pyproject.toml': '[project]\nname = "py"\nversion = "1.0.0"\n' });
  const run = async () => { write(dir, { 'py/pyproject.toml': '[project]\nname = "py"\nversion = "1.1.0"\n' }); return { exit_code: 0, output: '' }; };
  const product = { ...ENGINE, id: 'py', folder: 'py', tag_prefix: 'py-' };
  const out = await release(dir, '1.1.0', { product, run });
  assert.deepEqual([out.change, out.tag, out.files], ['py/pyproject.toml 1.0.0 → 1.1.0', 'py-1.1.0', ['py/pyproject.toml']]);
  await assert.rejects(release(dir, '1.1.0'), /engine has no version in engine/);
});

// ---------- the version command ----------

test('#46 a version command that commits by itself stops the release, and its commit is undone', async (t) => {
  const dir = repo(t, { 'engine/package.json': pkg('motor', '1.0.0') });
  const head = git(dir, 'rev-parse', 'HEAD');
  const run = async () => { commit(dir, 'mine', { 'engine/package.json': pkg('motor', '1.1.0') }); return { exit_code: 0, output: '' }; };
  await assert.rejects(release(dir, '1.1.0', { run }), /made a commit/);
  assert.deepEqual([git(dir, 'rev-parse', 'HEAD'), git(dir, 'status', '--porcelain')], [head, '']);
});

test('#46 a worktree with uncommitted changes stops the release before the command, and keeps them', async (t) => {
  const dir = repo(t, { 'engine/package.json': pkg('motor', '1.0.0'), 'a.txt': 'a' });
  write(dir, { 'a.txt': 'changed' });
  let ran = false;
  await assert.rejects(release(dir, '1.1.0', { run: async () => { ran = true; return { exit_code: 0, output: '' }; } }), /uncommitted changes \(a\.txt\)/);
  assert.deepEqual([ran, fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')], [false, 'changed']);
});

// ---------- the step, a prompt's tags, an output's default ----------

test('#46 a product asked of a repository without products is ignored with a warning: the version is written as before', async (t) => {
  const dir = repo(t, { 'package.json': pkg('solo', '1.0.0') });
  const events = [];
  const state = { mock: false, machine: machineActions.real(), runDir: dir, worktree: { repo: dir, base: 'main' }, ctx: { worktree_dir: dir }, emitEvent: (type, data) => events.push({ type, ...data }) };
  const out = await WorkflowRun.prototype.runReleaseVersionStep.call(state, { id: 'version', type: 'release_version', version: '1.1.0', product: 'engine' });
  assert.deepEqual([out.written, out.to, out.tag], [true, '1.1.0', undefined]);
  assert.deepEqual(events.filter((e) => e.level === 'warn').map((e) => /declares no products.*engine is ignored/.test(e.message)), [true]);
});

test('#46 the tags of a prompt: every one without a prefix, else those that are the prefix and a number', (t) => {
  const dir = repo(t, { 'a.txt': 'a' });
  for (const tag of ['1.0.0', 'v1.0.0', 'vnext', 'engine-v1.0.0']) git(dir, 'tag', tag);
  const tags = (prefix) => render('{{ dir | git_tags(9, prefix) }}', { dir, prefix }).split('\n').filter(Boolean).sort();
  assert.deepEqual(tags(undefined), ['1.0.0', 'engine-v1.0.0', 'v1.0.0', 'vnext']);
  assert.deepEqual([tags(''), tags('v'), tags('engine-v')], [['1.0.0'], ['v1.0.0'], ['engine-v1.0.0']]);
});

test('#46 an output\'s default is a string of a string output', (t) => {
  const file = path.join(tempDir(t), 'w.yaml');
  const load = (output) => {
    fs.writeFileSync(file, `name: w\nagents:\n  a: { provider: claude, model: m, session: ephemeral }\nsteps:\n  - id: a\n    type: human_approval\n    message: m\n    transitions: [{ when: "true", goto: end }]\noutputs:\n  x: ${output}\n`);
    return loadWorkflow(file).outputs.x;
  };
  assert.equal(load('{ type: string, value: "{{ run_id }}", default: "" }').default, '');
  assert.throws(() => load('{ type: string, value: "{{ run_id }}", default: 3 }'), /outputs\.x\.default must be a string/);
  assert.throws(() => load('{ type: number, value: "{{ run_id }}", default: "3" }'), /outputs\.x\.default must be a string/);
});

// ---------- the Releases screen and the Roadmap ----------

const declared = (...list) => `version: 1\nproducts:\n${list.map(([id, prefix]) => `  - { id: ${id}, folder: ${id}, tag_prefix: "${prefix}", version_command: bump }\n`).join('')}`;
function service(t, manifest, history = { releases: [], next: { notes: '' } }) {
  const root = tempDir(t);
  const ws = Object.fromEntries(['releases', 'backlog', 'runs', 'projects', 'discovery'].map((d) => [d, path.join(root, d)]));
  const folder = path.join(root, 'repo');
  for (const d of [...Object.values(ws), folder]) fs.mkdirSync(d, { recursive: true });
  if (manifest) write(folder, { '.craftorio/project.yaml': manifest });
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder }));
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), JSON.stringify(history));
  const started = [];
  const svc = area({ ws, active: new Map(), notify() {}, refreshLocal: async () => {}, projectWorkflowFile: () => WORKFLOW, startWorkflowRun: async (o) => { started.push(o); return { runId: 'run-1' }; } });
  return { svc, started, project: { id: 'p1', name: 'demo', folder } };
}

for (const [what, manifest, product] of [
  ['the one tagged vX.Y.Z of two products', declared(['engine', 'engine-v'], ['app', 'v']), 'app'],
  ['the first of two products with prefixes of their own', declared(['engine', 'engine-v'], ['app', 'app-v']), 'engine'],
  ['no product, with only one', declared(['engine', 'engine-v']), undefined],
  ['no product, with none declared', null, undefined],
]) {
  test(`#46 the Releases screen starts the release of ${what}`, async (t) => {
    const { svc, started } = service(t, manifest);
    await svc.startRelease({ projectId: 'p1', version: '1.1.0', simulated: true });
    assert.deepEqual(started.map((s) => [s.inputs.product, s.inputs.version]), [[product, '1.1.0']]);
  });
}

test('#46 the Roadmap draws the release runs of two products apart: one product\'s release hides no run of the other', (t) => {
  const { svc, project } = service(t, declared(['app', 'v'], ['engine', 'engine-v']), { releases: [
    { version: 'v1.0.0', tag: 'v1.0.0', date: '2026-11-01T10:00:00.000Z', issues: [], runs: [], status: 'shipped' },
    { product: 'engine', version: 'engine-v1.1.0', tag: 'engine-v1.1.0', date: '2026-11-05T10:00:00.000Z', issues: [], runs: [], status: 'shipped' },
  ], next: { notes: '' } });
  const run = (runId, startedAt, inputs) => ({ runId, file: 'release.yaml', status: 'cancelled', startedAt, inputs });
  const out = svc.roadmapReleases(project, [
    run('app-run', '2026-11-03T10:00:00.000Z', { product: 'app', version: '1.2.0' }),
    run('engine-old', '2026-11-04T10:00:00.000Z', { product: 'engine', version: '1.0.5' }),
    run('engine-run', '2026-11-06T10:00:00.000Z', { product: 'engine', version: '1.2.0' }),
  ]).releases;
  assert.deepEqual(out.filter((r) => r.status === 'held').map((r) => [r.runId, r.version, r.product]).sort(), [['app-run', '1.2.0', undefined], ['engine-run', 'engine-v1.2.0', 'engine']]);
});
