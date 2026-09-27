const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWorkspace, setupWorkspace, fileStore, isGitUrl, repoNameFromUrl, cloneRepo, DEFAULT_NAME } = require('../src/workspace');

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

test('MULTIAGENT_WORKSPACE overrides without querying the registry', (t) => {
  const home = tmpHome(t);
  const store = { get() { throw new Error('should not read'); }, set() { throw new Error('should not write'); } };
  const r = resolveWorkspace({ store, env: { MULTIAGENT_WORKSPACE: path.join(home, 'env') }, home });
  assert.deepEqual([r.source, r.dir], ['env', path.join(home, 'env')]);
});

test('setupWorkspace creates runs/ and repos/ and saves the path', (t) => {
  const home = tmpHome(t);
  const store = memStore();
  const ws = setupWorkspace(path.join(home, 'new'), { store });
  assert.ok(fs.statSync(ws.runs).isDirectory());
  assert.ok(fs.statSync(ws.repos).isDirectory());
  assert.equal(store.value, ws.root);
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
  assert.equal(repoNameFromUrl('https://github.com/Cazeh/multiagent.git'), 'Cazeh-multiagent');
  assert.equal(repoNameFromUrl('git@github.com:Cazeh/multiagent.git'), 'Cazeh-multiagent');
  assert.equal(repoNameFromUrl('https://github.com/Cazeh/multiagent/'), 'Cazeh-multiagent');
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
