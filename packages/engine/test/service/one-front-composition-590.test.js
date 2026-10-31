// #590 (phase 4 of docs/reorganisation-study-2026-10.md): an engine serves the fronts its composition
// names. On a temporary app root with two fronts (each a package declaring `multiagent.front`, with an
// engine/channels/ file and an engine/areas/ file), a service created with `fronts: ['alpha']` answers
// alpha's channel and the kernel's, and does not know beta's: over HTTP (packages/engine/server) the
// call is a 404, the manifest does not list it, and GET /api/version names the served fronts outside
// the contract hash. Without `fronts`, both are served. What fails at startup: an unknown or repeated
// id in the composition, two packages claiming one id, a `multiagent.front` that is no id, an
// unreadable package.json, a channel file name a front repeats; the same package seen twice (the
// workspace link and its folder) counts once. The load order is by code unit, not by locale. On this
// repository: the full composition's contract hash is `main`'s, and an engine serving every front but
// one does not know that front's channels while the kernel still answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');
const { frontManifest, installedFronts, servedFronts, serviceFiles } = require('../../service/fronts');
const { contractHash } = require('../../service/contract');
const { createServer } = require('../../server');

// the contract of the full composition on `main` at c682ba6a (the last commit before phase 4): phase 4
// moves files between packages and never changes a channel, so the shipped compositions keep it. A
// channel change made on purpose updates this pin with its PR.
const MAIN_CONTRACT = '295a4971dc1c';
const TOKEN = 'test-token-0123456789';

const CHANNEL = (id) => `// the ${id} front's channel\nmodule.exports = (ctx) => [{ channel: '${id}:ping', method: '${id}Ping', schema: { result: { type: 'object' } }, fn: () => ({ pong: ctx.${id}Word() }) }];\n`;
const AREA = (id) => `module.exports = () => ({ ${id}Word: () => '${id}' });\n`;

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'one-front-590-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function writeFront(root, dir, id, { name = `@x/front-${id}`, channelFile = `${id}.js`, manifest = null, engine = true } = {}) {
  const abs = path.join(root, dir);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, 'package.json'), manifest ?? JSON.stringify({ name, multiagent: { front: id } }));
  if (!engine) return abs;
  fs.mkdirSync(path.join(abs, 'engine', 'channels'), { recursive: true });
  fs.mkdirSync(path.join(abs, 'engine', 'areas'), { recursive: true });
  fs.writeFileSync(path.join(abs, 'engine', 'channels', channelFile), CHANNEL(id));
  fs.writeFileSync(path.join(abs, 'engine', 'areas', `${id}-area.js`), AREA(id));
  return abs;
}
function fakeRoot(t, { duplicate = false } = {}) {
  const root = tmpRoot(t);
  writeFront(root, 'fronts/alpha', 'alpha', { channelFile: duplicate ? 'runs.js' : 'alpha.js' });
  writeFront(root, 'fronts/beta', 'beta');
  // a package without the field is not a front; a UI-only front has no engine folder
  writeFront(root, 'fronts/kitonly', 'kitonly', { manifest: JSON.stringify({ name: '@x/kit' }) });
  writeFront(root, 'fronts/gamma', 'gamma', { engine: false });
  return root;
}

async function listen(service) {
  const server = createServer({ service, token: TOKEN, root: path.join(__dirname, '..', '..', '..', '..') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
  const call = async (channel, arg = null) => {
    const res = await fetch(`${url}/api/${channel}`, { method: 'POST', headers, body: JSON.stringify({ arg }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const get = async (p) => (await fetch(`${url}${p}`, { headers })).json();
  return { call, get, close: () => new Promise((r) => server.close(r)) };
}

// the channel names a front's engine/channels/ files declare, read with a stand-in ctx
const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const stubCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'ws' ? null : stub) });
const channelsOf = (front) => serviceFiles(path.join(os.tmpdir(), 'no-kernel'), [front], 'channels').flatMap(({ file }) => require(file)(stubCtx)).map((e) => e.channel).filter(Boolean);

test('#590 installedFronts: the packages declaring multiagent.front, by id, with or without an engine side', (t) => {
  const root = fakeRoot(t);
  const fronts = installedFronts(root);
  assert.deepEqual(fronts.map((f) => f.id), ['alpha', 'beta', 'gamma']);
  assert.ok(fronts[0].engine.endsWith(path.join('alpha', 'engine')));
  assert.equal(fronts[2].engine, null, 'a UI-only front');
  assert.deepEqual(servedFronts(['beta'], fronts).map((f) => f.id), ['beta']);
  assert.deepEqual(servedFronts(null, fronts).map((f) => f.id), ['alpha', 'beta', 'gamma'], 'no composition: every installed front');
  assert.throws(() => servedFronts(['delta'], fronts), /No installed front "delta"/);
  assert.throws(() => servedFronts(['alpha', 'alpha'], fronts), /named twice/);
});

test('#590 a front fails at startup when two packages claim its id, when its id is no id, or when its manifest is unreadable; the same package twice counts once', (t) => {
  const twice = tmpRoot(t);
  writeFront(twice, 'fronts/a', 'x', { name: '@x/front-a' });
  writeFront(twice, 'fronts/b', 'x', { name: '@x/front-b' });
  assert.throws(() => installedFronts(twice), /Two packages declare the front "x"/);
  for (const bad of [42, '', 'Not-An-Id', 'with space', null]) {
    const root = tmpRoot(t);
    writeFront(root, 'fronts/a', 'a', { manifest: JSON.stringify({ name: '@x/a', multiagent: { front: bad } }) });
    assert.throws(() => installedFronts(root), /multiagent\.front must be a front id/, `front: ${JSON.stringify(bad)}`);
  }
  const broken = tmpRoot(t);
  writeFront(broken, 'fronts/a', 'a', { manifest: '{ not json' });
  assert.throws(() => installedFronts(broken), /cannot be read as a package manifest/);
  assert.throws(() => frontManifest(path.join(broken, 'fronts', 'a')), /cannot be read/);
  // the workspace link under node_modules/@multiagent and the folder under fronts/: one front
  const linked = tmpRoot(t);
  writeFront(linked, 'fronts/a', 'a', { name: '@multiagent/front-a' });
  fs.mkdirSync(path.join(linked, 'node_modules', '@multiagent'), { recursive: true });
  fs.symlinkSync(path.join(linked, 'fronts', 'a'), path.join(linked, 'node_modules', '@multiagent', 'front-a'), process.platform === 'win32' ? 'junction' : 'dir'); // a junction needs no privilege on Windows (#600)
  writeFront(linked, 'node_modules/@multiagent/front-copy', 'a', { name: '@multiagent/front-a' }); // a packaged copy
  assert.deepEqual(installedFronts(linked).map((f) => [f.id, path.basename(f.dir)]), [['a', 'a']]);
  assert.equal(frontManifest(path.join(linked, 'fronts', 'a')).engine, 'engine', 'the default engine folder');
});

test('#590 the load order is by code unit, as Array.prototype.sort(), whatever the process locale', (t) => {
  const root = tmpRoot(t);
  // localeCompare puts 'aB' and 'a_b' around 'ab' differently from code-unit order
  for (const id of ['ab', 'a-b', 'aa']) writeFront(root, `fronts/${id}`, id);
  const kernel = path.join(root, 'kernel-channels');
  fs.mkdirSync(kernel);
  for (const name of ['a_b.js', 'aB.js', 'ab.js', 'Zed.js']) fs.writeFileSync(path.join(kernel, name), 'module.exports = () => [];');
  const names = serviceFiles(kernel, installedFronts(root), 'channels').map((x) => x.name);
  assert.deepEqual(names, [...names].sort(), 'the order of .sort()');
  assert.deepEqual(names, ['Zed.js', 'a-b.js', 'aB.js', 'a_b.js', 'aa.js', 'ab.js']);
  assert.deepEqual(installedFronts(root).map((f) => f.id), ['a-b', 'aa', 'ab']);
});

test('#590 a one-front engine serves that front\'s channels plus the kernel\'s and refuses the others with a 404', async (t) => {
  const installed = installedFronts(fakeRoot(t));
  const { service } = makeService(t, { fronts: ['alpha'], installed });
  assert.deepEqual(service.fronts, ['alpha']);
  const methods = service.manifest.map((e) => e.method);
  assert.ok(methods.includes('alphaPing') && !methods.includes('betaPing'), 'the manifest lists alpha, not beta');
  const { call, get, close } = await listen(service);
  try {
    assert.deepEqual(await call('alpha:ping'), { status: 200, body: { result: { pong: 'alpha' } } });
    assert.equal((await call('beta:ping')).status, 404, 'a channel of a front not served is unknown');
    assert.equal((await call('runs:active')).status, 200, 'the kernel answers');
    const version = await get('/api/version');
    assert.deepEqual(version.fronts, ['alpha'], 'GET /api/version names the served fronts');
    assert.equal(version.contract, contractHash(service.manifest));
  } finally { await close(); }
});

test('#590 without a composition every installed front is served; a repeated file name is refused', (t) => {
  const installed = installedFronts(fakeRoot(t));
  const { service } = makeService(t, { installed });
  assert.deepEqual(service.fronts, ['alpha', 'beta', 'gamma']);
  assert.ok(service.api['alpha:ping'] && service.api['beta:ping']);
  assert.throws(() => makeService(t, { installed: installedFronts(fakeRoot(t, { duplicate: true })) }), /runs\.js exists in engine and in alpha/);
});

test('#590 this repository: the full composition keeps main\'s contract hash, and app:info carries no fronts', (t) => {
  const { service } = makeService(t);
  assert.deepEqual(service.fronts, installedFronts().map((f) => f.id), 'no composition: every installed front');
  assert.equal(contractHash(service.manifest), MAIN_CONTRACT, 'the shipped composition is the contract main shipped (a channel change made on purpose updates the pin)');
  assert.equal(service.manifest.find((e) => e.channel === 'app:info').schema.result.properties.fronts, undefined);
});

// Each installed front with an engine side: an engine serving every other front does not know its
// channels (the kernel still answers), and the full composition does. The front PRs add nothing here:
// the loop reads each front's engine/channels/ files.
for (const front of installedFronts().filter((f) => f.engine)) {
  test(`#590 this repository: an engine without the ${front.id} front does not know its channels, the kernel's it does`, (t) => {
    const channels = channelsOf(front);
    assert.ok(channels.length > 0, `${front.id} declares channels`);
    const others = installedFronts().map((f) => f.id).filter((id) => id !== front.id);
    const { service } = makeService(t, { fronts: others });
    assert.deepEqual(service.fronts, others);
    assert.deepEqual(channels.filter((c) => service.api[c]), [], `none of ${front.id}'s channels`);
    assert.ok(service.api['runs:active'] && service.api['projects:list'] && service.api['nightwatch:state'], 'the kernel answers');
    const { service: all } = makeService(t);
    assert.deepEqual(channels.filter((c) => !all.api[c]), [], `${front.id} served: its channels answer`);
  });
}
