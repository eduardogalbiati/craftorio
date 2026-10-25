// #338 internals of packages/engine/domains/workspace/json-schema.js beyond the acceptance tests: a list of types (null included),
// the `title` a pattern's refusal names, a pattern that is not a valid RegExp, and
// additionalProperties given as a schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchema } = require('../../domains/workspace/json-schema');
const { PROJECT_ID, orNone } = require('../../service/schemas');

test('#338 a list of types accepts each of them, null included, and names them all in the refusal', () => {
  const schema = { type: ['string', 'null'] };
  assert.deepEqual(validateSchema('x', schema, 'v'), []);
  assert.deepEqual(validateSchema(null, schema, 'v'), []);
  assert.deepEqual(validateSchema(3, schema, 'v'), ['v: expected string or null']);
});

test('#338 a pattern with a title names the value, not the regular expression', () => {
  assert.deepEqual(validateSchema('../../x', PROJECT_ID, 'projectId'), ['projectId: not a valid project id']);
  assert.deepEqual(validateSchema('my-app', PROJECT_ID, 'projectId'), []);
});

test('#338 orNone takes the id, an empty string or null, and nothing else', () => {
  const schema = orNone(PROJECT_ID);
  for (const ok of ['my-app', '', null]) assert.deepEqual(validateSchema(ok, schema, 'projectId'), [], String(ok));
  for (const bad of ['../x', 42, {}]) assert.notEqual(validateSchema(bad, schema, 'projectId').length, 0, String(bad));
});

test('#338 a pattern that is not a valid RegExp refuses the value instead of throwing', () => {
  const errs = validateSchema('abc', { type: 'string', pattern: '([' }, 'v');
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^v: /);
});

test('#338 additionalProperties as a schema checks the properties the schema does not name', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'integer' } };
  assert.deepEqual(validateSchema({ a: 'x', b: 1 }, schema, 'arg'), []);
  assert.deepEqual(validateSchema({ a: 'x', b: 'y' }, schema, 'arg'), ['arg.b: expected integer']);
});
