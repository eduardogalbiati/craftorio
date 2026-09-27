const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWorkspace, setupWorkspace, fileStore, isGitUrl, repoNameFromUrl, cloneRepo, DEFAULT_NAME } = require('../src/workspace');

// Store em memória no lugar do registro do Windows.
const memStore = (value = null) => ({ value, get() { return this.value; }, set(v) { this.value = v; } });

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-home-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('sem pasta registrada nem padrão, pede decisão ao usuário', (t) => {
  const home = tmpHome(t);
  const r = resolveWorkspace({ store: memStore(), env: {}, home });
  assert.equal(r.dir, null);
  assert.equal(r.fallback, path.join(home, DEFAULT_NAME));
});

test('usa a pasta padrão se ela existir e a registra', (t) => {
  const home = tmpHome(t);
  fs.mkdirSync(path.join(home, DEFAULT_NAME));
  const store = memStore();
  const r = resolveWorkspace({ store, env: {}, home });
  assert.equal(r.source, 'default');
  assert.equal(store.value, path.join(home, DEFAULT_NAME));
});

test('o caminho registrado tem prioridade sobre a pasta padrão', (t) => {
  const home = tmpHome(t);
  const custom = path.join(home, 'outra');
  fs.mkdirSync(custom);
  fs.mkdirSync(path.join(home, DEFAULT_NAME));
  const r = resolveWorkspace({ store: memStore(custom), env: {}, home });
  assert.deepEqual([r.source, r.dir], ['registry', custom]);
});

test('caminho registrado que sumiu é reportado para avisar o usuário', (t) => {
  const home = tmpHome(t);
  const gone = path.join(home, 'sumiu');
  const r = resolveWorkspace({ store: memStore(gone), env: {}, home });
  assert.equal(r.dir, null);
  assert.equal(r.registered, gone);
});

test('MULTIAGENT_WORKSPACE sobrescreve sem consultar o registro', (t) => {
  const home = tmpHome(t);
  const store = { get() { throw new Error('não deveria ler'); }, set() { throw new Error('não deveria gravar'); } };
  const r = resolveWorkspace({ store, env: { MULTIAGENT_WORKSPACE: path.join(home, 'env') }, home });
  assert.deepEqual([r.source, r.dir], ['env', path.join(home, 'env')]);
});

test('setupWorkspace cria runs/ e repos/ e grava o caminho', (t) => {
  const home = tmpHome(t);
  const store = memStore();
  const ws = setupWorkspace(path.join(home, 'novo'), { store });
  assert.ok(fs.statSync(ws.runs).isDirectory());
  assert.ok(fs.statSync(ws.repos).isDirectory());
  assert.equal(store.value, ws.root);
});

test('fileStore persiste o caminho em JSON', (t) => {
  const home = tmpHome(t);
  const store = fileStore(path.join(home, 'cfg.json'));
  assert.equal(store.get(), null);
  store.set('C:\\Área\\ws');
  assert.equal(fileStore(path.join(home, 'cfg.json')).get(), 'C:\\Área\\ws');
});

test('isGitUrl distingue URLs de caminhos locais', () => {
  for (const u of ['https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@host/o/r']) assert.ok(isGitUrl(u), u);
  for (const p of ['C:\\Users\\x\\repo', '/home/x/repo', 'repo', '']) assert.ok(!isGitUrl(p), p);
});

test('repoNameFromUrl usa owner-repo', () => {
  assert.equal(repoNameFromUrl('https://github.com/Cazeh/multiagent.git'), 'Cazeh-multiagent');
  assert.equal(repoNameFromUrl('git@github.com:Cazeh/multiagent.git'), 'Cazeh-multiagent');
  assert.equal(repoNameFromUrl('https://github.com/Cazeh/multiagent/'), 'Cazeh-multiagent');
});

test('cloneRepo clona na primeira vez e só faz fetch depois', async (t) => {
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
