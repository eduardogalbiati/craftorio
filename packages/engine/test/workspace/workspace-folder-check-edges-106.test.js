// #106 edges of the workspace folder check (setupWorkspace's `check` and `persist`), after the
// acceptance tests of workspace-folder-check-106.test.js: what counts as a Craftorio workspace (runs/
// and workflows/ together, as folders), the files the OS leaves in any folder, a path that is a file,
// the explicit `check: false` of the callers that open an already resolved folder, and the Change…
// handler's `check: true, persist: false` when the workspace came from CRAFTORIO_WORKSPACE or a
// simulation (apps/desktop/host/main.js 'workspace:change': refused, and never registered).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { setupWorkspace } = require('../../domains/workspace/workspace');

const memStore = (value = null) => ({ value, get() { return this.value; }, set(v) { this.value = v; } });

function tmpDir(t, prefix = 'ws-106e-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// every entry under dir with its bytes: equal before/after means the folder was left as it was
function snapshot(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = path.join(rel, name);
      const full = path.join(dir, r);
      if (fs.lstatSync(full).isDirectory()) { out.push(`d ${r}`); walk(r); } else out.push(`f ${r} ${fs.readFileSync(full).toString('base64')}`);
    }
  };
  walk('');
  return out;
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (rel.endsWith('/')) { fs.mkdirSync(path.join(dir, rel), { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

// refused: throws a non-empty message, the folder is unchanged and the store keeps its value
function assertRefused(dir, opts = {}) {
  const before = snapshot(dir);
  const store = memStore('/previous/workspace');
  assert.throws(() => setupWorkspace(dir, { store, ...opts }), (e) => typeof e.message === 'string' && e.message.trim().length > 0);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(store.value, '/previous/workspace');
}

for (const [name, files] of [
  ['only a runs/ folder', { 'runs/': '', 'runs/out.txt': 'build output\n' }],
  ['only a workflows/ folder', { 'workflows/': '', 'workflows/ci.yml': 'on: push\n' }],
  ['only a settings.json', { 'settings.json': '{"editor.tabSize": 2}\n' }],
  ['a runs file and a workflows/ folder (runs is not a folder)', { runs: 'not a folder\n', 'workflows/': '' }],
]) {
  test(`#106 a project folder with ${name} is not a workspace: refused and untouched`, (t) => {
    const dir = tmpDir(t);
    write(dir, files);
    assertRefused(dir);
  });
}

test('#106 a folder holding runs/ and workflows/ together is taken as a workspace, its files kept', (t) => {
  const dir = tmpDir(t);
  write(dir, { 'runs/old/run.json': '{}\n', 'workflows/feature.yaml': 'name: feature\n' });
  const store = memStore();
  const ws = setupWorkspace(dir, { store });
  assert.equal(ws.root, path.resolve(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'runs', 'old', 'run.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(dir, 'workflows', 'feature.yaml'), 'utf8'), 'name: feature\n');
  assert.equal(store.value, path.resolve(dir));
});

test('#106 a folder with only the files the OS leaves (.DS_Store, Thumbs.db, desktop.ini) is taken as empty', (t) => {
  const dir = tmpDir(t);
  write(dir, { '.DS_Store': 'x', 'Thumbs.db': 'x', 'desktop.ini': '[.ShellClassInfo]\n' });
  const ws = setupWorkspace(dir, { store: memStore() });
  assert.equal(fs.statSync(ws.workflows).isDirectory(), true);
});

test('#106 an OS file next to a project file does not make the folder acceptable', (t) => {
  const dir = tmpDir(t);
  write(dir, { '.DS_Store': 'x', 'README.md': '# Mine\n' });
  assertRefused(dir);
});

test('#106 a path that is a file is refused and the file left as it was', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'mine\n');
  const store = memStore('/previous/workspace');
  assert.throws(() => setupWorkspace(file, { store }), (e) => e.message.trim().length > 0);
  assert.equal(fs.statSync(file).isFile(), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'mine\n');
  assert.equal(store.value, '/previous/workspace');
});

test('#106 check: false opens an already resolved folder with other files (the start with the registered or default folder)', (t) => {
  const dir = tmpDir(t);
  write(dir, { 'README.md': '# Old workspace with notes\n' });
  const ws = setupWorkspace(dir, { store: memStore(), persist: false, check: false });
  assert.equal(ws.root, path.resolve(dir));
  assert.equal(fs.statSync(ws.runs).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), '# Old workspace with notes\n');
});

test('#106 check: true, persist: false (Change… on a CRAFTORIO_WORKSPACE or simulated workspace) still refuses a project folder', (t) => {
  const dir = tmpDir(t);
  write(dir, { 'README.md': '# Docs\n', 'docs/guide.md': '## Guide\n' });
  assertRefused(dir, { persist: false, check: true });
});

test('#106 check: true, persist: false takes an empty folder without registering it', (t) => {
  const dir = tmpDir(t);
  const store = memStore('/previous/workspace');
  const ws = setupWorkspace(dir, { store, persist: false, check: true });
  assert.equal(fs.statSync(ws.workflows).isDirectory(), true);
  assert.equal(store.value, '/previous/workspace');
});

test('#106 a refusal message names the reason in the language asked for (lang)', (t) => {
  const dir = tmpDir(t);
  write(dir, { 'README.md': '# Docs\n' });
  const message = (lang) => {
    try { setupWorkspace(dir, { store: memStore(), check: true, lang }); } catch (e) { return e.message; }
    return null;
  };
  const en = message('en');
  const pt = message('pt-BR');
  assert.match(en, /empty/i);
  assert.match(en, /Craftorio/);
  assert.match(pt, /vazia/i);
  assert.doesNotMatch(pt, /\bempty\b/i);
});
