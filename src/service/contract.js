// The typed channel contract (#338): a manifest entry's `schema: { params, result }` (JSON Schema,
// shared definitions in src/service/schemas.js) checked at the service's entry (src/service/index.js),
// for IPC and HTTP alike. checkParams refuses an argument that does not match schema.params with a
// 400 naming the parameter and the rule (e.g. `title: at most 200 characters`), before the channel's
// code runs. checkResult checks what a channel answers against schema.result under the test runner
// only (node --test sets NODE_TEST_CONTEXT in each test file's process): in the app, results are not
// validated, so the contract costs nothing at runtime.

'use strict';

const { validateSchema } = require('../json-schema');
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

module.exports = {
  checkParams,
  checkResult,
};
