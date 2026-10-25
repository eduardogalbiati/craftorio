// packages/engine/service/channels/storage.js (#198): depsCache:info and depsCache:clear, Settings' dependency
// cache size and "Clear dependency cache". The entries themselves are made directly on disk (the
// shape packages/engine/engine/deps-cache.js's entry.json writes), not through a real install.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { createService } = require('../../service');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-cache-channels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function makeService(t) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir: tmp(t) } });
  t.after(() => service.shutdown());
  const ws = setupWorkspace(tmp(t), { persist: false });
  service.setWorkspace(ws);
  return { service, ws };
}

function makeEntry(ws, project, key, { bytes = 1000, linked = false } = {}) {
  const dir = path.join(ws.cache, 'deps', project, key);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify({ key, bytes, last_used: new Date().toISOString(), sentinel: null }));
  if (linked) {
    const wt = fs.mkdtempSync(path.join(ws.cache, 'wt-'));
    const nm = path.join(wt, 'node_modules');
    fs.symlinkSync(path.join(dir, 'node_modules'), nm, process.platform === 'win32' ? 'junction' : 'dir');
    fs.mkdirSync(path.join(dir, 'links'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'links', 'a.json'), JSON.stringify({ path: nm, at: new Date().toISOString() }));
  }
  return dir;
}

test('the manifest declares depsCache:info and depsCache:clear with their methods', (t) => {
  const { service } = makeService(t);
  const byChannel = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.method]));
  assert.equal(byChannel['depsCache:info'], 'depsCacheInfo');
  assert.equal(byChannel['depsCache:clear'], 'clearDepsCache');
});

test('depsCache:info sums the cache\'s entries on an empty workspace, and after a few entries are made', (t) => {
  const { service, ws } = makeService(t);
  assert.deepEqual(service.api['depsCache:info'](), { dir: path.join(ws.cache, 'deps'), entries: 0, bytes: 0, linked: 0 });

  makeEntry(ws, 'p', 'a', { bytes: 1000 });
  makeEntry(ws, 'p', 'b', { bytes: 2000, linked: true });
  const info = service.api['depsCache:info']();
  assert.equal(info.entries, 2);
  assert.equal(info.bytes, 3000);
  assert.equal(info.linked, 1);
});

test('depsCache:clear removes every unlinked entry and keeps the linked ones', (t) => {
  const { service, ws } = makeService(t);
  const unlinked = makeEntry(ws, 'p', 'a', { bytes: 1000 });
  const linked = makeEntry(ws, 'p', 'b', { bytes: 2000, linked: true });

  const r = service.api['depsCache:clear']();
  assert.equal(r.removed, 1);
  assert.equal(r.freedBytes, 1000);
  assert.ok(!fs.existsSync(unlinked));
  assert.ok(fs.existsSync(linked));
  assert.equal(r.entries, 1);
  assert.equal(r.bytes, 2000);
  assert.equal(r.linked, 1);
});
