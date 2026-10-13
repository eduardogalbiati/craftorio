// #339: the HTTP contract suite is order-independent and repeatable. One self-started engine
// (test/contract/harness.js startEngine: `npm run serve` on a scratch workspace in simulation) gets
// every fixture of test/contract/fixtures.js twice in a row, the second pass in reverse order; each
// channel's outcome (passed, or its failure message) is the same both times. Slow: two passes of the
// whole contract suite against a real server process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../contract/fixtures');
const { manifestOf, runFixture, startEngine } = require('../contract/harness');

test('#339 the contract fixtures give the same outcome twice in a row against one engine, in any order', { timeout: 240000 }, async (t) => {
  const engine = await startEngine();
  t.after(() => engine.stop());
  const manifest = await manifestOf(engine.url, engine.token);
  const channels = Object.keys(fixtures).filter((ch) => !manifest.find((e) => e.channel === ch)?.desktop);
  assert.ok(channels.length > 0);

  const pass = async (order) => {
    const out = {};
    for (const channel of order) {
      out[channel] = await runFixture({ url: engine.url, token: engine.token, channel, fixture: fixtures[channel] })
        .then(() => 'passed', (e) => String(e?.message || e).split('\n')[0]);
    }
    return out;
  };
  const first = await pass(channels);
  const second = await pass([...channels].reverse());
  const failed = Object.entries(first).filter(([, v]) => v !== 'passed').map(([ch, v]) => `${ch}: ${v}`);
  assert.deepEqual(failed, [], 'every fixture passes on a fresh engine');
  const differ = channels.filter((ch) => first[ch] !== second[ch]).map((ch) => `${ch}: ${first[ch]} -> ${second[ch]}`);
  assert.deepEqual(differ, [], 'the second pass (reverse order) answers like the first');
});

test('#339 startEngine\'s stop ends the server: its URL stops answering', { timeout: 120000 }, async () => {
  const engine = await startEngine();
  const before = await fetch(`${engine.url}/api/version`, { headers: { Authorization: `Bearer ${engine.token}` } });
  assert.equal(before.status, 200);
  await engine.stop();
  const after = await fetch(`${engine.url}/api/version`).then((r) => r.status, () => 'refused');
  assert.equal(after, 'refused');
});
