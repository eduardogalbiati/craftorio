// #333: the guards of packages/engine/service/common.js the acceptance tests do not cover: requireObject (the
// options object of a `params: 'opts'` channel) and requireArgs (what the service checks once for
// every channel with named params: an object, whose runId / projectId / cardId are file names).
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireArgs, requireObject } = require('../../service/common');

// What fn threw, as primitives (null when it did not throw).
function refusal(fn) {
  try { fn(); } catch (e) { return { status: e.status, message: e.message }; }
  return null;
}

test('#333 requireObject: none is {}, an object is returned as it is, anything else is a 400 naming it', () => {
  assert.deepEqual(requireObject(undefined, 'options'), {});
  const opts = { a: 1 };
  assert.equal(requireObject(opts, 'options'), opts);
  for (const value of [null, 42, 'text', ['a'], true]) {
    const r = refusal(() => requireObject(value, 'options'));
    assert.equal(r?.status, 400, `${JSON.stringify(value)}: refused`);
    assert.match(r.message, /options/);
  }
});

test('#333 requireArgs leaves a channel without named params alone', () => {
  assert.equal(requireArgs('a path', 'path'), 'a path');
  assert.equal(requireArgs(null, undefined), null);
});

test('#333 requireArgs: the object of named params, {} for none, refusing null, a list or a scalar', () => {
  assert.deepEqual(requireArgs(undefined, ['runId']), {});
  const arg = { runId: '20261013-000943-59c3bdb4', other: '../../x' };
  assert.equal(requireArgs(arg, ['runId', 'other']), arg, 'a param that is not an id is the channel\'s to check');
  for (const value of [null, 42, 'x', ['a']]) {
    const r = refusal(() => requireArgs(value, ['projectId', '...opts']));
    assert.equal(r?.status, 400, `${JSON.stringify(value)}: refused`);
    assert.match(r.message, /projectId, opts/);
  }
});

test('#333 requireArgs checks runId, projectId and cardId when given; none, null or \'\' is the channel\'s', () => {
  for (const [p, what] of [['runId', 'run id'], ['projectId', 'project id'], ['cardId', 'card id']]) {
    for (const value of ['../../outside', 42, { a: 1 }, 'x'.repeat(1024 * 1024)]) {
      const r = refusal(() => requireArgs({ [p]: value }, [p]));
      assert.equal(r?.status, 400, `${p} ${typeof value}: refused`);
      assert.match(r.message, new RegExp(what));
    }
    for (const value of [undefined, null, '']) assert.equal(refusal(() => requireArgs({ [p]: value }, [p])), null, `${p} ${value}: left to the channel`);
  }
  assert.equal(refusal(() => requireArgs({ runId: '../x' }, ['id'])), null, 'only a declared param is checked');
});
