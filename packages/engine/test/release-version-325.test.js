// Release version (#325), packages/engine/domains/releases/releases.js `writeReleaseVersion({ dir, version, mock })`: before the
// suites, a release run writes the release's version into the project folder's package.json (and the
// root `version` / `packages[""].version` of package-lock.json or npm-shrinkwrap.json) and commits it
// on the branch checked out there. Formatting is kept (indentation, key order, CRLF or LF); workspace
// packages are untouched; no commit when there is no package.json, the file already names the
// version, the release version is lower (never downgrades) or the release's name is not a semver
// (`release-<run id>`, `v1.4`); a leading `v` is dropped. A mock run writes nothing and says what it
// would set. The result is read through its public fields: written, from, to, commit, reason.
// Throwaway repositories in os.tmpdir(), no user git config, as in test/releases-260.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// loaded inside each test: the function is created by the change
const load = () => {
  delete require.cache[require.resolve('../domains/releases/releases')];
  return require('../domains/releases/releases');
};
const writeReleaseVersion = (opts) => {
  const fn = load().writeReleaseVersion;
  assert.equal(typeof fn, 'function', 'packages/engine/domains/releases/releases.js exports writeReleaseVersion');
  return fn(opts);
};

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository with `files` committed on main, then the run's branch checked out
function repoWith(t, files) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, 'init', '-q');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'release-fix-run1');
  return dir;
}
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const head = (dir) => git(dir, 'rev-parse', 'HEAD');
const commitCount = (dir) => Number(git(dir, 'rev-list', '--count', 'HEAD'));

const PKG_CRLF = '{\r\n  "name": "app",\r\n  "version": "0.3.0",\r\n  "private": true,\r\n  "scripts": {\r\n    "test": "node --test"\r\n  }\r\n}\r\n';
const LOCK = '{\n  "name": "app",\n  "version": "0.3.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "app",\n      "version": "0.3.0"\n    },\n    "packages/lib": {\n      "name": "lib",\n      "version": "0.3.0"\n    },\n    "node_modules/dep": {\n      "version": "0.3.0"\n    }\n  }\n}\n';
const LIB_PKG = '{\n  "name": "lib",\n  "version": "0.3.0"\n}\n';

test('writes the version into package.json and the lockfile, keeping CRLF, indentation and key order, in one commit (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': PKG_CRLF, 'package-lock.json': LOCK, 'packages/lib/package.json': LIB_PKG });
  const before = commitCount(dir);
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, true);
  assert.equal(r.from, '0.3.0');
  assert.equal(r.to, '1.2.0');
  assert.equal(read(dir, 'package.json'), PKG_CRLF.replace('"version": "0.3.0"', '"version": "1.2.0"'));
  assert.equal(read(dir, 'package-lock.json'), '{\n  "name": "app",\n  "version": "1.2.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "app",\n      "version": "1.2.0"\n    },\n    "packages/lib": {\n      "name": "lib",\n      "version": "0.3.0"\n    },\n    "node_modules/dep": {\n      "version": "0.3.0"\n    }\n  }\n}\n');
  assert.equal(read(dir, 'packages/lib/package.json'), LIB_PKG, 'a workspace package is untouched');
  assert.equal(commitCount(dir), before + 1, 'one commit');
  assert.equal(r.commit, head(dir), 'the result names the commit');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing left uncommitted');
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['package-lock.json', 'package.json']);
  const message = git(dir, 'log', '-1', '--format=%B');
  assert.match(message, /1\.2\.0/);
  assert.match(message, /package\.json/);
  assert.doesNotMatch(message, /Closes #/);
});

test('commits on the checked-out run branch only: main does not move (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': '{\n  "name": "app",\n  "version": "0.3.0"\n}\n' });
  const main = git(dir, 'rev-parse', 'refs/heads/main');
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, true);
  assert.equal(git(dir, 'rev-parse', 'refs/heads/main'), main);
  assert.equal(git(dir, 'rev-parse', 'refs/heads/release-fix-run1'), r.commit);
});

test('updates npm-shrinkwrap.json like a lockfile (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': '{\n  "name": "app",\n  "version": "0.3.0"\n}\n', 'npm-shrinkwrap.json': LOCK });
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, true);
  const shrink = JSON.parse(read(dir, 'npm-shrinkwrap.json'));
  assert.equal(shrink.version, '1.2.0');
  assert.equal(shrink.packages[''].version, '1.2.0');
  assert.equal(shrink.packages['packages/lib'].version, '0.3.0');
});

test('adds the version field when package.json has none, other keys unchanged (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': '{\n  "name": "app",\n  "private": true\n}\n' });
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, true);
  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.deepEqual(pkg, { name: 'app', private: true, version: pkg.version });
  assert.equal(pkg.version, '1.2.0');
});

test('drops a leading v and accepts a pre-release semver (#325)', async (t) => {
  const a = repoWith(t, { 'package.json': '{\n  "name": "app",\n  "version": "0.3.0"\n}\n' });
  const ra = await writeReleaseVersion({ dir: a, version: 'v1.2.0' });
  assert.equal(ra.written, true);
  assert.equal(JSON.parse(read(a, 'package.json')).version, '1.2.0');
  const b = repoWith(t, { 'package.json': '{\n  "name": "app",\n  "version": "0.3.0"\n}\n' });
  const rb = await writeReleaseVersion({ dir: b, version: '1.2.0-rc.1' });
  assert.equal(rb.written, true);
  assert.equal(JSON.parse(read(b, 'package.json')).version, '1.2.0-rc.1');
});

for (const name of ['release-20261013-001003-b30884f0', 'v1.4', 'Spring drop', '']) {
  test(`a release name that is not a semver (${JSON.stringify(name)}) writes nothing and says why (#325)`, async (t) => {
    const text = '{\n  "name": "app",\n  "version": "0.3.0"\n}\n';
    const dir = repoWith(t, { 'package.json': text });
    const before = head(dir);
    const r = await writeReleaseVersion({ dir, version: name });
    assert.equal(r.written, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.trim().length > 0, 'a reason');
    assert.equal(read(dir, 'package.json'), text);
    assert.equal(head(dir), before, 'no commit');
  });
}

test('no package.json in the project folder: no commit, with a reason (#325)', async (t) => {
  const dir = repoWith(t, { 'pyproject.toml': '[project]\nname = "app"\nversion = "0.3.0"\n' });
  const before = head(dir);
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, false);
  assert.ok(String(r.reason || '').trim(), 'a reason');
  assert.equal(read(dir, 'pyproject.toml'), '[project]\nname = "app"\nversion = "0.3.0"\n', 'other version files are left as they are');
  assert.equal(head(dir), before);
});

test('package.json already at the release version: no commit (#325)', async (t) => {
  const text = '{\n  "name": "app",\n  "version": "1.2.0"\n}\n';
  const dir = repoWith(t, { 'package.json': text });
  const before = head(dir);
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, false);
  assert.equal(read(dir, 'package.json'), text);
  assert.equal(head(dir), before);
});

test('a release version lower than package.json never downgrades it and says so (#325)', async (t) => {
  const text = '{\n  "name": "app",\n  "version": "2.0.0"\n}\n';
  const dir = repoWith(t, { 'package.json': text });
  const before = head(dir);
  const r = await writeReleaseVersion({ dir, version: '1.2.0' });
  assert.equal(r.written, false);
  assert.match(String(r.reason || ''), /2\.0\.0/);
  assert.equal(read(dir, 'package.json'), text);
  assert.equal(head(dir), before);
});

for (const [what, text] of [['a byte order mark', '﻿{\n  "name": "app",\n  "version": "0.3.0"\n}\n'], ['invalid JSON', '{\n  "name": "app",\n  "version": "0.3.0",\n}\n']]) {
  test(`a package.json with ${what} is left unchanged, with a reason (#325)`, async (t) => {
    const dir = repoWith(t, { 'package.json': text });
    const before = head(dir);
    const r = await writeReleaseVersion({ dir, version: '1.2.0' });
    assert.equal(r.written, false);
    assert.ok(String(r.reason || '').trim(), 'a reason');
    assert.equal(read(dir, 'package.json'), text);
    assert.equal(head(dir), before);
  });
}

test('a failed version commit leaves the files as they were and throws (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': PKG_CRLF, 'package-lock.json': LOCK });
  const before = head(dir);
  fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '');
  t.after(() => fs.rmSync(path.join(dir, '.git', 'index.lock'), { force: true }));
  await assert.rejects(async () => writeReleaseVersion({ dir, version: '1.2.0' }));
  assert.equal(read(dir, 'package.json'), PKG_CRLF);
  assert.equal(read(dir, 'package-lock.json'), LOCK);
  assert.equal(head(dir), before);
});

test('mock: writes and commits nothing, and says what it would set (#325)', async (t) => {
  const dir = repoWith(t, { 'package.json': PKG_CRLF, 'package-lock.json': LOCK });
  const before = head(dir);
  const r = await writeReleaseVersion({ dir, version: '1.2.0', mock: true });
  assert.equal(r.written, false);
  assert.equal(r.from, '0.3.0');
  assert.equal(r.to, '1.2.0');
  assert.equal(read(dir, 'package.json'), PKG_CRLF);
  assert.equal(read(dir, 'package-lock.json'), LOCK);
  assert.equal(head(dir), before);
});
