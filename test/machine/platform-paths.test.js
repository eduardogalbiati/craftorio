// src/domains/machine/platform-paths.js (#318): the one rule to compare paths. Case-insensitive on Windows and
// macOS (default APFS/HFS+), case-sensitive on Linux; on Windows the same normalisation as
// today's src/domains/workspace/store.js / src/host/permissions.js (path.resolve, then lower case), so slashes and a
// trailing separator do not matter. Also: the call sites that compare paths agree with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => require('../../src/domains/machine/platform-paths');

test('samePath: Windows ignores case', () => {
  assert.equal(load().samePath('C:\\Repo\\X', 'c:\\repo\\x', 'win32'), true);
});

test('pathKey: Windows ignores a trailing separator and forward/back slashes (path.win32.resolve)', () => {
  const { pathKey, samePath } = load();
  assert.equal(pathKey('C:\\Repo\\', 'win32'), pathKey('c:/repo', 'win32'));
  assert.equal(samePath('C:/Repo/X/', 'c:\\repo\\x', 'win32'), true);
  assert.equal(samePath('C:\\Repo\\X', 'C:\\Repo\\Y', 'win32'), false);
});

test('pathKey: Windows key is today\'s store/permissions key (path.win32.resolve, lower case)', () => {
  assert.equal(load().pathKey('C:\\Repo\\Sub\\..\\X', 'win32'), path.win32.resolve('C:\\Repo\\Sub\\..\\X').toLowerCase());
});

test('samePath: macOS ignores case', () => {
  assert.equal(load().samePath('/Users/a/Repo', '/users/a/repo', 'darwin'), true);
  assert.equal(load().pathKey('/Users/a/Repo', 'darwin'), load().pathKey('/users/a/repo', 'darwin'));
});

test('samePath: Linux is case-sensitive', () => {
  const { samePath } = load();
  assert.equal(samePath('/Users/a/Repo', '/users/a/repo', 'linux'), false);
  assert.equal(samePath('/home/a/Repo', '/home/a/Repo', 'linux'), true);
  assert.equal(samePath('/home/a/Repo/', '/home/a/Repo', 'linux'), true);
});

test('pathKey: Linux keeps the case', () => {
  assert.equal(load().pathKey('/home/a/Repo', 'linux'), '/home/a/Repo');
});

test('samePath/pathKey: the platform defaults to process.platform', () => {
  const { samePath, pathKey } = load();
  const p = path.join(os.tmpdir(), 'Some', 'Dir');
  assert.equal(samePath(p, p.toUpperCase()), samePath(p, p.toUpperCase(), process.platform));
  assert.equal(pathKey(p), pathKey(p, process.platform));
});

// --- call sites agree with the rule (on the OS running the test) -----------------------------------

test('worktree.samePath agrees with platform-paths on this OS', () => {
  const { samePath } = load();
  const worktree = require('../../src/engine/worktree');
  const p = path.join(os.tmpdir(), 'Platform-Paths-Missing', 'Repo');
  for (const other of [p, p.toLowerCase(), p.toUpperCase()]) {
    assert.equal(worktree.samePath(p, other), samePath(p, other), other);
  }
});

test('permissions.isAppPage compares the page path with the same rule on this OS', () => {
  const { samePath } = load();
  const { isAppPage } = require('../../src/host/permissions');
  const appPage = path.join(os.tmpdir(), 'App-Folder', 'index.html');
  const other = path.join(os.tmpdir(), 'APP-FOLDER', 'index.html');
  assert.equal(isAppPage(pathToFileURL(other).href, appPage), samePath(other, appPage));
  assert.equal(isAppPage(pathToFileURL(appPage).href, appPage), true);
});
