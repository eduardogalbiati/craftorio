// #339 acceptance: the HTTP contract suite's harness (test/contract/), its fixtures and coverage.
//
// The interfaces these tests expect (the developer creates them; this file is not edited):
//
// test/contract/harness.js (a helper module: it registers no test) exports
//   resolveEngine(env)  -> { url, token, external: true } when env.ENGINE_URL is set (token from
//                          env.ENGINE_TOKEN); { external: false } otherwise (the suite then starts
//                          `npm run serve` on a scratch workspace in simulation and stops it after).
//   checkChannel({ url, token, channel, fixture })  -> a promise. It reads the channel's entry from
//                          GET <url>/api/manifest (Bearer token), calls POST <url>/api/<channel> with
//                          { arg: fixture.arg }, expects the status fixture.status (default 200) and
//                          checks body.result against the entry's schema.result; when the fixture has
//                          `invalid: { arg }`, it also calls with that argument and expects 400.
//                          It resolves when all hold. Otherwise it rejects with an Error whose message
//                          names the channel and the problem:
//                            - a result outside the schema: the message contains the channel, the
//                              words "does not match" and "schema.result", and the validator's
//                              errors (e.g. "result.ok: expected boolean");
//                            - an invalid argument not refused: the message contains the channel,
//                              "400" and the status it got.
//   coverage(manifest, fixtures)  -> { withSchema, covered, missing }: sorted arrays of channel
//                          names. withSchema: the request/reply entries (`channel`) that have a
//                          `schema` and are not desktop-only (`desktop` set: the same rule
//                          src/renderer/api-http.js uses); `send` and `event` entries are not
//                          channels of the HTTP suite. covered: those with a fixture; missing: the rest.
//
// test/contract/fixtures.js exports an object { [channel]: fixture }, a fixture being
//   { arg, status?, invalid?: { arg }, setup? } (setup: the state a call needs, the suite's concern).
// test/contract/channels-without-fixture.js exports the shrinking allowance: [{ channel, reason }],
//   the channels with a schema that have no fixture yet. It may only shrink: a listed channel that
//   gets a fixture leaves it, and a channel with a schema that has neither fails.
//
// The broken-channel test starts the real server (src/server createServer) in process over a fake
// service object ({ api, notifications, events, manifest }), the seam createServer already offers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');
const { createServer } = require('../src/server');

const TOKEN = 'test-token-339-harness-0123456789';

// the modules the change creates: required inside each test
const harness = () => require('./contract/harness');

// A service that answers three test channels with the same contract:
//   test339:good     honours it (refuses an `n` that is not an integer with a 400)
//   test339:broken   answers { ok: 'yes' }: a wrong result shape
//   test339:lenient  answers { ok: true } for any argument: never refuses an invalid one
const SCHEMA = {
  params: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
  result: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
};
function refuse(message) { const e = new Error(message); e.status = 400; return e; }
const strict = (answer) => (arg) => {
  if (!Number.isInteger(arg?.n)) throw refuse('Invalid arguments: n: expected integer.');
  return answer;
};
function fakeService() {
  const entries = [
    { channel: 'test339:good', method: 'test339Good', params: ['n'], schema: SCHEMA, fn: strict({ ok: true }) },
    { channel: 'test339:broken', method: 'test339Broken', params: ['n'], schema: SCHEMA, fn: strict({ ok: 'yes' }) },
    { channel: 'test339:lenient', method: 'test339Lenient', params: ['n'], schema: SCHEMA, fn: () => ({ ok: true }) },
  ];
  return {
    api: Object.fromEntries(entries.map((e) => [e.channel, e.fn])),
    notifications: {},
    events: { on() {}, off() {} },
    manifest: entries.map(({ fn, ...decl }) => decl),
  };
}

async function startFake(t) {
  const server = createServer({ service: fakeService(), token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

const FIXTURE = { arg: { n: 1 }, invalid: { arg: { n: 'one' } } };

// a rejection's message (a string), or null when the promise resolved
const outcome = (p) => Promise.resolve(p).then(() => null, (e) => String(e?.message || e));

test('#339 resolveEngine targets ENGINE_URL with ENGINE_TOKEN when set, and a self-started engine otherwise', () => {
  const { resolveEngine } = harness();
  const external = resolveEngine({ ENGINE_URL: 'http://127.0.0.1:7300', ENGINE_TOKEN: 'token-from-env-0123456789' });
  assert.deepEqual([external.url, external.token, external.external], ['http://127.0.0.1:7300', 'token-from-env-0123456789', true]);
  assert.equal(resolveEngine({}).external, false, 'no ENGINE_URL: the suite starts its own engine');
  assert.equal(resolveEngine({ ENGINE_TOKEN: 'token-from-env-0123456789' }).external, false, 'a token alone does not name an engine');
});

test('#339 checkChannel passes a channel that honours its contract', async (t) => {
  const { checkChannel } = harness();
  const url = await startFake(t);
  assert.equal(await outcome(checkChannel({ url, token: TOKEN, channel: 'test339:good', fixture: FIXTURE })), null);
});

test('#339 checkChannel fails a channel whose result breaks its schema, naming the channel and the violation', async (t) => {
  const { checkChannel } = harness();
  const url = await startFake(t);
  const msg = await outcome(checkChannel({ url, token: TOKEN, channel: 'test339:broken', fixture: FIXTURE }));
  assert.notEqual(msg, null, 'a wrong result shape fails the check');
  assert.ok(msg.includes('test339:broken'), `the message names the channel: ${msg}`);
  assert.match(msg, /does not match/);
  assert.match(msg, /schema\.result/);
  assert.match(msg, /result\.ok/, `the message says which part of the result is wrong: ${msg}`);
});

test('#339 checkChannel fails a channel that accepts an invalid argument, naming the channel and the expected 400', async (t) => {
  const { checkChannel } = harness();
  const url = await startFake(t);
  const msg = await outcome(checkChannel({ url, token: TOKEN, channel: 'test339:lenient', fixture: FIXTURE }));
  assert.notEqual(msg, null, 'an invalid argument answered 200 fails the check');
  assert.ok(msg.includes('test339:lenient'), msg);
  assert.match(msg, /400/);
  assert.match(msg, /200/, `the message says what it got instead: ${msg}`);
});

test('#339 coverage counts the request/reply channels with a schema, skipping desktop-only ones', () => {
  const { coverage } = harness();
  const manifest = [
    { channel: 'b:two', method: 'bTwo', params: ['x'], schema: { params: { type: 'object' }, result: { type: 'null' } } },
    { channel: 'a:one', method: 'aOne', schema: { result: { type: 'null' } } },
    { channel: 'a:three', method: 'aThree' },
    { channel: 'd:desk', method: 'dDesk', desktop: 'Desk things', schema: { result: { type: 'null' } } },
    { send: 'a:ping', method: 'aPing', params: ['n'], schema: { params: { type: 'object' }, result: { type: 'null' } } },
    { event: 'a:changed', method: 'onAChange' },
  ];
  const c = coverage(manifest, { 'a:one': { arg: null } });
  assert.deepEqual(
    { withSchema: [...c.withSchema], covered: [...c.covered], missing: [...c.missing] },
    { withSchema: ['a:one', 'b:two'], covered: ['a:one'], missing: ['b:two'] },
  );
});

test('#339 every channel with a schema has a contract fixture, except the shrinking allowance, which lists only channels still without one', (t) => {
  const { coverage } = harness();
  const fixtures = require('./contract/fixtures');
  const allowance = require('./contract/channels-without-fixture');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-339-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0.0.0', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  t.after(() => { service.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });

  const c = coverage(service.manifest, fixtures);
  t.diagnostic(`contract tests: ${c.covered.length} of ${c.withSchema.length} channels with a schema`);
  assert.ok(c.withSchema.length > 30, 'the service\'s channels with a schema are counted');
  assert.equal(c.covered.length + c.missing.length, c.withSchema.length);

  assert.ok(Array.isArray(allowance));
  const listed = allowance.map((x) => x.channel);
  assert.deepEqual(listed.filter((ch, i) => listed.indexOf(ch) !== i), [], 'listed twice');
  for (const { channel, reason } of allowance) {
    assert.ok(typeof reason === 'string' && reason.trim().length >= 10, `${channel}: a reason why it has no fixture yet`);
  }
  assert.deepEqual(c.missing.filter((ch) => !listed.includes(ch)), [], 'channels with a schema and no fixture: add one to test/contract/fixtures.js');
  assert.deepEqual(listed.filter((ch) => !c.missing.includes(ch)), [], 'these have a fixture now (or no schema): remove them from test/contract/channels-without-fixture.js');
  const known = new Set(c.withSchema);
  assert.deepEqual(Object.keys(fixtures).filter((ch) => !known.has(ch)).sort(), [], 'fixtures for channels that are not request/reply channels with a schema');
});
