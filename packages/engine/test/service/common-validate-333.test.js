// #333: the shared input guards of the service channels (packages/engine/service/common.js). A channel validates
// what a client sent where it receives it: "an id is a file name inside its folder" (requireId) and
// "a string of at most N characters" (requireText). A refusal is an Error whose message names the
// problem (with the parameter's name) and carries status 400, so the server answers a client
// error (4xx), not a 500.
// Seam: requireId(value, what) and requireText(value, what, max) exported by packages/engine/service/common.js.
// They are created by the change: loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const load = () => require('../../service/common.js');

// Runs fn and returns what it threw, as primitives (never the error object itself to an assertion).
function refusal(fn) {
  try { fn(); } catch (e) {
    return { isError: e instanceof Error, status: e.status, message: String(e.message) };
  }
  return null;
}

const MB = 'x'.repeat(1024 * 1024);
const outsideAbs = path.join(os.tmpdir(), 'outside-333');

test('#333 requireId returns a plain file name as it is', () => {
  const { requireId } = load();
  assert.equal(typeof requireId, 'function');
  assert.equal(requireId('20261013-000943-59c3bdb4', 'run id'), '20261013-000943-59c3bdb4');
  assert.equal(requireId('abc-1', 'project id'), 'abc-1');
  assert.equal(requireId('software-development.yaml', 'workflow file'), 'software-development.yaml');
});

test('#333 requireId refuses what is not a file name inside its folder, naming the parameter, with status 400', () => {
  const { requireId } = load();
  const hostile = {
    missing: undefined,
    null: null,
    number: 42,
    array: ['a'],
    object: { id: 'a' },
    'empty string': '',
    dot: '.',
    'dot dot': '..',
    'parent path': '../../outside',
    'slash inside': 'a/b',
    'backslash inside': 'a\\b',
    'absolute path': outsideAbs,
    'posix absolute path': '/etc/passwd',
    'NUL byte': 'a\0b',
    '1 MB string': MB,
    '__proto__ object': JSON.parse('{"__proto__": {"polluted": "yes"}}'),
  };
  for (const [label, value] of Object.entries(hostile)) {
    const r = refusal(() => requireId(value, 'run id'));
    assert.notEqual(r, null, `${label}: accepted`);
    assert.equal(r.isError, true, `${label}: throws an Error`);
    assert.equal(r.status, 400, `${label}: status 400`);
    assert.match(r.message, /run id/, `${label}: the message names the parameter`);
    assert.ok(r.message.length < 1000, `${label}: the message does not echo a huge value`);
  }
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});

test('#333 docs/agents/testing.md describes the channel sweep and how to add a skip', () => {
  const fs = require('fs');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'agents', 'testing.md'), 'utf8');
  assert.match(doc, /service-channel-sweep-333/);
  assert.match(doc, /channel-sweep-skips\.js/);
  assert.match(doc, /hostile/i);
});

test('#333 requireText returns a string of at most N characters as it is', () => {
  const { requireText } = load();
  assert.equal(typeof requireText, 'function');
  assert.equal(requireText('hello', 'title', 100), 'hello');
  assert.equal(requireText('a'.repeat(100), 'title', 100), 'a'.repeat(100));
  assert.equal(requireText('çà 漢字 🙂', 'title', 100), 'çà 漢字 🙂');
});

test('#333 requireText refuses a non-string or a string over N characters, naming the parameter, with status 400', () => {
  const { requireText } = load();
  const hostile = {
    missing: undefined,
    null: null,
    number: 42,
    array: ['a'],
    object: { text: 'a' },
    'one over the limit': 'a'.repeat(101),
    '1 MB string': MB,
  };
  for (const [label, value] of Object.entries(hostile)) {
    const r = refusal(() => requireText(value, 'title', 100));
    assert.notEqual(r, null, `${label}: accepted`);
    assert.equal(r.isError, true, `${label}: throws an Error`);
    assert.equal(r.status, 400, `${label}: status 400`);
    assert.match(r.message, /title/, `${label}: the message names the parameter`);
    assert.ok(r.message.length < 1000, `${label}: the message does not echo a huge value`);
  }
});
