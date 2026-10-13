// The one JSON Schema validator (#338): step outputs (src/engine/run/outputs.js) and the channels'
// arguments and results (src/service/contract.js). A small subset, the keywords the app uses: type
// (one or a list; 'null' included), enum, required, properties, additionalProperties (false or a
// schema), items, minLength/maxLength, pattern, minimum/maximum, oneOf. A `title` names the value in
// a pattern's refusal ("runId: not a valid run id"); other keywords (description, ...) are ignored. validateSchema(value, schema, path) returns the errors as '<path>: <rule>'
// strings, empty when the value matches; an absent (undefined) optional property is not checked.

'use strict';

const TYPE_CHECK = {
  object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  array: Array.isArray,
  string: (x) => typeof x === 'string',
  integer: Number.isInteger,
  number: (x) => typeof x === 'number',
  boolean: (x) => typeof x === 'boolean',
  null: (x) => x === null,
};

// a property's path: `output.verdict`, or `title` at the root of a channel's arguments
const at = (p, key) => (p ? `${p}.${key}` : key);
const label = (p) => p || 'value';
const shown = (v) => (typeof v === 'string' && v.length > 60 ? `"${v.slice(0, 60)}…"` : JSON.stringify(v));
// the schemas' patterns, compiled once; a pattern that is not a valid RegExp refuses every value
// (a workflow's output schema is hand-written) instead of throwing
const patterns = new Map();
const regex = (source) => {
  if (!patterns.has(source)) {
    let re = null;
    try { re = new RegExp(source); } catch { /* invalid: null */ }
    patterns.set(source, re);
  }
  return patterns.get(source);
};
const matches = (source, v) => regex(source)?.test(v) ?? false;

function validateSchema(v, s, p = 'output', errs = []) {
  if (!s || typeof s !== 'object') return errs;
  const types = s.type == null ? null : [].concat(s.type);
  if (types && !types.some((t) => !TYPE_CHECK[t] || TYPE_CHECK[t](v))) {
    errs.push(`${label(p)}: expected ${types.join(' or ')}`);
    return errs;
  }
  if (s.enum && !s.enum.includes(v)) errs.push(`${label(p)}: ${shown(v)} not in ${JSON.stringify(s.enum)}`);
  if (typeof v === 'string') {
    // characters, not UTF-16 units
    const length = s.minLength != null || s.maxLength != null ? [...v].length : 0;
    if (s.minLength != null && length < s.minLength) errs.push(`${label(p)}: at least ${s.minLength} characters`);
    if (s.maxLength != null && length > s.maxLength) errs.push(`${label(p)}: at most ${s.maxLength} characters`);
    if (s.pattern != null && !matches(s.pattern, v)) errs.push(`${label(p)}: ${s.title ? `not a valid ${s.title}` : `does not match ${s.pattern}`}`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) errs.push(`${label(p)}: at least ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) errs.push(`${label(p)}: at most ${s.maximum}`);
  }
  if (TYPE_CHECK.object(v)) {
    for (const r of s.required || []) if (v[r] === undefined) errs.push(`${at(p, r)}: required`);
    const props = s.properties || {};
    for (const [k, ps] of Object.entries(props)) if (v[k] !== undefined) validateSchema(v[k], ps, at(p, k), errs);
    if (s.additionalProperties != null && s.additionalProperties !== true) {
      for (const k of Object.keys(v).filter((x) => !Object.hasOwn(props, x) && v[x] !== undefined)) {
        if (s.additionalProperties === false) errs.push(`${at(p, k)}: not allowed`);
        else validateSchema(v[k], s.additionalProperties, at(p, k), errs);
      }
    }
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => validateSchema(x, s.items, `${p}[${i}]`, errs));
  if (Array.isArray(s.oneOf)) {
    const matching = s.oneOf.filter((alt) => !validateSchema(v, alt, p).length).length;
    if (matching === 0) errs.push(`${label(p)}: matches none of ${s.oneOf.length} alternatives`);
    if (matching > 1) errs.push(`${label(p)}: matches ${matching} alternatives, expected one`);
  }
  return errs;
}

module.exports = {
  TYPE_CHECK,
  validateSchema,
};
