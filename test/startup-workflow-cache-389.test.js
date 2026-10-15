// #389 acceptance: loadWorkflow (src/engine/workflow, run/load.js) is cached by the file's mtime.
//
// The contract these tests assume:
//   - loadWorkflow(file) of a file whose mtime (and size) did not change since the last load does
//     not read nor parse the file again (observed through fs.readFileSync of that file);
//   - each call still hands out its own workflow: what a caller changes on the object it got never
//     shows in a later load (a deep copy of the cached definition, or an immutable one), and the
//     non-enumerable `warnings` (#286) is still there;
//   - a file whose mtime changed is read again and its new content returned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../src/engine/workflow');

const BUNDLED = path.join(__dirname, '..', 'workflows', 'writer-reviewer.yaml');

function tempCopy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cache-389-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'writer-reviewer.yaml');
  fs.copyFileSync(BUNDLED, file);
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
  assert.equal(first.metadata.name, 'writer-reviewer');

  const { out: second, reads } = readsOf(t, file, () => loadWorkflow(file));
  assert.equal(reads, 0, 'the second load of the same file (same mtime) comes from the cache');
  assert.equal(second.metadata.name, 'writer-reviewer');
  assert.ok(Array.isArray(second.warnings), 'the cached workflow keeps its warnings (#286)');

  // a caller changing its copy never changes what the next load returns
  second.metadata.name = 'changed by a caller';
  assert.equal(loadWorkflow(file).metadata.name, 'writer-reviewer');
});

test('loadWorkflow reads a workflow file again once its mtime changed (#389)', (t) => {
  const file = tempCopy(t);
  assert.equal(loadWorkflow(file).metadata.name, 'writer-reviewer');
  // the cache is in use before the edit
  assert.equal(readsOf(t, file, () => loadWorkflow(file)).reads, 0, 'the unchanged file comes from the cache');

  fs.writeFileSync(file, fs.readFileSync(BUNDLED, 'utf8').replace('  name: writer-reviewer', '  name: writer-reviewer-edited'));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);

  const { out, reads } = readsOf(t, file, () => loadWorkflow(file));
  assert.equal(reads, 1, 'the edited file is read again');
  assert.equal(out.metadata.name, 'writer-reviewer-edited');
});
