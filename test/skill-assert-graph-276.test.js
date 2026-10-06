// #276: a test run went over the machine's memory when a failing assertion had to format a huge
// object graph (a fake DOM node / vm sandbox) for its diff. The testing skills now say: never hand a
// DOM node, a sandbox/vm object or a large graph to an assertion, compare a primitive. The rule lives
// in skills/testing-principles/SKILL.md; skills/unit-test-writer-js/SKILL.md shows it with
// node:assert (an `assert.` call over a primitive such as `x === null`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (skill) => fs.readFileSync(path.join(__dirname, '..', 'skills', skill, 'SKILL.md'), 'utf8');

test('testing-principles: never pass a DOM node, a vm/sandbox object or a large graph to an assertion; compare a primitive', () => {
  const text = read('testing-principles');
  assert.equal(/DOM node/i.test(text), true, 'no mention of DOM nodes');
  assert.equal(/\bvm\b/.test(text), true, 'no mention of vm objects');
  assert.equal(/sandbox/i.test(text), true, 'no mention of sandbox objects');
  assert.equal(/(large|big|huge) (object )?graph/i.test(text), true, 'no mention of large graphs');
  assert.equal(/primitive/i.test(text), true, 'does not say to compare a primitive');
});

test('unit-test-writer-js: a node:assert example that compares a primitive (=== null), not the object', () => {
  const text = read('unit-test-writer-js');
  const example = text.split('\n').some((line) => /\bassert\.\w+\(/.test(line) && /=== null/.test(line));
  assert.equal(example, true, 'no `assert.…(… === null …)` example line');
});
