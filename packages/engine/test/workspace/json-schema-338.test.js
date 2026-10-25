// #338: the one JSON Schema validator (step outputs and channel arguments), moved out of
// packages/engine/engine/run/outputs.js into packages/engine/domains/workspace/json-schema.js with the keywords the channels need.
// validateSchema(value, schema, path) returns the errors as '<path>: <rule>' strings (empty: valid).
const test = require('node:test');
const assert = require('node:assert/strict');

// loaded in each test: the module is created by #338
const load = () => require('../../domains/workspace/json-schema');

test('#338 keeps the keywords step outputs use: type, enum, required, properties, items', () => {
  const { validateSchema } = load();
  const schema = {
    type: 'object',
    required: ['verdict', 'list'],
    properties: { verdict: { type: 'string', enum: ['ok', 'ko'] }, list: { type: 'array', items: { type: 'string' } } },
  };
  assert.deepEqual(validateSchema({ verdict: 'ok', list: ['a'] }, schema, 'output'), []);
  const errs = validateSchema({ verdict: 'maybe', list: ['a', 2] }, schema, 'output');
  assert.equal(errs.some((e) => /^output\.verdict: /.test(e)), true, errs.join('; '));
  assert.equal(errs.some((e) => /^output\.list\[1\]: expected string/.test(e)), true, errs.join('; '));
  assert.deepEqual(validateSchema({}, schema, 'output').filter((e) => /required/.test(e)).length, 2);
});

test('#338 the engine still validates step outputs as before', () => {
  const { validateSchema } = require('../../engine/workflow');
  const errs = validateSchema({ n: 'x' }, { type: 'object', required: ['m'], properties: { n: { type: 'integer' } } });
  assert.deepEqual(errs.slice().sort(), ['output.m: required', 'output.n: expected integer']);
});

test('#338 minLength and maxLength count characters and name the limit', () => {
  const { validateSchema } = load();
  const schema = { type: 'string', minLength: 2, maxLength: 5 };
  assert.deepEqual(validateSchema('abc', schema, 'title'), []);
  assert.deepEqual(validateSchema('ab', schema, 'title'), []);
  assert.deepEqual(validateSchema('abcde', schema, 'title'), []);
  const long = validateSchema('abcdef', schema, 'title');
  assert.equal(long.length, 1);
  assert.match(long[0], /^title: at most 5 characters$/);
  const short = validateSchema('a', schema, 'title');
  assert.equal(short.length, 1);
  assert.match(short[0], /^title: at least 2 characters$/);
  // the empty string is a value too
  assert.equal(validateSchema('', schema, 'title').length, 1);
});

test('#338 pattern refuses a string that does not match it', () => {
  const { validateSchema } = load();
  const runId = { type: 'string', pattern: '^\\d{8}-\\d{6}-[0-9a-f]{8}$' };
  assert.deepEqual(validateSchema('20261013-000930-076152f0', runId, 'runId'), []);
  for (const bad of ['../../outside', '20261013-000930-076152f0/..', '']) {
    const errs = validateSchema(bad, runId, 'runId');
    assert.equal(errs.length, 1, `${JSON.stringify(bad)}: ${errs.join('; ')}`);
    assert.match(errs[0], /^runId: /);
  }
});

test('#338 minimum and maximum bound numbers, limits included', () => {
  const { validateSchema } = load();
  const schema = { type: 'integer', minimum: 1, maximum: 10 };
  assert.deepEqual(validateSchema(1, schema, 'n'), []);
  assert.deepEqual(validateSchema(10, schema, 'n'), []);
  const low = validateSchema(0, schema, 'n');
  assert.equal(low.length, 1);
  assert.match(low[0], /^n: .*\b1\b/);
  const high = validateSchema(11, schema, 'n');
  assert.equal(high.length, 1);
  assert.match(high[0], /^n: .*\b10\b/);
  assert.deepEqual(validateSchema(0.5, { type: 'number', minimum: 0, maximum: 1 }, 'ratio'), []);
});

test('#338 items checks each element of an array, with its index in the path', () => {
  const { validateSchema } = load();
  const schema = { type: 'array', items: { type: 'string', maxLength: 3 } };
  assert.deepEqual(validateSchema([], schema, 'tags'), []);
  assert.deepEqual(validateSchema(['a', 'abc'], schema, 'tags'), []);
  const errs = validateSchema(['a', 'abcd', 7], schema, 'tags');
  assert.equal(errs.length, 2, errs.join('; '));
  assert.equal(errs.some((e) => /^tags\[1\]: at most 3 characters$/.test(e)), true, errs.join('; '));
  assert.equal(errs.some((e) => /^tags\[2\]: expected string$/.test(e)), true, errs.join('; '));
});

test('#338 additionalProperties: false refuses a property the schema does not name', () => {
  const { validateSchema } = load();
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.deepEqual(validateSchema({ a: 'x' }, schema, 'arg'), []);
  assert.deepEqual(validateSchema({}, schema, 'arg'), []);
  const errs = validateSchema({ a: 'x', extra: 1 }, schema, 'arg');
  assert.equal(errs.length, 1, errs.join('; '));
  assert.match(errs[0], /extra/);
  // without the keyword, other properties stay allowed (step outputs rely on it)
  assert.deepEqual(validateSchema({ a: 'x', extra: 1 }, { type: 'object', properties: { a: { type: 'string' } } }, 'arg'), []);
});

test('#338 oneOf accepts a value matching exactly one alternative and refuses one matching none', () => {
  const { validateSchema } = load();
  const schema = { oneOf: [{ type: 'string', minLength: 1 }, { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }] };
  assert.deepEqual(validateSchema('abc', schema, 'target'), []);
  assert.deepEqual(validateSchema({ id: 'x' }, schema, 'target'), []);
  for (const bad of [42, null, {}, '']) {
    const errs = validateSchema(bad, schema, 'target');
    assert.notEqual(errs.length, 0, `${JSON.stringify(bad)} should be refused`);
    assert.equal(errs.every((e) => e.startsWith('target')), true, errs.join('; '));
  }
  // matching two alternatives is not "one of"
  assert.notEqual(validateSchema(5, { oneOf: [{ type: 'number' }, { type: 'integer' }] }, 'n').length, 0);
});

test('#338 an optional property that is absent is not checked', () => {
  const { validateSchema } = load();
  const schema = { type: 'object', properties: { title: { type: 'string', maxLength: 3 } } };
  assert.deepEqual(validateSchema({}, schema, 'arg'), []);
});
