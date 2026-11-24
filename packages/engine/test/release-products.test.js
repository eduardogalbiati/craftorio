// #46: the products a repository declares in .craftorio/project.yaml (its manifest), the release
// workflow's product input, and the Releases screen and cut line, which belong to the app's releases:
// a release of another product (the tag engine-vX.Y.Z) never counts as one of them. The whole release
// runs are in slow/release-products-46.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { parseManifest } = require('../domains/project/project-manifest');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'release.yaml');

const entry = ({ id = null, folder = '.', prefix = 'v', command = 'npm run bump' }) => `  - ${id === null ? '' : `id: ${id}\n    `}folder: ${folder}\n    tag_prefix: "${prefix}"\n    version_command: ${command}\n`;
const manifest = (...entries) => `version: 1\nproducts:\n${entries.map(entry).join('')}`;
const APP = { id: 'app', folder: 'apps/desktop' };
const ENGINE = { id: 'engine', folder: 'packages/engine', prefix: 'engine-v' };
const PRODUCTS = manifest(APP, ENGINE);

// ---------- the manifest ----------

test('#46 a manifest declares its products: id, folder, tag prefix and version command', () => {
  const out = parseManifest(PRODUCTS);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(Array.from(out.products || []).map((p) => ({ id: p.id, folder: p.folder, tag_prefix: p.tag_prefix, version_command: p.version_command })), [
    { id: 'app', folder: 'apps/desktop', tag_prefix: 'v', version_command: 'npm run bump' },
    { id: 'engine', folder: 'packages/engine', tag_prefix: 'engine-v', version_command: 'npm run bump' },
  ]);
});

test('#46 a manifest without products, or no manifest text, has none', () => {
  assert.deepEqual(parseManifest('version: 1\n').products, []);
  assert.deepEqual(parseManifest('').products, []);
});

for (const [what, text] of [
  ['declared twice', manifest(APP, { ...ENGINE, id: 'app' })],
  ['without an id', manifest(APP, { ...ENGINE, id: null })],
  ['whose folder is outside the repository', manifest(APP, { ...ENGINE, folder: '../engine' })],
  ['that is not in a list', 'version: 1\nproducts: app\n'],
]) {
  test(`#46 a product ${what} is an error of the manifest`, () => {
    const { errors } = parseManifest(text);
    assert.equal(errors.some((e) => /product/i.test(e)), true, `an error about the products: ${JSON.stringify(errors)}`);
  });
}

// ---------- the workflow ----------

test('#46 the release workflow has an optional product input, and nothing of this repository in it', () => {
  const { inputs } = loadWorkflow(WORKFLOW);
  assert.equal(inputs.product?.type, 'string');
  assert.equal(inputs.product?.default, '');
  assert.equal(inputs.product?.required === true, false);
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  for (const own of ['engine-v', 'apps/desktop', 'packages/engine', 'changeset version', 'release:version']) assert.equal(text.includes(own), false, `the bundled workflow does not name ${own}`);
});

// ---------- the Releases screen and the cut line ----------

// a project of two products that shipped the app's v1.0.0, whose run-a merged issue 7 since
const HISTORY = { releases: [{ version: 'v1.0.0', tag: 'v1.0.0', date: '2026-11-01T10:00:00.000Z', commit: 'c0', issues: [], runs: [], status: 'shipped' }], next: { notes: '' } };
function setup(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-products-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const ws = Object.fromEntries(['releases', 'backlog', 'runs', 'projects', 'discovery'].map((d) => [d, path.join(root, d)]));
  const folder = path.join(root, 'repo');
  for (const d of [...Object.values(ws), path.join(folder, '.craftorio')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(folder, '.craftorio', 'project.yaml'), PRODUCTS);
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder }));
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), JSON.stringify(HISTORY));
  const svc = require('../service/areas/releases')({ ws, active: new Map(), notify() {}, refreshLocal: async () => {} });
  const shipped = (product, tag, finishedAt) => svc.afterRelease(
    { file: 'release.yaml', projectId: 'p1', runId: `run-${tag}`, mock: false, inputs: { product, version: '1.1.0', base_branch: 'main' } },
    { summary: { status: 'success', mock: false, finished_at: finishedAt, inputs: { product, version: '1.1.0' }, steps: {}, release: { tag, base: 'main', commit: `commit-of-${tag}`, pushed: true, issues: [] } } },
  );
  return { ws, svc, shipped, list: () => svc.listReleases({ projectId: 'p1' }) };
}
// the app's releases on the screen: an entry of another product is marked as that product's
const appTags = (list) => list.releases.filter((r) => !r.product || r.product === 'app').map((r) => r.tag);

test('#46 a shipped engine release is not listed as a release of the app, and the next version goes on from the app\'s last one', async (t) => {
  const { shipped, list } = setup(t);
  await shipped('engine', 'engine-v1.1.0', '2026-11-20T10:00:00.000Z');
  assert.deepEqual(appTags(list()), ['v1.0.0']);
  assert.equal(list().stable.version, 'v1.0.1', 'the suggested version follows v1.0.0');
  assert.equal(list().next.since, '2026-11-01T10:00:00.000Z', 'the next app release still counts from v1.0.0');
});

test('#46 a shipped app release is the app\'s last release, with or without an engine release before it', async (t) => {
  const { shipped, list } = setup(t);
  await shipped('engine', 'engine-v1.1.0', '2026-11-20T10:00:00.000Z');
  await shipped('app', 'v1.1.0', '2026-11-21T10:00:00.000Z');
  assert.deepEqual(appTags(list()), ['v1.1.0', 'v1.0.0']);
  assert.equal(list().next.since, '2026-11-21T10:00:00.000Z');
});

test('#46 an engine release does not ship the roadmap\'s cut line; the app\'s does', async (t) => {
  const { ws, shipped } = setup(t);
  const roadmap = require('../domains/roadmap/roadmap');
  const line = () => roadmap.readRoadmap(ws.backlog, 'p1').stages.find((s) => s.kind === 'release');
  roadmap.writeRoadmap(ws.backlog, 'p1', { ...roadmap.readRoadmap(ws.backlog, 'p1'), stages: [{ kind: 'release', id: 'rel', name: '1.1.0', items: [] }] });
  await shipped('engine', 'engine-v1.1.0', '2026-11-20T10:00:00.000Z');
  assert.notEqual(line().status, 'shipped', 'the line waits');
  roadmap.takeRelease(ws.backlog, 'p1', 'rel', 'run-v1.1.0');
  await shipped('app', 'v1.1.0', '2026-11-21T10:00:00.000Z');
  assert.equal(line().status, 'shipped');
});
