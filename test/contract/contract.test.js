// #339 contract tests over HTTP: every channel with a fixture (test/contract/fixtures.js) is called
// as a client calls it, POST /api/<channel>, and its answer checked against the engine's own
// manifest: the status, the result against schema.result, and a refused call (400) for an invalid
// argument. The engine is ENGINE_URL with ENGINE_TOKEN when set (any engine: another machine, another
// implementation); otherwise the suite starts `npm run serve` on a scratch workspace in simulation and
// stops it after (test/contract/harness.js). Desktop-only channels are skipped, as the browser does.
//   ENGINE_URL=http://127.0.0.1:7300 ENGINE_TOKEN=<token> node --test test/contract/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const {
  coverage,
  manifestOf,
  resolveEngine,
  runFixture,
  startEngine,
} = require('./harness');

const target = resolveEngine(process.env);
let engine = null;

test.before(async () => {
  engine = target.external ? target : await startEngine();
});
test.after(async () => {
  if (engine?.stop) await engine.stop();
});

test('#339 contract: GET /api/version answers { app, contract }, the contract GET /api/manifest declares', async () => {
  const headers = { Authorization: `Bearer ${engine.token}` };
  const version = await fetch(`${engine.url}/api/version`, { headers });
  assert.equal(version.status, 200);
  const body = await version.json();
  assert.equal(typeof body.app, 'string');
  assert.match(body.contract, /^[0-9a-f]{6,16}$/);
  const manifest = await (await fetch(`${engine.url}/api/manifest`, { headers })).json();
  assert.equal(manifest.contract, body.contract);
});

for (const [channel, fixture] of Object.entries(fixtures)) {
  test(`#339 contract: ${channel}`, async (t) => {
    const entry = (await manifestOf(engine.url, engine.token)).find((e) => e.channel === channel);
    if (entry?.desktop) return t.skip(`${channel} needs the desktop app`);
    await runFixture({ url: engine.url, token: engine.token, channel, fixture });
  });
}

test('#339 contract: coverage of the channels with a schema', async (t) => {
  const c = coverage(await manifestOf(engine.url, engine.token), fixtures);
  t.diagnostic(`contract tests: ${c.covered.length} of ${c.withSchema.length} channels with a schema (test/contract/channels-without-fixture.js lists the others)`);
  assert.ok(c.covered.length > 0);
});
