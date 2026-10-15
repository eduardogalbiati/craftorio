// #338: the typed channel contract. A manifest entry carries `schema: { params, result }` (JSON
// Schema); the service checks the arguments against schema.params before calling fn (a refused call
// never reaches fn) and, under the test runner only, the result against schema.result.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeService } = require('./helpers');

const CHANNELS_DIR = path.join(__dirname, '..', '..', 'src', 'service', 'channels');
const RUN_ID = '20261013-000930-076152f0';

// Channel files are `(ctx) => [entries]` modules loaded from src/service/channels (manifest.js).
// This replaces one of them (voice.js: no other test of this file needs it) with fake entries, so a
// test can see whether fn was called and give a result that breaks its schema. Set before the
// service is created; the test process is this file's alone.
function fakeChannels(entries) {
  const file = path.join(CHANNELS_DIR, 'voice.js');
  require.cache[file] = { id: file, filename: file, loaded: true, exports: () => entries };
}

const calls = [];
fakeChannels([
  {
    channel: 'test338:echo', method: 'test338Echo', params: ['name', 'count'],
    schema: {
      params: {
        type: 'object', required: ['name'],
        properties: { name: { type: 'string', maxLength: 5 }, count: { type: 'integer', minimum: 1 } },
      },
      result: { type: 'string' },
    },
    fn: (opts) => { calls.push(opts); return opts.name; },
  },
  {
    channel: 'test338:wrongResult', method: 'test338WrongResult', params: ['name'],
    schema: {
      params: { type: 'object', properties: { name: { type: 'string' } } },
      result: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    },
    fn: () => ({ ok: 'yes' }),
  },
]);

const entryOf = (service, channel) => service.manifest.find((e) => e.channel === channel);
const call = async (api, channel, arg) => api[channel](arg); // a sync throw becomes a rejection

test('#338 a call that does not match schema.params is refused with the parameter and the rule, and fn is never called', async (t) => {
  const { api } = makeService(t);
  calls.length = 0;
  await assert.rejects(call(api, 'test338:echo', { name: 'too long' }), (e) => {
    assert.match(e.message, /name: at most 5 characters/);
    return true;
  });
  await assert.rejects(call(api, 'test338:echo', { name: 'ok', count: 0 }), /count/);
  await assert.rejects(call(api, 'test338:echo', { count: 2 }), /name/);
  await assert.rejects(call(api, 'test338:echo', { name: 42 }), /name/);
  assert.equal(calls.length, 0, 'fn was called with an argument its schema refuses');
});

test('#338 a refused call is a client error (status 400)', async (t) => {
  const { api } = makeService(t);
  let status = null;
  try { await call(api, 'test338:echo', { name: 'too long' }); } catch (e) { status = e.status; }
  assert.equal(status, 400);
});

test('#338 a call that matches schema.params reaches fn unchanged and returns its result', async (t) => {
  const { api } = makeService(t);
  calls.length = 0;
  assert.equal(await call(api, 'test338:echo', { name: 'abc', count: 3 }), 'abc');
  assert.equal(await call(api, 'test338:echo', { name: 'abcde' }), 'abcde');
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[0].name, calls[0].count], ['abc', 3]);
});

test('#338 under the test runner, a result that does not match schema.result fails the call', async (t) => {
  const { api } = makeService(t);
  await assert.rejects(call(api, 'test338:wrongResult', { name: 'x' }), /result|ok/);
});

test('#338 runs:setTitle refuses a title over 200 characters, naming the parameter and the rule', async (t) => {
  const { api } = makeService(t);
  await assert.rejects(call(api, 'runs:setTitle', { runId: RUN_ID, title: 'x'.repeat(201) }), /title: at most 200 characters/);
  await assert.rejects(call(api, 'runs:setTitle', { runId: RUN_ID, title: 42 }), /title/);
});

test('#338 a shared definition: the run id and the project id have one schema across channels', (t) => {
  const { validateSchema } = require('../../src/json-schema');
  const { service } = makeService(t);
  const prop = (channel, name) => {
    const entry = entryOf(service, channel);
    assert.ok(entry?.schema?.params?.properties?.[name], `${channel} has no schema for ${name}`);
    return entry.schema.params.properties[name];
  };
  const runId = prop('runs:setTitle', 'runId');
  for (const channel of ['run:stop', 'runs:events', 'runs:scratch', 'runs:resume']) assert.deepEqual(prop(channel, 'runId'), runId, channel);
  const projectId = prop('roadmap:get', 'projectId');
  for (const channel of ['roadmap:versions', 'roadmap:undo', 'roadmap:save']) assert.deepEqual(prop(channel, 'projectId'), projectId, channel);

  assert.deepEqual(validateSchema(RUN_ID, runId, 'runId'), []);
  for (const bad of ['../../outside', '', 42, null, 'x'.repeat(1024)]) {
    assert.notEqual(validateSchema(bad, runId, 'runId').length, 0, `run id ${String(bad).slice(0, 20)} should be refused`);
  }
});

test('#338 every schema in the manifest is plain JSON (it is published to other clients)', (t) => {
  const { service } = makeService(t);
  const withSchema = service.manifest.filter((e) => e.schema && !String(e.channel).startsWith('test338:'));
  assert.ok(withSchema.length > 0, 'no manifest entry has a schema');
  for (const e of withSchema) {
    assert.deepEqual(JSON.parse(JSON.stringify(e.schema)), e.schema, `${e.channel}: the schema does not survive JSON`);
    assert.equal('result' in e.schema, true, `${e.channel}: a schema names its result`);
    if (Array.isArray(e.params) && e.schema.params) assert.equal(e.schema.params.type, 'object', `${e.channel}: named params are an object`);
  }
});
