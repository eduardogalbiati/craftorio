// #352 internals: the rule table's interpreter (checkField) on each kind of entry, the generated set
// (every FIELD_RULES entry violated once, its own message back) and every entry reached by one of
// src/engine/run/load.js's check sequences.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FIELD_RULES, MACHINE_STEP_TYPES, checkField, resolveChecks } = require('../src/engine/run/field-rules');

const SCOPES = ['steps[].transitions[].', 'steps[].', 'agents.*.'];
const scopeOf = (field) => SCOPES.find((p) => field.startsWith(p)) || '';
const keysOf = (field) => field.slice(scopeOf(field).length).split('.');
function setAt(keys, value) {
  const obj = {};
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] = {};
  at[keys.at(-1)] = value;
  return obj;
}
const errorOf = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// a value each type refuses
const BAD = {
  'amount': -1,
  'boolean': 'yes',
  'display name': '',
  'duration': 'soon',
  'field names': [],
  'file list': [1],
  'map': [],
  'non-blank text': ' ',
  'non-blank value': ' ',
  'non-empty list': [],
  'one of': '__none__',
  'plain name': 'a b',
  'request count': 0,
  'text': 5,
  'token count': 'lots',
  'variable names': ['AWS_*'],
};
const TYPES = [undefined, ...MACHINE_STEP_TYPES];
const applies = (a, type) => (Array.isArray(a) ? a.includes(type) : typeof a === 'object' ? !a.except.includes(type) : true);

// one violation of an entry: [object, step type, expected message]
function violation(rule) {
  const keys = keysOf(rule.field);
  const inside = TYPES.find((t) => applies(rule.appliesTo, t));
  if (rule.required) return [keys.length > 1 ? setAt(keys.slice(0, -1), {}) : {}, inside, rule.message];
  if (rule.type !== 'any') return [setAt(keys, BAD[rule.type]), inside, rule.message];
  const outside = TYPES.find((t) => !applies(rule.appliesTo, t));
  return [setAt(keys, 'x'), outside, (rule.placeMessage || rule.message).replace('{type}', outside)];
}

test('#352 internals: every table entry, violated once, gives its own message with the scope prefix', () => {
  const wrong = [];
  for (const rule of FIELD_RULES) {
    const [obj, type, message] = violation(rule);
    const got = errorOf(() => checkField(rule, obj, { prefix: 'P: ', type }));
    if (got !== `P: ${message}`) wrong.push(`${rule.field}: ${got}`);
  }
  assert.deepEqual(wrong, []);
});

test('#352 internals: a type entry accepts a valid value and a template only when the entry allows it', () => {
  const rule = { field: 'steps[].timeout', appliesTo: 'all', type: 'duration', template: true, required: false, message: 'm' };
  assert.equal(errorOf(() => checkField(rule, { timeout: '3m' }, {})), null);
  assert.equal(errorOf(() => checkField(rule, { timeout: '{{ inputs.t }}' }, {})), null);
  assert.equal(errorOf(() => checkField({ ...rule, template: false }, { timeout: '{{ inputs.t }}' }, {})), 'm');
  assert.equal(errorOf(() => checkField(rule, {}, {})), null, 'unset: nothing to check');
});

test('#352 internals: applies-to throws elsewhere (its own place message first after the type), or skips', () => {
  const rule = { field: 'steps[].x', appliesTo: ['suite'], type: 'boolean', template: false, required: false, message: 'type', placeMessage: 'place' };
  assert.equal(errorOf(() => checkField(rule, { x: true }, { type: 'suite' })), null);
  assert.equal(errorOf(() => checkField(rule, { x: true }, { type: 'human_approval' })), 'place');
  assert.equal(errorOf(() => checkField(rule, { x: 'no' }, { type: 'human_approval' })), 'type');
  assert.equal(errorOf(() => checkField({ ...rule, elsewhere: 'skip' }, { x: 'no' }, { type: 'human_approval' })), null);
  const except = { ...rule, appliesTo: { except: ['suite'] }, placeMessage: undefined, message: 'a {type} step' };
  assert.equal(errorOf(() => checkField(except, { x: true }, { type: 'suite' })), 'a suite step');
});

test('#352 internals: a required field is checked when its parent is set, per the entry\'s presence', () => {
  const rule = { field: 'steps[].goal.until', appliesTo: 'all', type: 'any', template: false, required: true, message: 'until', present: 'truthy' };
  assert.equal(errorOf(() => checkField(rule, {}, {})), null);
  assert.equal(errorOf(() => checkField(rule, { goal: null }, {})), null);
  assert.equal(errorOf(() => checkField(rule, { goal: {} }, {})), 'until');
  assert.equal(errorOf(() => checkField({ ...rule, present: undefined }, { goal: null }, {})), 'until', 'defined: null counts as set');
  assert.equal(errorOf(() => checkField({ ...rule, present: 'set' }, { goal: null }, {})), null, 'set: null does not count');
});

test('#352 internals: a loader sequence naming a field the table lacks throws when it is built', () => {
  assert.throws(() => resolveChecks('steps[].', ['no_such_field']), /No field rule for steps\[\]\.no_such_field/);
});

test('#352 internals: every table entry is reached by one of load.js\'s check sequences', () => {
  const load = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'run', 'load.js'), 'utf8');
  const missing = FIELD_RULES.filter((r) => !load.includes(`'${r.field.slice(scopeOf(r.field).length)}'`)).map((r) => r.field);
  assert.deepEqual(missing, []);
});
