// The typed channel contract (#338): a manifest entry's `schema: { params, result }` (JSON Schema,
// shared definitions in packages/engine/service/schemas.js) checked at the service's entry (packages/engine/service/index.js),
// for IPC and HTTP alike. checkParams refuses an argument that does not match schema.params with a
// 400 naming the parameter and the rule (e.g. `title: at most 200 characters`), before the channel's
// code runs. checkResult checks what a channel answers against schema.result under the test runner
// only (node --test sets NODE_TEST_CONTEXT in each test file's process): in the app, results are not
// validated, so the contract costs nothing at runtime.
// contractHash (#339) names the contract a manifest declares: a short hash of its channels, their
// params and schemas (never their code), answered by GET /api/version and app:version so a client
// built for another contract can tell (apps/web/renderer/api-http.js).

'use strict';

const crypto = require('crypto');
const { validateSchema } = require('../domains/workspace/json-schema');
const { clientError } = require('./common');

const CHECK_RESULTS = !!process.env.NODE_TEST_CONTEXT;

// the paths of the errors: a property name for named params (an object), the param's name for one
// argument passed as is
const rootOf = (entry) => (typeof entry.params === 'string' ? entry.params : '');

// The argument unchanged, or a refusal (status 400). No argument at all (undefined) is not checked
// against a one-argument schema: the channel gives its own default.
function checkParams(entry, arg) {
  const schema = entry.schema?.params;
  if (!schema || (arg === undefined && typeof entry.params !== 'object')) return arg;
  const errs = validateSchema(arg, schema, rootOf(entry));
  if (errs.length) throw clientError(`Invalid arguments for ${entry.channel || entry.send}: ${errs.join('; ')}.`);
  return arg;
}

// The result unchanged (a promise resolves to it); under the test runner, an error when it does not
// match schema.result.
function checkResult(entry, out) {
  if (!CHECK_RESULTS || !entry.schema || !('result' in entry.schema)) return out;
  const check = (value) => {
    const errs = validateSchema(value === undefined ? null : value, entry.schema.result, 'result');
    if (errs.length) throw new Error(`${entry.channel} answered outside its schema.result: ${errs.join('; ')}.`);
    return value;
  };
  return out && typeof out.then === 'function' ? out.then(check) : check(out);
}

// JSON with the object keys sorted, so the same content always gives the same text
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// The contract of a manifest (entries with or without their fn): a 12-character hex hash of each
// entry's names (channel / send / event, method), params, schema and desktop flag, in name order.
function contractHash(manifest) {
  const contract = (manifest || []).map((e) => ({
    channel: e.channel, send: e.send, event: e.event, method: e.method, params: e.params, schema: e.schema, desktop: e.desktop,
  }));
  const lines = contract.map(canonical).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

module.exports = {
  checkParams,
  checkResult,
  contractHash,
};
