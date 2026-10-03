// src/code-version.js: the version the engine process (Electron main, or `npm run serve`) started
// with, to tell a window it runs newer code than the process (#83, restart banner).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCodeVersion, hashSources, sourceFiles } = require('../src/code-version');

function tmpSrc(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('sourceFiles: every .js/.json/.html/.css file under the tree, including renderer/ and preload.js', (t) => {
  const dir = tmpSrc(t, {
    'main.js': 'a', 'preload.js': 'b', 'renderer/app.js': 'c', 'renderer/style.css': 'd',
    'renderer/index.html': 'e', 'service/index.js': 'f', 'data.json': '{}', 'notes.txt': 'ignored',
  });
  assert.deepEqual(sourceFiles(dir), [
    'data.json', 'main.js', 'preload.js', 'renderer/app.js', 'renderer/index.html', 'renderer/style.css', 'service/index.js',
  ]);
});

test('hashSources: the same tree hashes the same; touching any file (renderer, preload, .css, .html) changes it', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a', 'preload.js': 'b', 'renderer/app.js': 'c', 'renderer/style.css': 'd', 'renderer/index.html': 'e' });
  const base = hashSources(dir);
  assert.equal(hashSources(dir), base, 'hashing the same tree twice gives the same hash');

  fs.writeFileSync(path.join(dir, 'renderer/app.js'), 'c2');
  assert.notEqual(hashSources(dir), base, 'a renderer-only change changes the hash');
  fs.writeFileSync(path.join(dir, 'renderer/app.js'), 'c');

  fs.writeFileSync(path.join(dir, 'preload.js'), 'b2');
  assert.notEqual(hashSources(dir), base, 'a preload-only change changes the hash');
  fs.writeFileSync(path.join(dir, 'preload.js'), 'b');

  fs.writeFileSync(path.join(dir, 'renderer/style.css'), 'd2');
  assert.notEqual(hashSources(dir), base, 'a .css-only change changes the hash');
  fs.writeFileSync(path.join(dir, 'renderer/style.css'), 'd');

  fs.writeFileSync(path.join(dir, 'renderer/index.html'), 'e2');
  assert.notEqual(hashSources(dir), base, 'an .html-only change changes the hash');
});

test('createCodeVersion: check().changed is false right after start, in a directory that has not changed', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a', 'renderer/app.js': 'b' });
  const code = createCodeVersion({ appVersion: '1.0.0', isPackaged: false, dir });
  assert.deepEqual(code.check(), { running: code.running, loaded: null, disk: code.running, changed: false });
});

test('createCodeVersion: check().changed is true once a renderer or preload file changes on disk', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a', 'preload.js': 'b', 'renderer/app.js': 'c' });
  const code = createCodeVersion({ appVersion: '1.0.0', isPackaged: false, dir });
  assert.equal(code.check().changed, false);
  fs.writeFileSync(path.join(dir, 'renderer/app.js'), 'c2');
  assert.equal(code.check().changed, true);
  assert.notEqual(code.check().disk, code.running);
});

test('createCodeVersion: markLoaded() records the version now; a later disk change alone does not mark the window stale', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a' });
  const code = createCodeVersion({ appVersion: '1.0.0', isPackaged: false, dir });
  assert.equal(code.markLoaded(), code.running);
  assert.deepEqual(code.check(), { running: code.running, loaded: code.running, disk: code.running, changed: false });
});

test('createCodeVersion: a window that loaded before a later change is stale even if the file is restored (loaded !== running)', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a' });
  const code = createCodeVersion({ appVersion: '1.0.0', isPackaged: false, dir });
  fs.writeFileSync(path.join(dir, 'main.js'), 'a2');
  code.markLoaded(); // the window loaded the changed code
  fs.writeFileSync(path.join(dir, 'main.js'), 'a'); // the file is restored: disk matches the process again
  const result = code.check();
  assert.notEqual(result.loaded, result.running);
  assert.equal(result.changed, true);
});

test('createCodeVersion: packaged, the version is always the app version and never changes', (t) => {
  const dir = tmpSrc(t, { 'main.js': 'a' });
  const code = createCodeVersion({ appVersion: '2.3.4', isPackaged: true, dir });
  assert.equal(code.running, '2.3.4');
  assert.equal(code.markLoaded(), '2.3.4');
  fs.writeFileSync(path.join(dir, 'main.js'), 'a2'); // a packaged app.asar can't change while it runs
  assert.deepEqual(code.check(), { running: '2.3.4', loaded: '2.3.4', disk: '2.3.4', changed: false });
});
