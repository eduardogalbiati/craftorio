// #389 acceptance: loadWorkflow (packages/engine/engine/workflow, run/load.js) is cached by the file's mtime.
//
// The contract these tests assume:
//   - loadWorkflow(file) of a file whose mtime (and size) did not change since the last load does
//     not read nor parse the file again (observed through fs.readFileSync of that file);
//   - each call still hands out its own workflow: what a caller changes on the object it got never
//     shows in a later load (a deep copy of the cached definition, or an immutable one), and the
//     non-enumerable `warnings` (#286) is still there;
//   - a file whose mtime changed is read again and its new content returned;
//   - #407: a same-size rewrite that lands within the mtime's resolution (the mtime does not
//     change) is not masked by the cache: the cache re-reads the text until an entry has been
//     confirmed clean for more than RACY_MS after the mtime (git's "racy clean" rule).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const BUNDLED = path.join(__dirname, '..', '..', '..', 'workflows', 'write-doc.yaml');

function tempCopy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cache-389-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'write-doc.yaml');
  fs.copyFileSync(BUNDLED, file);
  // #407: copyFileSync keeps the source's mtime on Windows (CopyFileW) but not on every
  // platform (e.g. Linux's copy_file_range gives the copy a fresh mtime); pin an old one so the
  // racy-clean check (RACY_MS) does not depend on that.
  const old = new Date(Date.now() - 10000);
  fs.utimesSync(file, old, old);
  return file;
}

// how many times fs.readFileSync read `file` while fn ran
function readsOf(t, file, fn) {
  const target = path.resolve(file).toLowerCase();
  let reads = 0;
  const original = fs.readFileSync;
  const spy = t.mock.method(fs, 'readFileSync', function readFileSync(p, ...rest) {
    if (typeof p === 'string' && path.resolve(p).toLowerCase() === target) reads++;
    return original.call(this, p, ...rest);
  });
  try {
    const out = fn();
    return { out, reads };
  } finally {
    spy.mock.restore();
  }
}

test('loadWorkflow does not read an unchanged workflow file again (#389)', (t) => {
  const file = tempCopy(t);
  const first = loadWorkflow(file);
  assert.equal(first.metadata.name, 'write-doc');

  const { out: second, reads } = readsOf(t, file, () => loadWorkflow(file));
  assert.equal(reads, 0, 'the second load of the same file (same mtime) comes from the cache');
  assert.equal(second.metadata.name, 'write-doc');
  assert.ok(Array.isArray(second.warnings), 'the cached workflow keeps its warnings (#286)');

  // a caller changing its copy never changes what the next load returns
  second.metadata.name = 'changed by a caller';
  assert.equal(loadWorkflow(file).metadata.name, 'write-doc');
});

test('loadWorkflow reads a workflow file again once its mtime changed (#389)', (t) => {
  const file = tempCopy(t);
  assert.equal(loadWorkflow(file).metadata.name, 'write-doc');
  // the cache is in use before the edit
  assert.equal(readsOf(t, file, () => loadWorkflow(file)).reads, 0, 'the unchanged file comes from the cache');

  fs.writeFileSync(file, fs.readFileSync(BUNDLED, 'utf8').replace('  name: write-doc', '  name: write-doc-edited'));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);

  const { out, reads } = readsOf(t, file, () => loadWorkflow(file));
  assert.equal(reads, 1, 'the edited file is read again');
  assert.equal(out.metadata.name, 'write-doc-edited');
});

test('a same-size rewrite within the mtime tick is not masked by the cache (#407)', (t) => {
  const file = tempCopy(t);
  // start inside the racy window: the entry's first read is close to the file's mtime
  const recent = new Date();
  fs.utimesSync(file, recent, recent);
  const first = loadWorkflow(file);
  assert.equal(first.metadata.name, 'write-doc');

  // same byte length ('write-doc' -> 'write-dox'), and the mtime is forced back to
  // the exact same value: the cache key (mtime + size) does not change, only the text does
  const original = fs.readFileSync(file, 'utf8');
  const rewritten = original.replace('name: write-doc', 'name: write-dox');
  assert.equal(rewritten.length, original.length, 'the rewrite must keep the cache key (mtime+size) the same');
  fs.writeFileSync(file, rewritten);
  fs.utimesSync(file, recent, recent);

  const second = loadWorkflow(file);
  assert.equal(second.metadata.name, 'write-dox', 'a same-mtime, same-size rewrite is not masked by the stale cache');
});

test('a racy reload of unchanged text still hands out a fresh clone of the cached parse (#407)', (t) => {
  const file = tempCopy(t);
  const recent = new Date();
  fs.utimesSync(file, recent, recent);
  const first = loadWorkflow(file);
  assert.equal(first.metadata.name, 'write-doc');

  // still inside the racy window: the text is re-read to confirm it did not change, but the
  // parse is reused (no re-parse) and each call still hands out its own copy
  const { out: second, reads } = readsOf(t, file, () => loadWorkflow(file));
  assert.equal(reads, 1, 'a racy reload re-reads the text to check it is unchanged');
  assert.equal(second.metadata.name, 'write-doc');

  second.metadata.name = 'changed by a caller';
  assert.equal(loadWorkflow(file).metadata.name, 'write-doc');
});
