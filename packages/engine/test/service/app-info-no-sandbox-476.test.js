// #476 (SEC-11): the Linux AppImage's launcher sets CRAFTORIO_NO_SANDBOX=1 when it falls back to
// --no-sandbox; app:info.noSandbox tells the renderer, so Settings › About shows the warning.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./helpers');

function withEnv(t, value) {
  const before = process.env.CRAFTORIO_NO_SANDBOX;
  if (value === undefined) delete process.env.CRAFTORIO_NO_SANDBOX;
  else process.env.CRAFTORIO_NO_SANDBOX = value;
  t.after(() => {
    if (before === undefined) delete process.env.CRAFTORIO_NO_SANDBOX;
    else process.env.CRAFTORIO_NO_SANDBOX = before;
  });
}

test('#476 app:info says the app runs without the sandbox when the launcher set CRAFTORIO_NO_SANDBOX=1', async (t) => {
  withEnv(t, '1');
  const { api } = makeService(t);
  assert.equal((await api['app:info']()).noSandbox, true);
});

test('#476 app:info says the sandbox is on without the variable, or with another value', async (t) => {
  withEnv(t, undefined);
  const { api } = makeService(t);
  assert.equal((await api['app:info']()).noSandbox, false);
  process.env.CRAFTORIO_NO_SANDBOX = '0';
  assert.equal((await api['app:info']()).noSandbox, false);
});

test('#476 app:info\'s result schema lists noSandbox as a boolean', (t) => {
  const { service } = makeService(t);
  const props = service.manifest.find((e) => e.channel === 'app:info').schema.result.properties;
  assert.equal(props.noSandbox?.type, 'boolean');
});
