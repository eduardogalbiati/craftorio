const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWorkspace, setupWorkspace, fileStore, isGitUrl, repoNameFromUrl, cloneRepo, DEFAULT_NAME } = require('../../domains/workspace/workspace');

// In-memory store instead of the Windows registry.
const memStore = (value = null) => ({ value, get() { return this.value; }, set(v) { this.value = v; } });

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-home-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('with no registered or default folder, asks the user to decide', (t) => {
  const home = tmpHome(t);
  const r = resolveWorkspace({ store: memStore(), env: {}, home });
  assert.equal(r.dir, null);
  assert.equal(r.fallback, path.join(home, DEFAULT_NAME));
});

test('uses the default folder if it exists and registers it', (t) => {
  const home = tmpHome(t);
  fs.mkdirSync(path.join(home, DEFAULT_NAME));
  const store = memStore();
  const r = resolveWorkspace({ store, env: {}, home });
  assert.equal(r.source, 'default');
  assert.equal(store.value, path.join(home, DEFAULT_NAME));
});

test('the registered path takes priority over the default folder', (t) => {
  const home = tmpHome(t);
  const custom = path.join(home, 'other');
  fs.mkdirSync(custom);
  fs.mkdirSync(path.join(home, DEFAULT_NAME));
  const r = resolveWorkspace({ store: memStore(custom), env: {}, home });
  assert.deepEqual([r.source, r.dir], ['registry', custom]);
});

test('a registered path that disappeared is reported to warn the user', (t) => {
  const home = tmpHome(t);
  const gone = path.join(home, 'gone');
  const r = resolveWorkspace({ store: memStore(gone), env: {}, home });
  assert.equal(r.dir, null);
  assert.equal(r.registered, gone);
});

test('CRAFTORIO_WORKSPACE overrides without querying the registry', (t) => {
  const home = tmpHome(t);
  const store = { get() { throw new Error('should not read'); }, set() { throw new Error('should not write'); } };
  const r = resolveWorkspace({ store, env: { CRAFTORIO_WORKSPACE: path.join(home, 'env') }, home });
  assert.deepEqual([r.source, r.dir], ['env', path.join(home, 'env')]);
});

// #120: an agent's own check (CRAFTORIO_SIMULATION_ONLY=1) that was not given its run's scratch
// workspace must never fall back to the owner's registered or default workspace.
test('simulation only (CRAFTORIO_SIMULATION_ONLY=1) without CRAFTORIO_WORKSPACE never returns the registered or the default workspace', (t) => {
  const home = tmpHome(t);
  const registered = path.join(home, 'registered');
  fs.mkdirSync(registered);
  fs.mkdirSync(path.join(home, DEFAULT_NAME));
  const store = { get() { throw new Error('should not read the registry in simulation only'); }, set() { throw new Error('should not write it either'); } };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sim-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const r = resolveWorkspace({ store, env: { CRAFTORIO_SIMULATION_ONLY: '1' }, home, tmp: tmpDir });
  assert.equal(r.source, 'simulation');
  assert.equal(r.dir, path.join(tmpDir, 'craftorio-simulation', 'workspace'));
  assert.notEqual(r.dir, registered);
  assert.notEqual(r.dir, path.join(home, DEFAULT_NAME));
  assert.equal(r.registered, null);
});

test('CRAFTORIO_WORKSPACE (an agent\'s own run scratch workspace, set by the engine) still wins over simulation only', (t) => {
  const home = tmpHome(t);
  const r = resolveWorkspace({ store: memStore(), env: { CRAFTORIO_WORKSPACE: path.join(home, 'scratch'), CRAFTORIO_SIMULATION_ONLY: '1' }, home });
  assert.deepEqual([r.source, r.dir], ['env', path.join(home, 'scratch')]);
});

test('setupWorkspace creates runs/ and repos/ and saves the path', (t) => {
  const home = tmpHome(t);
  const store = memStore();
  const ws = setupWorkspace(path.join(home, 'new'), { store });
  assert.ok(fs.statSync(ws.runs).isDirectory());
  assert.ok(fs.statSync(ws.repos).isDirectory());
  assert.equal(store.value, ws.root);
  // the app-wide Supervisor chat (#28, packages/engine/domains/supervisor/supervisor-chat.js): created on demand, not up front
  assert.equal(ws.supervisor, path.join(ws.root, 'supervisor'));
  assert.equal(fs.existsSync(ws.supervisor), false);
});

test('fileStore persists the path as JSON', (t) => {
  const home = tmpHome(t);
  const store = fileStore(path.join(home, 'cfg.json'));
  assert.equal(store.get(), null);
  store.set('C:\\Área\\ws');
  assert.equal(fileStore(path.join(home, 'cfg.json')).get(), 'C:\\Área\\ws');
});

test('isGitUrl tells URLs apart from local paths', () => {
  for (const u of ['https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@host/o/r']) assert.ok(isGitUrl(u), u);
  for (const p of ['C:\\Users\\x\\repo', '/home/x/repo', 'repo', '']) assert.ok(!isGitUrl(p), p);
});

test('repoNameFromUrl uses owner-repo', () => {
  assert.equal(repoNameFromUrl('https://github.com/octo/demo.git'), 'octo-demo');
  assert.equal(repoNameFromUrl('git@github.com:octo/demo.git'), 'octo-demo');
  assert.equal(repoNameFromUrl('https://github.com/octo/demo/'), 'octo-demo');
});

test('cloneRepo clones the first time and only fetches afterwards', async (t) => {
  const home = tmpHome(t);
  const calls = [];
  const run = async (args, cwd) => {
    calls.push(args[0]);
    if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
  };
  const url = 'https://github.com/o/r.git';
  const first = await cloneRepo(url, path.join(home, 'repos'), { run });
  const second = await cloneRepo(url, path.join(home, 'repos'), { run });
  assert.deepEqual(calls, ['clone', 'fetch']);
  assert.deepEqual([first.cloned, second.cloned], [true, false]);
  assert.equal(first.dir, path.join(home, 'repos', 'o-r'));
});

// ---- T2c: an install from before the rename to Craftorio ----------------------------------------

test('T2c the old default folder ~/multiagent-workspace is used (and registered) when the new one does not exist', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-legacy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'multiagent-workspace'));
  const store = { value: null, get() { return this.value; }, set(v) { this.value = v; } };
  const r = resolveWorkspace({ store, env: {}, home });
  assert.equal(r.dir, path.join(home, 'multiagent-workspace'));
  assert.equal(r.source, 'default');
  assert.equal(store.value, path.join(home, 'multiagent-workspace'));
  assert.equal(r.fallback, path.join(home, 'craftorio-workspace'), 'a new install still gets the new name');
});

test('T2c with both default folders the new one wins', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-legacy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const d of ['multiagent-workspace', 'craftorio-workspace']) fs.mkdirSync(path.join(home, d));
  const store = { value: null, get() { return this.value; }, set(v) { this.value = v; } };
  assert.equal(resolveWorkspace({ store, env: {}, home }).dir, path.join(home, 'craftorio-workspace'));
});

test('T2c fileStore reads the old file when the new one is missing, and writes the new one', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-legacy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const legacy = path.join(home, '.multiagent-orchestrator.json');
  fs.writeFileSync(legacy, JSON.stringify({ workspace: '/old/ws' }));
  const store = fileStore(path.join(home, '.craftorio.json'), legacy);
  assert.equal(store.get(), '/old/ws');
  store.set('/new/ws');
  assert.equal(store.get(), '/new/ws');
  assert.equal(JSON.parse(fs.readFileSync(legacy, 'utf8')).workspace, '/old/ws', 'the old file is left as it was');
});
