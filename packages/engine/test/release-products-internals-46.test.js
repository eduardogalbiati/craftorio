// #46 internals: the products of a manifest with other errors, the product and the tag a release is of,
// what stops a product's release (nothing left behind in the worktree), which changesets cover an issue,
// the main product's history next to another product's, and the version command's changeset split.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseManifest } = require('../domains/project/project-manifest');
const { mergeManifest } = require('../domains/workflow/workflow-compose');
const releases = require('../domains/releases/releases');
const { recentReleases } = require('@craftorio/shared/release-version');
const { splitChangeset } = require('../../../scripts/release-product-version');
const { releaseTags } = require('../../../scripts/release-tags');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});
const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const ENGINE = { id: 'engine', folder: 'engine', tag_prefix: 'engine-v', version_command: 'bump', paths: [] };
function repo(t, files = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-products-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, 'init', '-q');
  write(dir, { 'engine/package.json': '{"name":"motor","version":"1.0.0"}\n', ...files });
  commit(dir, 'base');
  return dir;
}
function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}
function commit(dir, message) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); }
// a version command that writes these files
const runs = (dir, files, exit = 0) => async () => { write(dir, files); return { exit_code: exit, output: 'said' }; };
const release = (dir, version, more = {}) => releases.writeProductVersion({ dir, product: ENGINE, version, branch: 'release-fix-x', ...more });

test('#46 another error of the manifest keeps its products; an error of a product voids them all', () => {
  const ok = 'products:\n  - { id: app, folder: ., tag_prefix: v, version_command: bump }\n';
  const other = parseManifest(`default: ghost\n${ok}`);
  assert.deepEqual([other.errors.length, other.products.map((p) => p.id), other.productErrors], [1, ['app'], []]);
  for (const bad of ['  - { id: b, folder: /etc, tag_prefix: b, version_command: bump }', '  - { id: b, folder: b, tag_prefix: v, version_command: bump }', '  - { id: b, folder: b, tag_prefix: "b ", version_command: "" }']) {
    const out = parseManifest(`${ok}${bad}\n`);
    assert.deepEqual([out.products, out.productErrors.length], [[], 1], bad);
  }
  assert.equal(parseManifest('products: [\n').productErrors.length, 1, 'a file that cannot be read may declare products');
  assert.equal(parseManifest('workflows: [\n').productErrors.length, 0);
});

test('#46 a manifest the interview writes again keeps its products', () => {
  const { products } = parseManifest('products:\n  - { id: app, folder: ., tag_prefix: v, version_command: bump }\n');
  assert.deepEqual(mergeManifest({ version: 1, workflows: [], products }, []).products, products);
});

test('#46 a release run stops on a manifest whose products have an error', (t) => {
  const dir = repo(t, { '.craftorio/project.yaml': 'products: app\n' });
  assert.throws(() => releases.productOf(dir, ''), /products must be a list/);
});

test('#46 a repository that declares none is released as it always was, whatever product was asked', (t) => {
  const dir = repo(t);
  assert.deepEqual([releases.productOf(dir, 'engine'), releases.productOf(dir, '')], [null, null]);
});

test('#46 the tag of a product is its prefix and the version, named by the version or by the tag itself', () => {
  assert.deepEqual(['1.2.0', 'v1.2.0', 'engine-v1.2.0', 'Spring drop'].map((n) => releases.productTag(ENGINE, n)), ['engine-v1.2.0', 'engine-v1.2.0', 'engine-v1.2.0', null]);
});

test('#46 a lower version, a name that is not a semver and a taken tag stop the release', async (t) => {
  const dir = repo(t);
  await assert.rejects(release(dir, '0.9.0'), /lower than its version 1\.0\.0/);
  await assert.rejects(release(dir, 'Spring drop'), /needs a semver version/);
  git(dir, 'tag', 'engine-v1.1.0');
  await assert.rejects(release(dir, '1.1.0'), /engine-v1\.1\.0 already names another commit/);
});

for (const [what, files, exit, error] of [
  ['fails', { 'engine/package.json': '{"name":"motor","version":"1.1.0"}', 'engine/new.md': 'x' }, 3, /failed \(exit code 3\): said/],
  ['writes another version', { 'engine/package.json': '{"name":"motor","version":"1.3.0"}', 'engine/new.md': 'x' }, 0, /asks for engine 1\.1\.0.*leaves it at 1\.3\.0/],
  ['writes nothing', {}, 0, /asks for engine 1\.1\.0.*leaves it at 1\.0\.0/],
]) {
  test(`#46 a version command that ${what} leaves the worktree as it was`, async (t) => {
    const dir = repo(t);
    write(dir, { 'mine.txt': 'not the command\'s' });
    const head = git(dir, 'rev-parse', 'HEAD');
    await assert.rejects(release(dir, '1.1.0', { run: runs(dir, files, exit) }), error);
    assert.deepEqual([git(dir, 'rev-parse', 'HEAD'), git(dir, 'status', '--porcelain')], [head, '?? mine.txt']);
    assert.equal(git(dir, 'branch', '--list', 'release-fix-x'), '');
  });
}

test('#46 every file the command wrote is in the version commit, and only those', async (t) => {
  const dir = repo(t);
  git(dir, 'checkout', '-q', '--detach');
  write(dir, { 'mine.txt': 'not the command\'s' });
  const out = await release(dir, '1.1.0', { run: runs(dir, { 'engine/package.json': '{"name":"motor","version":"1.1.0"}', 'engine/CHANGELOG.md': '## 1.1.0' }) });
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['engine/CHANGELOG.md', 'engine/package.json']);
  assert.deepEqual([out.commit, out.change, git(dir, 'branch', '--show-current')], [git(dir, 'rev-parse', 'HEAD'), 'engine/package.json 1.0.0 → 1.1.0', 'release-fix-x']);
});

test('#46 a changeset of another package does not cover an issue of the product; a repository without changesets lists none', async (t) => {
  const dir = repo(t, { '.changeset/a-5.md': '---\n"other": minor\n---\n', '.changeset/b.md': '---\n"motor": patch\n---\n\nAbout #6.\n' });
  for (const n of [5, 6]) { write(dir, { [`engine/${n}.js`]: '1' }); commit(dir, `Work\n\nCloses #${n}`); }
  const out = await release(dir, '1.1.0', { mock: true });
  assert.deepEqual([out.issues, out.missing_changesets], [[5, 6], [5]]);
  fs.rmSync(path.join(dir, '.changeset'), { recursive: true });
  assert.deepEqual((await release(dir, '1.1.0', { mock: true })).missing_changesets, []);
});

test('#46 a pre-release tag is not the last release of a stable version', async (t) => {
  const dir = repo(t);
  for (const tag of ['engine-v0.9.0', 'engine-v1.1.0-rc.1', 'engine-vnext', 'v1.0.5']) git(dir, 'tag', tag);
  assert.equal((await release(dir, '1.1.0', { mock: true })).previous_version, 'engine-v0.9.0');
});

test('#46 another product\'s release is not the last one, nor in the recent ones, and keeps the next notes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  releases.recordRelease(dir, 'p', { version: 'v1.0.0', tag: 'v1.0.0', date: '2026-11-01' });
  releases.saveNextNotes(dir, 'p', 'Mine');
  releases.recordRelease(dir, 'p', { product: 'engine', version: 'engine-v1.1.0', tag: 'engine-v1.1.0', date: '2026-11-02' });
  const h = releases.readReleases(dir, 'p');
  assert.deepEqual([releases.lastRelease(h).tag, h.next.notes, recentReleases(h.releases).map((r) => r.tag)], ['v1.0.0', 'Mine', ['v1.0.0']]);
});

test('#46 a changeset is split between the product and the others, quoted or not, with CRLF', () => {
  assert.deepEqual(splitChangeset('---\n"a": minor\nb: patch\n---\n\nText\n', ['b']), { own: '---\nb: patch\n---\n\nText\n', rest: '---\n"a": minor\n---\n\nText\n' });
  assert.deepEqual(splitChangeset('---\r\n\'a\': minor\r\n---\r\n\r\nText', ['a']), { own: '---\r\n\'a\': minor\r\n---\r\n\r\nText', rest: null });
  assert.equal(splitChangeset('---\n---\n\nEmpty\n', ['a']).own, null);
});

test('#46 release-tags makes the chosen product\'s tag only', () => {
  const now = { app: '2.0.0', engine: '2.0.0' };
  assert.deepEqual(releaseTags(now, { before: { app: '1.0.0', engine: '1.0.0' }, product: 'engine' }), ['engine-v2.0.0']);
});
