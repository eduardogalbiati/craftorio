// #338: the ratchet. Every channel the service answers has a JSON Schema (`schema: { params, result }`
// in its manifest entry), except the ones listed in test/service/channels-without-schema.js, each with
// its reason (arguments free-form by design). The list may only shrink: a channel that gains a schema
// leaves it, and a new channel cannot be added without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./helpers');
const { CHANNELS: CONTROL_CHANNELS } = require('../../src/control/allowlist');

// the list is a helper module (it registers no test); loaded in each test
const loadList = () => require('./channels-without-schema');

// The issue is done when the list holds only the channels whose arguments are free-form by design.
const MAX_WITHOUT_SCHEMA = 25;

// the channels #333's hostile-argument sweep had to fix (test/service/*-333.test.js, test/server.test.js)
const SWEEP_333 = ['approval:resolve', 'projects:create', 'projects:list', 'projects:remove', 'projects:update', 'run:start', 'runs:active', 'runs:events', 'runs:resume'];

function served(t) {
  const { service } = makeService(t);
  const schemaOf = new Map(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.schema]));
  return { channels: Object.keys(service.api).sort(), schemaOf };
}

test('#338 the list of channels without a schema is well formed: known channels, a reason each, no duplicates', (t) => {
  const list = loadList();
  const { channels } = served(t);
  assert.ok(Array.isArray(list));
  const names = list.map((x) => x.channel);
  assert.deepEqual(names.filter((c, i) => names.indexOf(c) !== i), [], 'listed twice');
  for (const { channel, reason } of list) {
    assert.ok(channels.includes(channel), `${channel}: not a channel of the service (remove it from the list)`);
    assert.equal(typeof reason, 'string', `${channel}: no reason`);
    assert.ok(reason.trim().length >= 10, `${channel}: the reason says why its arguments are free-form`);
  }
});

test('#338 a channel without a schema must be listed (a new channel cannot be added without one)', (t) => {
  const listed = new Set(loadList().map((x) => x.channel));
  const { channels, schemaOf } = served(t);
  const missing = channels.filter((c) => !schemaOf.get(c) && !listed.has(c));
  assert.deepEqual(missing, [], 'channels without a schema: give them one');
});

test('#338 the list only shrinks: a listed channel that has a schema leaves the list', (t) => {
  const { schemaOf } = served(t);
  const stale = loadList().map((x) => x.channel).filter((c) => schemaOf.get(c));
  assert.deepEqual(stale, [], 'these channels have a schema now: remove them from the list');
});

test('#338 the first wave has schemas: the control channel\'s, #333\'s, the run and roadmap channels', (t) => {
  const { channels, schemaOf } = served(t);
  const wave = new Set([...CONTROL_CHANNELS, ...SWEEP_333, ...channels.filter((c) => /^(run|runs|roadmap):/.test(c))]);
  const without = [...wave].filter((c) => channels.includes(c) && !schemaOf.get(c)).sort();
  assert.deepEqual(without, []);
});

test('#338 the list holds at most the channels free-form by design', () => {
  const list = loadList();
  assert.ok(list.length <= MAX_WITHOUT_SCHEMA, `${list.length} channels without a schema (at most ${MAX_WITHOUT_SCHEMA})`);
});
