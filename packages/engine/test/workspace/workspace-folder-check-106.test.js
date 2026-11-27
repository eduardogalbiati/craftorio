// #106 acceptance tests (written before the code): Settings › General › Workspace folder › Change…
// (apps/desktop/host/main.js 'workspace:change' → workspace.setupWorkspace(dir), then
// service.setWorkspace seeds it) takes an empty folder or an existing Craftorio workspace; a folder
// holding another project's files is refused with a message that says why, in the interface language
// (packages/shared/i18n.js setLanguage), and nothing is written into it (no partial seed, the path is
// not registered).
// The refusal is either a thrown Error or a { ok: false, error|reason|message } answer from
// setupWorkspace: both are accepted, the message must not be empty.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/workspace/workspace');
const i18n = () => require('@craftorio/shared/i18n.js');

afterEach(() => {
  try { i18n().setLanguage('en'); } catch { /* no catalog module */ }
});

// In-memory store instead of the Windows registry / ~/.craftorio.json.
const memStore = (value = null) => ({ value, get() { return this.value; }, set(v) { this.value = v; } });

function tmpDir(t, prefix = 'ws-106-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Every entry under dir (relative path, kind, file bytes as base64), sorted: equal before/after
// means the folder was left exactly as it was.
function snapshot(dir, { skip = () => false } = {}) {
  const out = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = path.join(rel, name);
      if (skip(r)) continue;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isDirectory()) { out.push(`d ${r}`); walk(r); } else out.push(`f ${r} ${fs.readFileSync(path.join(dir, r)).toString('base64')}`);
    }
  };
  walk('');
  return out;
}

// A docs-only project, like the one in the issue: a README, docs/, a .git folder.
function projectFolder(t) {
  const dir = tmpDir(t, 'ws-106-project-');
  fs.writeFileSync(path.join(dir, 'README.md'), '# My docs\n\nA project that is not a workspace.\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '## Guide\n\nSome text.\n');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

// Calls setupWorkspace as the Change… handler does: { refused, message, ws }.
function attempt(dir, store) {
  try {
    const r = load().setupWorkspace(dir, { store });
    if (r && r.ok === false) return { refused: true, message: String(r.error || r.reason || r.message || ''), ws: null };
    return { refused: false, message: '', ws: r };
  } catch (e) {
    return { refused: true, message: String(e?.message || ''), ws: null };
  }
}

// A workspace as the app leaves it: setupWorkspace on an empty folder, then what opening it seeds
// (packages/engine/service/areas/workspace.js seedDefaults) and a settings.json.
function existingWorkspace(t) {
  const dir = tmpDir(t, 'ws-106-existing-');
  const ws = load().setupWorkspace(dir, { store: memStore() });
  const { BUNDLED_SKILLS_DIR, BUNDLED_WORKFLOWS_DIR } = require('../../service/common');
  require('../../domains/agents/skills').seedSkills(BUNDLED_SKILLS_DIR, ws.skills);
  require('../../domains/workflow/workflows').seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows);
  const pipelines = require('../../domains/workflow/pipelines');
  pipelines.seedPipelines(pipelines.BUNDLED_PIPELINES_DIR, ws.pipelines);
  const instructions = require('../../domains/workspace/workspace-instructions');
  instructions.seedWorkspaceInstructions(instructions.BUNDLED_INSTRUCTIONS_DIR, ws.root);
  load().writeSettings(ws, {});
  assert.ok(fs.existsSync(ws.settings), 'fixture: settings.json written');
  assert.ok(fs.existsSync(path.join(ws.root, 'AGENTS.md')), 'fixture: AGENTS.md seeded');
  return ws;
}

test('#106 an empty folder is taken: the workspace folders are created and the path is registered', (t) => {
  const dir = tmpDir(t);
  const store = memStore();
  const r = attempt(dir, store);
  assert.equal(r.refused, false, `refused: ${r.message}`);
  assert.equal(r.ws.root, path.resolve(dir));
  assert.ok(fs.statSync(path.join(dir, 'workflows')).isDirectory());
  assert.ok(fs.statSync(path.join(dir, 'runs')).isDirectory());
  assert.equal(store.value, path.resolve(dir));
});

test('#106 a folder that does not exist yet is taken and created (the default folder at the first start)', (t) => {
  const dir = path.join(tmpDir(t), 'new-workspace');
  const r = attempt(dir, memStore());
  assert.equal(r.refused, false, `refused: ${r.message}`);
  assert.ok(fs.statSync(path.join(dir, 'workflows')).isDirectory());
});

test('#106 an existing Craftorio workspace is taken, its files untouched', (t) => {
  const ws = existingWorkspace(t);
  const before = snapshot(ws.root);
  const store = memStore();
  const r = attempt(ws.root, store);
  assert.equal(r.refused, false, `refused: ${r.message}`);
  assert.equal(r.ws.root, ws.root);
  assert.deepEqual(snapshot(ws.root), before);
  assert.equal(store.value, ws.root);
});

test('#106 a folder holding another project\'s files is refused with a message', (t) => {
  const dir = projectFolder(t);
  const r = attempt(dir, memStore());
  assert.equal(r.refused, true, 'the project folder was taken as the workspace');
  assert.ok(r.message.trim().length > 0, 'the refusal says why');
});

test('#106 a refused folder is left exactly as it was: nothing seeded, nothing created', (t) => {
  const dir = projectFolder(t);
  const before = snapshot(dir);
  attempt(dir, memStore());
  assert.deepEqual(snapshot(dir), before);
  for (const name of ['AGENTS.md', 'workflows', 'skills', 'settings.json', 'index.db', 'runs', 'repos', 'projects', 'agents']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} was created in the refused folder`);
  }
});

test('#106 a refused folder is not registered as the workspace', (t) => {
  const dir = projectFolder(t);
  const store = memStore('/previous/workspace');
  attempt(dir, store);
  assert.equal(store.value, '/previous/workspace');
});

test('#106 a folder with a single unrelated file is refused too', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine\n');
  const before = snapshot(dir);
  const r = attempt(dir, memStore());
  assert.equal(r.refused, true, 'a folder with another file was taken');
  assert.deepEqual(snapshot(dir), before);
});

test('#106 the refusal is in the interface language: pt-BR differs from English', (t) => {
  const dir = projectFolder(t);
  i18n().setLanguage('en');
  const en = attempt(dir, memStore());
  i18n().setLanguage('pt-BR');
  const pt = attempt(dir, memStore());
  assert.equal(en.refused, true, 'refused in English');
  assert.equal(pt.refused, true, 'refused in Portuguese');
  assert.ok(en.message.trim() && pt.message.trim(), 'both messages say why');
  assert.notEqual(pt.message, en.message, 'the pt-BR message is not the English one');
});
