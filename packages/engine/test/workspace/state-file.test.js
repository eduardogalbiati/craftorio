// packages/engine/domains/workspace/state-file.js (#112): atomic, validated writes of the workspace state files the app rewrites
// (roadmap.json, queue.json): a write that would produce an invalid file is refused, the previous
// version is kept as <file>.bak, and the file itself is replaced by a rename (never read half-written).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic, writeJsonSafe } = require('../../domains/workspace/state-file');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-file-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('writeFileAtomic (#256) writes text or bytes whole, creating the folder, with no temp file and no .bak', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'card', 'document.md');
  writeFileAtomic(file, 'first');
  writeFileAtomic(file, 'second');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  writeFileAtomic(path.join(dir, 'card', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'card', 'shot.png'))], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'card')).sort(), ['document.md', 'shot.png']);
});

test('writeFileAtomic (#256) leaves no temp file when the write fails, and what was there stays whole', (t) => {
  const dir = tmp(t);
  // the target is a folder with a file in it: the rename over it fails
  const target = path.join(dir, 'busy');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'kept');
  assert.throws(() => writeFileAtomic(target, 'new content'));
  assert.deepEqual(fs.readdirSync(dir), ['busy']);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'kept');
  // the content cannot be written at all (not a string or bytes)
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');
  assert.throws(() => writeFileAtomic(file, 42));
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['busy', 'doc.md']);
});

test('writeJsonSafe writes the file, formatted, and leaves no temp file behind', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'sub', 'roadmap.json');
  const out = writeJsonSafe(file, { a: 1 });
  assert.deepEqual(out, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sub')), ['roadmap.json']);
});

test('writeJsonSafe keeps the previous version as <file>.bak once there is one to keep', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'roadmap.json');
  writeJsonSafe(file, { a: 1 });
  assert.equal(fs.existsSync(`${file}.bak`), false, 'nothing to back up on the first write');
  writeJsonSafe(file, { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { a: 1 });
  writeJsonSafe(file, { a: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 3 });
});

test('writeJsonSafe refuses a write that validate rejects, logs it, and leaves the file untouched', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'roadmap.json');
  writeJsonSafe(file, { a: 1 }, { validate: () => null });
  const before = fs.readFileSync(file, 'utf8');

  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  t.after(() => { console.error = origError; });
  assert.throws(
    () => writeJsonSafe(file, { a: 'broken' }, { validate: (d) => (d.a === 'broken' ? 'a must be a number' : null) }),
    /Refused to write roadmap\.json: a must be a number/,
  );
  assert.ok(errors.some((e) => /a must be a number/.test(e)));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file on disk is exactly as it was');
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'no temp file left: validation runs before anything is written');
});

test('writeJsonSafe: a file a reader keeps open fails the write (retried, then given up) without ever corrupting it', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'roadmap.json');
  writeJsonSafe(file, { a: 1 });
  // a reader holding the file open the whole time (Windows: EBUSY/EPERM/EACCES) makes the rename
  // retry and, once it keeps failing, give up instead of leaving a half-written file. Only Windows
  // refuses the rename of an open file, so the filesystem's answer is given here on every
  // platform (#768): the rename over roadmap.json keeps failing with EBUSY
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (path.resolve(String(to)) === path.resolve(file)) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}' -> '${to}'`), { code: 'EBUSY' });
    return rename(from, to);
  });
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  t.after(() => { console.error = origError; });
  assert.throws(() => writeJsonSafe(file, { a: 2 }));
  assert.ok(errors.some((e) => /Could not replace roadmap\.json/.test(e)));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 }, 'the file on disk is exactly as it was, never half-written');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['roadmap.json', 'roadmap.json.bak'], 'the temp file was cleaned up, not left behind');
});
