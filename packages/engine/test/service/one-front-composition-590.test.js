// #590 (phase 4 of docs/reorganisation-study-2026-10.md): an engine serves the fronts its composition
// names. On a temporary app root with two fronts (each a package declaring `multiagent.front`, with an
// engine/channels/ file and an engine/areas/ file), a service created with `fronts: ['alpha']` answers
// alpha's channel and the kernel's, and does not know beta's: over HTTP (packages/engine/server) the
// call is a 404, and the manifest does not list it. Without `fronts`, both are served. An unknown id
// is an error, and a channel file name a front repeats is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');
const { installedFronts, servedFronts } = require('../../service/fronts');
const { createServer } = require('../../server');

const CHANNEL = (id) => `// the ${id} front's channel\nmodule.exports = (ctx) => [{ channel: '${id}:ping', method: '${id}Ping', schema: { result: { type: 'object' } }, fn: () => ({ pong: ctx.${id}Word() }) }];\n`;
const AREA = (id) => `module.exports = () => ({ ${id}Word: () => '${id}' });\n`;

function fakeRoot(t, { duplicate = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'one-front-590-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ['alpha', 'beta']) {
    const dir = path.join(root, 'fronts', id);
    fs.mkdirSync(path.join(dir, 'engine', 'channels'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'engine', 'areas'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@x/front-${id}`, multiagent: { front: id } }));
    fs.writeFileSync(path.join(dir, 'engine', 'channels', `${duplicate ? 'runs' : id}.js`), CHANNEL(id));
    fs.writeFileSync(path.join(dir, 'engine', 'areas', `${id}-area.js`), AREA(id));
  }
  // a package without the field is not a front; a UI-only front has no engine folder
  fs.mkdirSync(path.join(root, 'fronts', 'kitonly'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fronts', 'kitonly', 'package.json'), JSON.stringify({ name: '@x/kit' }));
  fs.mkdirSync(path.join(root, 'fronts', 'gamma'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fronts', 'gamma', 'package.json'), JSON.stringify({ name: '@x/front-gamma', multiagent: { front: 'gamma' } }));
  return root;
}

async function listen(service) {
  const server = createServer({ service, token: 'test-token-0123456789', root: path.join(__dirname, '..', '..', '..', '..') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (channel, arg = null) => {
    const res = await fetch(`${url}/api/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token-0123456789' }, body: JSON.stringify({ arg }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('#590 installedFronts: the packages declaring multiagent.front, by id, with or without an engine side', (t) => {
  const root = fakeRoot(t);
  const fronts = installedFronts(root);
  assert.deepEqual(fronts.map((f) => f.id), ['alpha', 'beta', 'gamma']);
  assert.ok(fronts[0].engine.endsWith(path.join('alpha', 'engine')));
  assert.equal(fronts[2].engine, null, 'a UI-only front');
  assert.deepEqual(servedFronts(['beta'], fronts).map((f) => f.id), ['beta']);
  assert.deepEqual(servedFronts(null, fronts).map((f) => f.id), ['alpha', 'beta', 'gamma'], 'no composition: every installed front');
  assert.throws(() => servedFronts(['delta'], fronts), /No installed front "delta"/);
});

test('#590 a one-front engine serves that front\'s channels plus the kernel\'s and refuses the others with a 404', async (t) => {
  const installed = installedFronts(fakeRoot(t));
  const { service } = makeService(t, { fronts: ['alpha'], installed });
  assert.deepEqual(service.fronts, ['alpha']);
  const methods = service.manifest.map((e) => e.method);
  assert.ok(methods.includes('alphaPing') && !methods.includes('betaPing'), 'the manifest lists alpha, not beta');
  assert.equal((await service.api['app:info']()).fronts.join(), 'alpha', 'app:info says which fronts');
  const { call, close } = await listen(service);
  try {
    assert.deepEqual(await call('alpha:ping'), { status: 200, body: { result: { pong: 'alpha' } } });
    assert.equal((await call('beta:ping')).status, 404, 'a channel of a front not served is unknown');
    assert.equal((await call('runs:active')).status, 200, 'the kernel answers');
  } finally { await close(); }
});

test('#590 without a composition every installed front is served; a repeated file name is refused', (t) => {
  const installed = installedFronts(fakeRoot(t));
  const { service } = makeService(t, { installed });
  assert.deepEqual(service.fronts, ['alpha', 'beta', 'gamma']);
  assert.ok(service.api['alpha:ping'] && service.api['beta:ping']);
  assert.throws(() => makeService(t, { installed: installedFronts(fakeRoot(t, { duplicate: true })) }), /runs\.js exists in engine and in alpha/);
});
