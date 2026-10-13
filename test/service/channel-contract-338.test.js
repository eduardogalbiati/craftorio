// #338: the channel contract beyond the acceptance tests: pushed notifications (`send` entries) are
// checked like request/reply channels, results are checked only under the test runner, and the
// generated channel reference leaves nothing running.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeService } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');
const CHANNELS_DIR = path.join(ROOT, 'src', 'service', 'channels');

// voice.js replaced by a fake `send` entry (see test/service/channel-schema-338.test.js): set before
// the service is created; the test process is this file's alone.
const pings = [];
{
  const file = path.join(CHANNELS_DIR, 'voice.js');
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: () => [{
      send: 'test338c:ping', method: 'test338cPing', params: ['n'],
      schema: { params: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } } }, result: { type: 'null' } },
      fn: (opts) => { pings.push(opts.n); },
    }],
  };
}

test('#338 a notification whose arguments break its schema is refused (400) and never reaches fn', (t) => {
  const { service } = makeService(t);
  pings.length = 0;
  for (const n of [1.5, 0, 'two']) {
    let err = null;
    try { service.notifications['test338c:ping']({ n }); } catch (e) { err = e; }
    assert.equal(err?.status, 400, `n ${n}: refused with a 400`);
    assert.match(err.message, /n: /);
  }
  assert.equal(pings.length, 0);
  service.notifications['test338c:ping']({ n: 2 });
  assert.deepEqual(pings, [2]);
});

test('#338 the terminal notifications refuse a non-string input and a fractional size', (t) => {
  const { service } = makeService(t);
  const refused = (channel, arg) => {
    try { service.notifications[channel](arg); } catch (e) { return [e.status, e.message]; }
    return [null, ''];
  };
  const input = refused('term:input', { id: 'term-1', data: 42 });
  assert.equal(input[0], 400);
  assert.match(input[1], /data: expected string/);
  const resize = refused('term:resize', { id: 'term-1', cols: 80.5, rows: 24 });
  assert.equal(resize[0], 400);
  assert.match(resize[1], /cols: expected integer/);
});

// A child process, as the app is: without NODE_TEST_CONTEXT results are never checked.
function checkResultIn(env) {
  const code = [
    `const { checkResult } = require(${JSON.stringify(path.join(ROOT, 'src', 'service', 'contract.js'))});`,
    "const entry = { channel: 'x:y', schema: { result: { type: 'number' } } };",
    'let sync; try { sync = checkResult(entry, "not a number"); } catch (e) { sync = "threw"; }',
    'Promise.resolve(checkResult(entry, Promise.resolve("not a number"))).then((v) => v, () => "rejected")',
    '  .then((async) => process.stdout.write(JSON.stringify({ sync, async })));',
  ].join('\n');
  const res = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('#338 outside the test runner, a result outside schema.result is returned unchanged', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assert.deepEqual(checkResultIn(env), { sync: 'not a number', async: 'not a number' });
});

test('#338 under the test runner, a result outside schema.result fails, sync or async', () => {
  assert.deepEqual(checkResultIn({ ...process.env, NODE_TEST_CONTEXT: 'child-v8' }), { sync: 'threw', async: 'rejected' });
});

test('#338 building the channel reference leaves nothing running: the process ends on its own', () => {
  const code = `const ref = require(${JSON.stringify(path.join(ROOT, 'scripts', 'docs.js'))}).channelReference(); process.stdout.write(String(ref.includes('runs:setTitle')));`;
  const res = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(res.signal, null, 'killed by the timeout: a timer or handle is still alive');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'true');
});
